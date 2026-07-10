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
import {
  creditsTransaction,
  externalApiKeyUsage,
  videoGeneration,
} from "@repo/database/schema";
import {
  DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND,
  resolveVideoModelMultiplier,
  resolveVideoModelPricing,
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
  isOperationFeatureEnabled,
} from "@repo/shared/system-settings";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  refundExternalApiKeyCredits,
  reserveExternalApiKeyCredits,
} from "@/features/external-api/quota";
import { releaseImageBackendInflightLease } from "@/features/image-backend-pool/service";
import { runAdobeDirectVideoRequest } from "./adobe-direct";
import { invalidateGalleryCountsCache } from "./gallery-cache";
import {
  recoverVideoGenerationResult,
  videoGenerationNeedsRecovery,
} from "./generation-recovery";
import { getEffectiveConfig, poolBackendMemberType } from "./service";

export type VideoGenerationInput = {
  userId: string;
  apiKeyId?: string | null;
  /** 持久任务本次租约 token；同步路径不传并只操作 NULL token 行。 */
  executionToken?: string;
  prompt: string;
  /**
   * 预供的 video_generation 行 id（可选）。异步路径预先生成并传入,使任务的
   * generation_id 与落库行 id 一致,便于后续按 id 持久查询;不传则内部生成。
   */
  videoGenerationId?: string;
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

/** 视频执行态超过该窗口后由持久 worker 接管并执行幂等补偿。 */
export const VIDEO_GENERATION_RECOVERY_TIMEOUT_MS = 20 * 60_000;

/** 把系统设置里的倍率 JSON 收窄成 family→正数 的 map。 */
function parseMultipliers(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}

/**
 * 在持久任务丢失租约后阻断旧执行者继续产生副作用。
 *
 * @param signal worker 或请求传入的中止信号。
 * @throws signal 已中止时优先抛出其 Error reason，否则抛出稳定错误。
 * @sideEffects 无；调用方负责先释放已持有的后端租约或清理本次对象。
 */
function throwIfVideoExecutionAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("Video generation execution was aborted");
}

/** 创作页视频价格预估所需的定价输入（前端据此按 family×时长 实时算价）。 */
export type VideoPricingInfo = {
  /** 每秒基价（VIDEO_BASE_CREDITS_PER_SECOND，缺省 30）。 */
  basePerSecond: number;
  /** 模型族倍率 map（VIDEO_MODEL_MULTIPLIERS）。 */
  multipliers: Record<string, number>;
  /** Adobe 后端计费倍率（含组倍率）；解析不到回退 1。 */
  backendMultiplier: number;
};

// 解析后端倍率用的代表性 firefly 视频 model：倍率随 Adobe 成员/组而定、与具体族无关，
// 故任取一个 firefly 视频模型即可路由到 Adobe direct 后端。
const REPRESENTATIVE_VIDEO_MODEL_ID = "firefly-sora2-8s-16x9";

/**
 * 释放视频价格预览为读取后端倍率而临时获取的并发租约。
 *
 * @param config 已解析的后端配置；非池后端或未持有租约时不执行操作。
 * @returns 租约释放完成后结束；释放异常只记录日志，价格预览继续使用降级结果。
 * @sideEffects 递减进程内并发计数，并在需要时删除数据库租约。
 */
async function releaseVideoPricingBackendLease(
  config: Awaited<ReturnType<typeof getEffectiveConfig>>["config"] | null
): Promise<void> {
  const backend = config?.backend;
  if (!backend?.inflightLease) return;

  try {
    await releaseImageBackendInflightLease({
      memberType: poolBackendMemberType(backend.type),
      memberId: backend.id,
      leaseId: backend.inflightLeaseId,
      leasePersisted: backend.inflightLeasePersisted,
    });
  } catch (error) {
    logError(error, {
      context: "release video pricing backend lease",
      backendId: backend.id,
      backendType: backend.type,
    });
  } finally {
    backend.inflightLease = false;
  }
}

/**
 * 取某用户的视频定价输入（基价 + 模型族倍率 + Adobe 后端倍率），供创作页前端实时预估。
 * 与扣费侧 runAdobeVideoGenerationForUser 共用同一组系统设置与模型定价引擎口径，
 * 保证展示价与实扣价一致。后端倍率解析失败（无 Adobe 后端等）优雅回退 1。
 */
export async function getVideoPricingForUser(input: {
  userId: string;
  apiKeyId?: string | null;
}): Promise<VideoPricingInfo> {
  const [basePerSecond, multipliersJson] = await Promise.all([
    getRuntimeSettingNumber(
      "VIDEO_BASE_CREDITS_PER_SECOND",
      DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND
    ),
    getRuntimeSettingJson("VIDEO_MODEL_MULTIPLIERS"),
  ]);
  const multipliers = parseMultipliers(multipliersJson);

  let backendMultiplier = 1;
  let leasedConfig:
    | Awaited<ReturnType<typeof getEffectiveConfig>>["config"]
    | null = null;
  try {
    const effective = await getEffectiveConfig(null, {
      userId: input.userId,
      ...(input.apiKeyId ? { apiKeyId: input.apiKeyId } : {}),
      requestKind: "image_generation",
      requestedModel: REPRESENTATIVE_VIDEO_MODEL_ID,
      ignoreUserConfig: true,
    });
    leasedConfig = effective.config;
    if (effective.config.backend?.type === "pool-adobe") {
      backendMultiplier = effective.config.backend.billingMultiplier ?? 1;
    }
  } catch {
    backendMultiplier = 1;
  } finally {
    await releaseVideoPricingBackendLease(leasedConfig);
  }

  return { basePerSecond, multipliers, backendMultiplier };
}

/**
 * 按 id 查一条 video_generation（DB 持久,供 /v1/videos/{id} 任务查询）。
 * 不带归属过滤,调用方须自行校验 userId 防越权。
 */
export async function getVideoGenerationById(id: string) {
  const rows = await db
    .select()
    .from(videoGeneration)
    .where(eq(videoGeneration.id, id))
    .limit(1);
  return rows[0] || null;
}

type PersistedVideoGeneration = NonNullable<
  Awaited<ReturnType<typeof getVideoGenerationById>>
>;

/**
 * 构造视频业务行的执行 fencing 条件。
 *
 * @param executionToken worker 租约 token；同步路径为空。
 * @returns token 精确匹配条件；同步路径只允许 NULL，不能接管 worker 行。
 * @sideEffects 无。
 */
function matchesVideoExecutionToken(executionToken?: string) {
  return executionToken
    ? eq(videoGeneration.executionToken, executionToken)
    : isNull(videoGeneration.executionToken);
}

/**
 * 校验持久视频行的用户与可选 API Key 归属。
 *
 * @param row 数据库读取的视频行。
 * @param input 当前执行主体。
 * @throws 任一归属不匹配时 fail-closed，阻断 IDOR 与跨 Key 对账。
 * @sideEffects 无。
 */
function assertVideoGenerationOwnership(
  row: PersistedVideoGeneration,
  input: { userId: string; apiKeyId?: string | null }
): void {
  if (row.userId !== input.userId) {
    throw new Error(
      "Video generation ID does not belong to the requesting user"
    );
  }
  if (input.apiKeyId !== undefined && row.apiKeyId !== input.apiKeyId) {
    throw new Error(
      "Video generation ID does not belong to the requesting API key"
    );
  }
}

/**
 * 从财务真相表读取本次视频实际扣费。
 *
 * @param userId 扣费用户。
 * @param sourceRef 视频稳定幂等键。
 * @returns 已落 consumption 的正数金额；未扣费返回 0。
 * @sideEffects 读取 credits_transaction；不依据 video_generation 展示字段猜测金额。
 */
async function getVideoConsumptionAmount(
  userId: string,
  sourceRef: string
): Promise<number> {
  const [transaction] = await db
    .select({ amount: creditsTransaction.amount })
    .from(creditsTransaction)
    .where(
      and(
        eq(creditsTransaction.userId, userId),
        eq(creditsTransaction.type, "consumption"),
        eq(creditsTransaction.sourceRef, sourceRef)
      )
    )
    .limit(1);
  const amount = Number(transaction?.amount ?? 0);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

/**
 * 结算一条已进入 recovering 的视频失败行。
 *
 * @param row 已取得失败结算所有权的视频行。
 * @param message 面向调用方与持久行的失败原因。
 * @returns failed 业务结果；若并发结算已产生终态则恢复终态赢家。
 * @throws 任一财务补偿失败时保留 recovering 并上抛，供持久任务重试。
 * @sideEffects 查询财务账本，幂等退款用户积分/API Key 配额，并条件写 failed。
 */
async function settleRecoveringVideoGeneration(
  row: PersistedVideoGeneration,
  message: string
): Promise<VideoGenerationResult> {
  const sourceRef = `adobe-video:${row.id}`;
  const consumedAmount = await getVideoConsumptionAmount(row.userId, sourceRef);
  if (consumedAmount > 0) {
    await refundGenerationCredits({
      generationId: row.id,
      userId: row.userId,
      amount: consumedAmount,
      sourceRef,
      description: `Adobe 视频生成失败退款 ${row.model}`,
      metadata: { reason: "video_generation_failed" },
    });
  }

  if (row.apiKeyId) {
    const [quotaReservation] = await db
      .select({
        amount: externalApiKeyUsage.amount,
        status: externalApiKeyUsage.status,
      })
      .from(externalApiKeyUsage)
      .where(
        and(
          eq(externalApiKeyUsage.apiKeyId, row.apiKeyId),
          eq(externalApiKeyUsage.userId, row.userId),
          eq(externalApiKeyUsage.sourceRef, sourceRef)
        )
      )
      .limit(1);
    if (quotaReservation?.status === "reserved") {
      await refundExternalApiKeyCredits({
        apiKeyId: row.apiKeyId,
        userId: row.userId,
        amount: quotaReservation.amount,
        sourceRef,
      });
    }
  }

  const completedAt = new Date();
  const [failed] = await db
    .update(videoGeneration)
    .set({
      status: "failed",
      error: message.slice(0, 1000),
      creditsConsumed: 0,
      completedAt,
      updatedAt: completedAt,
    })
    .where(
      and(
        eq(videoGeneration.id, row.id),
        eq(videoGeneration.status, "recovering"),
        matchesVideoExecutionToken(row.executionToken ?? undefined)
      )
    )
    .returning({ id: videoGeneration.id });
  if (failed) {
    return { error: message, videoGenerationId: row.id };
  }

  const existing = await getVideoGenerationById(row.id);
  if (existing) {
    assertVideoGenerationOwnership(existing, {
      userId: row.userId,
      apiKeyId: row.apiKeyId,
    });
    const recovered = recoverVideoGenerationResult(existing, {
      expectedUserId: row.userId,
      expectedApiKeyId: row.apiKeyId,
    });
    if (recovered) return recovered;
  }
  return {
    error: "Video generation failure settlement was superseded.",
    videoGenerationId: row.id,
  };
}

/**
 * 抢占普通失败路径的结算所有权后执行补偿。
 *
 * @param input 视频主体、稳定 ID 与失败原因。
 * @returns 失败结果或并发完成的终态赢家；completed 赢家绝不会被退款。
 * @sideEffects 原子 pending/running→recovering，随后执行幂等财务补偿。
 */
async function failAndSettleVideoGeneration(input: {
  videoId: string;
  userId: string;
  apiKeyId?: string | null;
  executionToken?: string;
  message: string;
}): Promise<VideoGenerationResult> {
  const claimedAt = new Date();
  const [claimed] = await db
    .update(videoGeneration)
    .set({
      status: "recovering",
      error: input.message.slice(0, 1000),
      updatedAt: claimedAt,
    })
    .where(
      and(
        eq(videoGeneration.id, input.videoId),
        inArray(videoGeneration.status, ["pending", "running"]),
        matchesVideoExecutionToken(input.executionToken)
      )
    )
    .returning();
  const row = claimed ?? (await getVideoGenerationById(input.videoId));
  if (!row) {
    return {
      error: "Video generation disappeared during failure settlement.",
      videoGenerationId: input.videoId,
    };
  }
  assertVideoGenerationOwnership(row, input);
  if (row.status === "recovering") {
    return await settleRecoveringVideoGeneration(row, input.message);
  }
  const recovered = recoverVideoGenerationResult(row, {
    expectedUserId: input.userId,
    ...(input.apiKeyId !== undefined
      ? { expectedApiKeyId: input.apiKeyId }
      : {}),
  });
  return (
    recovered ?? {
      error: "Video generation failure settlement was superseded.",
      videoGenerationId: input.videoId,
    }
  );
}

/**
 * 接管超时视频并完成可重入财务补偿。
 *
 * @param input 当前用户、可选 API Key 与稳定 video_generation ID。
 * @param options 可注入时钟和超时窗口；生产默认 20 分钟。
 * @returns fresh pending/running 或不存在时返回 undefined；终态直接恢复；超时行收敛
 * 为 failed 且 creditsConsumed=0。
 * @throws 归属不匹配或财务补偿失败时上抛；recovering 保留供下次重入。
 * @sideEffects 原子把超时 pending/running 置 recovering，查询账本并幂等退款。
 */
export async function recoverStaleVideoGeneration(
  input: {
    videoGenerationId: string;
    userId: string;
    apiKeyId?: string | null;
    executionToken?: string;
  },
  options: { now?: Date; timeoutMs?: number } = {}
): Promise<VideoGenerationResult | undefined> {
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? VIDEO_GENERATION_RECOVERY_TIMEOUT_MS;
  let row = await getVideoGenerationById(input.videoGenerationId);
  if (!row) return undefined;
  assertVideoGenerationOwnership(row, input);

  const recovered = recoverVideoGenerationResult(row, {
    expectedUserId: input.userId,
    ...(input.apiKeyId !== undefined
      ? { expectedApiKeyId: input.apiKeyId }
      : {}),
  });
  if (recovered) return recovered;
  if (
    !videoGenerationNeedsRecovery(row, {
      nowMs: now.getTime(),
      timeoutMs,
    })
  ) {
    return undefined;
  }

  if (row.status !== "recovering") {
    const cutoff = new Date(now.getTime() - timeoutMs);
    const [claimed] = await db
      .update(videoGeneration)
      .set({
        status: "recovering",
        executionToken: input.executionToken ?? null,
        error: "视频生成执行超时，已进入补偿流程",
        updatedAt: now,
      })
      .where(
        and(
          eq(videoGeneration.id, row.id),
          inArray(videoGeneration.status, ["pending", "running"]),
          matchesVideoExecutionToken(row.executionToken ?? undefined),
          lte(videoGeneration.updatedAt, cutoff)
        )
      )
      .returning();
    row = claimed ?? (await getVideoGenerationById(row.id));
    if (!row) return undefined;
    assertVideoGenerationOwnership(row, input);
    if (row.status !== "recovering") {
      return recoverVideoGenerationResult(row, {
        expectedUserId: input.userId,
        ...(input.apiKeyId !== undefined
          ? { expectedApiKeyId: input.apiKeyId }
          : {}),
      });
    }
  } else if (
    input.executionToken &&
    row.executionToken !== input.executionToken
  ) {
    const [reclaimed] = await db
      .update(videoGeneration)
      .set({ executionToken: input.executionToken, updatedAt: now })
      .where(
        and(
          eq(videoGeneration.id, row.id),
          eq(videoGeneration.status, "recovering"),
          matchesVideoExecutionToken(row.executionToken ?? undefined)
        )
      )
      .returning();
    row = reclaimed ?? (await getVideoGenerationById(row.id));
    if (!row) return undefined;
    assertVideoGenerationOwnership(row, input);
  }

  return await settleRecoveringVideoGeneration(
    row,
    "视频生成执行超时，已退款，请重试"
  );
}

async function markVideoFailed(
  id: string,
  error: string,
  executionToken?: string
): Promise<void> {
  const failedAt = new Date();
  await db
    .update(videoGeneration)
    .set({
      status: "failed",
      error: error.slice(0, 1000),
      creditsConsumed: 0,
      completedAt: failedAt,
      updatedAt: failedAt,
    })
    .where(
      and(
        eq(videoGeneration.id, id),
        inArray(videoGeneration.status, ["pending", "running"]),
        matchesVideoExecutionToken(executionToken)
      )
    );
}

/**
 * 跑一次 Adobe Firefly 视频生成（含计费与持久化）。
 */
export async function runAdobeVideoGenerationForUser(
  input: VideoGenerationInput
): Promise<VideoGenerationResult> {
  const videoId = input.videoGenerationId || nanoid();
  throwIfVideoExecutionAborted(input.signal);
  let resumedExisting = false;
  if (input.videoGenerationId) {
    const existing = await getVideoGenerationById(videoId);
    if (existing) {
      const recovered = recoverVideoGenerationResult(existing, {
        expectedUserId: input.userId,
        ...(input.apiKeyId !== undefined
          ? { expectedApiKeyId: input.apiKeyId }
          : {}),
      });
      if (recovered) return recovered;
      if (
        input.executionToken &&
        (existing.status === "pending" || existing.status === "running")
      ) {
        if (
          existing.model !== input.model ||
          existing.prompt !== input.prompt
        ) {
          throw new Error(
            "Video generation retry payload does not match the persisted row"
          );
        }
        if (existing.executionToken === input.executionToken) {
          resumedExisting = true;
        } else {
          const [claimed] = await db
            .update(videoGeneration)
            .set({
              executionToken: input.executionToken,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(videoGeneration.id, videoId),
                inArray(videoGeneration.status, ["pending", "running"]),
                matchesVideoExecutionToken(existing.executionToken ?? undefined)
              )
            )
            .returning({ id: videoGeneration.id });
          resumedExisting = Boolean(claimed);
        }
      }
      if (resumedExisting) {
        throwIfVideoExecutionAborted(input.signal);
      } else {
        const staleRecovery = await recoverStaleVideoGeneration({
          videoGenerationId: videoId,
          userId: input.userId,
          ...(input.apiKeyId !== undefined ? { apiKeyId: input.apiKeyId } : {}),
          ...(input.executionToken
            ? { executionToken: input.executionToken }
            : {}),
        });
        return (
          staleRecovery ?? {
            error: "Video generation is already processing.",
            videoGenerationId: videoId,
          }
        );
      }
    }
  }
  if (!(await isOperationFeatureEnabled("video"))) {
    return { error: "Video generation is disabled by the operator." };
  }

  const conf = resolveFireflyVideoModel(input.model);
  if (!conf) {
    return { error: `不支持的视频模型: ${input.model}` };
  }

  // 算价输入：每秒基价、模型族倍率与后端倍率在后续通过统一模型定价引擎结算。
  const basePerSecond = await getRuntimeSettingNumber(
    "VIDEO_BASE_CREDITS_PER_SECOND",
    DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND
  );
  const multipliers = parseMultipliers(
    await getRuntimeSettingJson("VIDEO_MODEL_MULTIPLIERS")
  );
  const modelMultiplier = resolveVideoModelMultiplier(conf.family, multipliers);

  // 扣费/退款幂等键：派生自服务端 videoId，全局唯一。
  const sourceRef = `adobe-video:${videoId}`;
  const now = new Date();

  if (!resumedExisting) {
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
      executionToken: input.executionToken ?? null,
      creditsConsumed: 0,
      ...(input.inputImageRefs?.length
        ? { inputImageRefs: input.inputImageRefs }
        : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
  throwIfVideoExecutionAborted(input.signal);

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
    throwIfVideoExecutionAborted(input.signal);
    await markVideoFailed(
      videoId,
      error instanceof Error ? error.message : "无可用后端",
      input.executionToken
    );
    return { error: "无可用 Adobe 视频后端", videoGenerationId: videoId };
  }

  // getEffectiveConfig 已为命中成员获取 inflight 租约(进程内计数 + DB 租约)。视频管线
  // 必须在所有退出路径释放——否则进程内 inflight 只增不减,堆到 concurrency 上限后该后端
  // 被 hasBackendCapacity 判为满载、彻底踢出候选,后续视频请求一律解析失败为"无可用
  // Adobe 视频后端"(2026-06-22 定位:视频管线缺租约释放的泄漏,图像管线有
  // releasePoolBackendConfigLease,视频侧此前完全没有)。幂等:释放后置 inflightLease=false。
  const releaseInflightLease = async () => {
    const backend = config.backend;
    if (backend?.inflightLease) {
      await releaseImageBackendInflightLease({
        memberType: poolBackendMemberType(backend.type),
        memberId: backend.id,
        leaseId: backend.inflightLeaseId,
        leasePersisted: backend.inflightLeasePersisted,
      }).catch((error) =>
        logError(error, { source: "adobe-video-lease-release", videoId })
      );
      backend.inflightLease = false;
    }
  };
  /** 释放后端租约后检查 task fencing signal，旧执行者只退出、不结算业务终态。 */
  const ensureExecutionActive = async (): Promise<void> => {
    if (!input.signal?.aborted) return;
    await releaseInflightLease();
    throwIfVideoExecutionAborted(input.signal);
  };

  await ensureExecutionActive();

  if (
    config.backend?.type !== "pool-adobe" ||
    config.backend.adobeMode !== "direct"
  ) {
    await releaseInflightLease();
    await markVideoFailed(
      videoId,
      "命中后端非 Adobe 直连",
      input.executionToken
    );
    return {
      error: "视频生成需要一个 Adobe 直连(direct)后端",
      videoGenerationId: videoId,
    };
  }

  // 实际计费成本由统一模型定价引擎计算；视频旧口径为 base 先向上取 2 位，再叠
  // 后端计费倍率（组倍率已在池解析时合入 billingMultiplier）并向上取整。
  const pricing = resolveVideoModelPricing({
    model: input.model,
    family: conf.family,
    durationSeconds: conf.duration,
    basePerSecond,
    modelMultiplier,
    backendMultiplier: config.backend?.billingMultiplier,
    groupId: config.backend?.billingGroupId,
  });
  const billedCost = pricing.finalCredits;
  await ensureExecutionActive();

  // 在任何财务副作用前持久化本次执行的计价快照。video_generation 只是展示与恢复
  // 线索，真实是否扣费仍只从 credits_transaction 判断；这样进程若在预占或扣费之间
  // 崩溃，恢复器既知道应检查哪个额度金额，又不会凭展示字段错误发放用户退款。
  const runningAt = new Date();
  const [running] = await db
    .update(videoGeneration)
    .set({
      status: "running",
      creditsConsumed: billedCost,
      metadata: {
        pricingEngine: "model-pricing",
        pricingSnapshot: pricing.pricingSnapshot,
        baseCostCredits: pricing.baseCostCredits,
        modelMultiplier,
        backendMultiplier: config.backend?.billingMultiplier ?? 1,
      },
      updatedAt: runningAt,
    })
    .where(
      and(
        eq(videoGeneration.id, videoId),
        inArray(videoGeneration.status, ["pending", "running"]),
        matchesVideoExecutionToken(input.executionToken)
      )
    )
    .returning({ id: videoGeneration.id });
  if (!running) {
    await releaseInflightLease();
    const existing = await getVideoGenerationById(videoId);
    const recovered = existing
      ? recoverVideoGenerationResult(existing, {
          expectedUserId: input.userId,
          ...(input.apiKeyId !== undefined
            ? { expectedApiKeyId: input.apiKeyId }
            : {}),
        })
      : undefined;
    return (
      recovered ?? {
        error: "Video generation execution was superseded.",
        videoGenerationId: videoId,
      }
    );
  }
  await ensureExecutionActive();

  // 预扣积分（幂等 sourceRef）。不足/失败 → 标记 failed 返回。
  try {
    await reserveExternalApiKeyCredits({
      apiKeyId: input.apiKeyId ?? undefined,
      userId: input.userId,
      amount: billedCost,
      sourceRef,
    });
  } catch (error) {
    if (input.signal?.aborted) {
      await ensureExecutionActive();
    }
    await releaseInflightLease();
    return await failAndSettleVideoGeneration({
      videoId,
      userId: input.userId,
      ...(input.apiKeyId !== undefined ? { apiKeyId: input.apiKeyId } : {}),
      ...(input.executionToken ? { executionToken: input.executionToken } : {}),
      message: error instanceof Error ? error.message : "API Key 额度不足",
    });
  }
  await ensureExecutionActive();
  try {
    await consumeCredits({
      userId: input.userId,
      amount: billedCost,
      serviceName: "adobe-video",
      description: `Adobe 视频生成 ${input.model}`,
      sourceRef,
      metadata: {
        videoGenerationId: videoId,
        model: input.model,
        pricingEngine: "model-pricing",
        pricingSnapshot: pricing.pricingSnapshot,
        baseCostCredits: pricing.baseCostCredits,
        modelMultiplier,
        backendMultiplier: config.backend?.billingMultiplier ?? 1,
        durationSeconds: conf.duration,
        ...(input.apiKeyId ? { externalApiKeyId: input.apiKeyId } : {}),
      },
    });
  } catch (error) {
    if (input.signal?.aborted) {
      await ensureExecutionActive();
    }
    await releaseInflightLease();
    return await failAndSettleVideoGeneration({
      videoId,
      userId: input.userId,
      ...(input.apiKeyId !== undefined ? { apiKeyId: input.apiKeyId } : {}),
      ...(input.executionToken ? { executionToken: input.executionToken } : {}),
      message: error instanceof Error ? error.message : "积分不足",
    });
  }
  await ensureExecutionActive();

  // 失败先取得 recovering 所有权，再执行幂等退款；completed 赢家不会被旧执行退款。
  const failAndRefund = async (
    message: string
  ): Promise<VideoGenerationResult> => {
    await releaseInflightLease();
    throwIfVideoExecutionAborted(input.signal);
    return await failAndSettleVideoGeneration({
      videoId,
      userId: input.userId,
      ...(input.apiKeyId !== undefined ? { apiKeyId: input.apiKeyId } : {}),
      ...(input.executionToken ? { executionToken: input.executionToken } : {}),
      message,
    });
  };

  // 派发（submit→轮询→下载）。
  let result: Awaited<ReturnType<typeof runAdobeDirectVideoRequest>>;
  try {
    result = await runAdobeDirectVideoRequest(config, {
      prompt: input.prompt,
      model: input.model,
      ...(input.inputImages ? { inputImages: input.inputImages } : {}),
      ...(input.negativePrompt != null
        ? { negativePrompt: input.negativePrompt }
        : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    await releaseInflightLease();
    throwIfVideoExecutionAborted(input.signal);
    return await failAndSettleVideoGeneration({
      videoId,
      userId: input.userId,
      ...(input.apiKeyId !== undefined ? { apiKeyId: input.apiKeyId } : {}),
      ...(input.executionToken ? { executionToken: input.executionToken } : {}),
      message: error instanceof Error ? error.message : "视频生成上游异常",
    });
  }
  await ensureExecutionActive();
  if ("error" in result) {
    return failAndRefund(result.error);
  }

  // re-host 视频到对象存储。
  const bucket =
    (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
    "generations";
  const storageKey = `${input.userId}/${nanoid(32)}.mp4`;
  /** 删除本次执行产生但未取得终态所有权的视频对象。 */
  const cleanupStaleOutput = async (): Promise<void> => {
    await getStorageProvider()
      .then((storage) => storage.deleteObject(storageKey, bucket))
      .catch((error: unknown) =>
        logError(error, { source: "adobe-video-stale-output-cleanup", videoId })
      );
  };
  await ensureExecutionActive();
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
    if (input.signal?.aborted) {
      await ensureExecutionActive();
    }
    return failAndRefund("视频已生成但存储失败，已退款，请重试");
  }
  if (input.signal?.aborted) {
    await cleanupStaleOutput();
    await ensureExecutionActive();
  }

  const completedAt = new Date();
  let completed: { id: string } | undefined;
  try {
    [completed] = await db
      .update(videoGeneration)
      .set({
        status: "completed",
        storageKey,
        metadata: sql`COALESCE(${videoGeneration.metadata}, '{}'::json)::jsonb || ${JSON.stringify(
          { storageBucket: bucket }
        )}::jsonb`,
        completedAt,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(videoGeneration.id, videoId),
          inArray(videoGeneration.status, ["pending", "running"]),
          matchesVideoExecutionToken(input.executionToken)
        )
      )
      .returning({ id: videoGeneration.id });
  } catch (error) {
    await cleanupStaleOutput();
    throw error;
  } finally {
    await releaseInflightLease();
  }
  if (!completed) {
    await cleanupStaleOutput();
    const existing = await getVideoGenerationById(videoId);
    const recovered = existing
      ? recoverVideoGenerationResult(existing, {
          expectedUserId: input.userId,
          ...(input.apiKeyId !== undefined
            ? { expectedApiKeyId: input.apiKeyId }
            : {}),
        })
      : undefined;
    if (recovered) return recovered;
    return {
      error: "Video generation execution was superseded.",
      videoGenerationId: videoId,
    };
  }

  invalidateGalleryCountsCache(input.userId);
  return {
    videoGenerationId: videoId,
    storageKey,
    creditsConsumed: billedCost,
  };
}
