/**
 * Adobe Firefly 视频生成 operation（财务闭环）。
 *
 * 职责：校验视频模型 → 从系统设置算价（每秒基价 × 时长 × 模型族倍率）→ 落 video_generation
 * (pending) → 按模型前缀解析 Adobe 直连后端 → 幂等扣费（consumeCredits，sourceRef）→
 * 派发 runAdobeDirectVideoRequest → 视频 re-host 到对象存储 → 标记 completed；任一阶段失败
 * 退款（refundGenerationCredits，幂等）并标记 failed。
 *
 * 不变量：财务真相在 credits_transaction；扣费/退款都带 sourceRef 幂等键，杜绝重复扣/重复退。
 * 关键依赖：getEffectiveConfig（池解析）、runAdobeDirectVideoRequest（派发）、storage、credits。
 */

import { db } from "@repo/database";
import { videoGeneration } from "@repo/database/schema";
import {
  DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND,
  getVideoCreditCost,
  resolveVideoModelMultiplier,
} from "@repo/shared/adobe";
import { resolveFireflyVideoModel } from "@repo/shared/adobe/firefly-direct";
import { consumeCredits } from "@repo/shared/credits/core";
import { refundGenerationCredits } from "@repo/shared/generation-maintenance";
import { logError } from "@repo/shared/logger";
import { getStorageProvider } from "@repo/shared/storage/providers";
import {
  getRuntimeSettingJson,
  getRuntimeSettingNumber,
  getRuntimeSettingString,
} from "@repo/shared/system-settings";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { runAdobeDirectVideoRequest } from "./adobe-direct";
import { getEffectiveConfig } from "./service";

export type VideoGenerationInput = {
  userId: string;
  apiKeyId?: string | null;
  prompt: string;
  /** 完整 Firefly 视频 model id（firefly-<family>-<dur>s-<ratio>[-<res>]）。 */
  model: string;
  negativePrompt?: string | null;
  /** 图生视频输入图（首帧/尾帧/参考）。 */
  inputImages?: Array<{ data: Buffer; type?: string | null }>;
  /** 输入图来源引用（@ 历史图：generationId / storageKey），仅作记录。 */
  inputImageRefs?: Array<{
    generationId?: string;
    storageKey?: string;
    role?: string;
  }>;
  signal?: AbortSignal;
};

export type VideoGenerationResult =
  | {
      videoGenerationId: string;
      storageKey: string;
      creditsConsumed: number;
    }
  | { error: string; videoGenerationId?: string };

/** 把系统设置里的倍率 JSON 收窄成 family→正数 的 map。 */
function parseMultipliers(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}

async function markVideoFailed(id: string, error: string): Promise<void> {
  await db
    .update(videoGeneration)
    .set({ status: "failed", error: error.slice(0, 1000), updatedAt: new Date() })
    .where(eq(videoGeneration.id, id))
    .catch(() => {});
}

/**
 * 跑一次 Adobe Firefly 视频生成（含计费与持久化）。
 */
export async function runAdobeVideoGenerationForUser(
  input: VideoGenerationInput
): Promise<VideoGenerationResult> {
  const conf = resolveFireflyVideoModel(input.model);
  if (!conf) {
    return { error: `不支持的视频模型: ${input.model}` };
  }

  // 算价：每秒基价 × 时长 × 模型族倍率（从系统设置取）。
  const basePerSecond = await getRuntimeSettingNumber(
    "VIDEO_BASE_CREDITS_PER_SECOND",
    DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND
  );
  const multipliers = parseMultipliers(
    await getRuntimeSettingJson("VIDEO_MODEL_MULTIPLIERS")
  );
  const cost = getVideoCreditCost({
    durationSeconds: conf.duration,
    basePerSecond,
    modelMultiplier: resolveVideoModelMultiplier(conf.family, multipliers),
  });

  const videoId = nanoid();
  // 扣费/退款幂等键：派生自服务端 videoId，全局唯一。
  const sourceRef = `adobe-video:${videoId}`;
  const now = new Date();

  await db.insert(videoGeneration).values({
    id: videoId,
    userId: input.userId,
    apiKeyId: input.apiKeyId ?? null,
    model: input.model,
    family: conf.family,
    prompt: input.prompt,
    durationSeconds: conf.duration,
    aspectRatio: conf.aspectRatio,
    resolution: conf.outputResolution,
    status: "pending",
    creditsConsumed: 0,
    ...(input.inputImageRefs?.length
      ? { inputImageRefs: input.inputImageRefs }
      : {}),
    createdAt: now,
    updatedAt: now,
  });

  // 按模型前缀解析 Adobe 直连后端。
  let config: Awaited<ReturnType<typeof getEffectiveConfig>>["config"];
  try {
    const effective = await getEffectiveConfig(null, {
      userId: input.userId,
      ...(input.apiKeyId ? { apiKeyId: input.apiKeyId } : {}),
      requestKind: "image_generation",
      requestedModel: input.model,
      ignoreUserConfig: true,
    });
    config = effective.config;
  } catch (error) {
    await markVideoFailed(
      videoId,
      error instanceof Error ? error.message : "无可用后端"
    );
    return { error: "无可用 Adobe 视频后端", videoGenerationId: videoId };
  }
  if (
    config.backend?.type !== "pool-adobe" ||
    config.backend.adobeMode !== "direct"
  ) {
    await markVideoFailed(videoId, "命中后端非 Adobe 直连");
    return {
      error: "视频生成需要一个 Adobe 直连(direct)后端",
      videoGenerationId: videoId,
    };
  }

  // 预扣积分（幂等 sourceRef）。不足/失败 → 标记 failed 返回。
  try {
    await consumeCredits({
      userId: input.userId,
      amount: cost,
      serviceName: "adobe-video",
      description: `Adobe 视频生成 ${input.model}`,
      sourceRef,
      metadata: {
        videoGenerationId: videoId,
        model: input.model,
        durationSeconds: conf.duration,
        ...(input.apiKeyId ? { externalApiKeyId: input.apiKeyId } : {}),
      },
    });
  } catch (error) {
    await markVideoFailed(videoId, "积分不足");
    return {
      error: error instanceof Error ? error.message : "积分不足",
      videoGenerationId: videoId,
    };
  }

  await db
    .update(videoGeneration)
    .set({ status: "running", creditsConsumed: cost, updatedAt: new Date() })
    .where(eq(videoGeneration.id, videoId));

  // 失败统一退款 + 标记。退款幂等（同一 sourceRef 只退一次）。
  const failAndRefund = async (message: string): Promise<VideoGenerationResult> => {
    await refundGenerationCredits({
      generationId: videoId,
      userId: input.userId,
      amount: cost,
      sourceRef,
      description: `Adobe 视频生成失败退款 ${input.model}`,
    }).catch((error) =>
      logError(error, { source: "adobe-video-refund", videoId })
    );
    await db
      .update(videoGeneration)
      .set({
        status: "failed",
        error: message.slice(0, 1000),
        creditsConsumed: 0,
        updatedAt: new Date(),
      })
      .where(eq(videoGeneration.id, videoId));
    return { error: message, videoGenerationId: videoId };
  };

  // 派发（submit→轮询→下载）。
  const result = await runAdobeDirectVideoRequest(config, {
    prompt: input.prompt,
    model: input.model,
    ...(input.inputImages ? { inputImages: input.inputImages } : {}),
    ...(input.negativePrompt != null
      ? { negativePrompt: input.negativePrompt }
      : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if ("error" in result) {
    return failAndRefund(result.error);
  }

  // re-host 视频到对象存储。
  const bucket =
    (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
    "generations";
  const storageKey = `${input.userId}/${nanoid(32)}.mp4`;
  try {
    const storage = await getStorageProvider();
    await storage.putObject(
      storageKey,
      bucket,
      result.bytes,
      result.contentType || "video/mp4"
    );
  } catch (error) {
    logError(error, { source: "adobe-video-rehost", videoId });
    return failAndRefund("视频已生成但存储失败，已退款，请重试");
  }

  const completedAt = new Date();
  await db
    .update(videoGeneration)
    .set({
      status: "completed",
      storageKey,
      completedAt,
      updatedAt: completedAt,
    })
    .where(eq(videoGeneration.id, videoId));

  return { videoGenerationId: videoId, storageKey, creditsConsumed: cost };
}
