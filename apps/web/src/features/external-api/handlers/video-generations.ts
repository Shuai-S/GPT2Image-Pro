/**
 * v1 视频生成端点 handler（外部 API）。
 *
 * 鉴权（外部 API key）→ 校验 Firefly 视频模型 → runAdobeVideoGenerationForUser（含幂等
 * 扣费/落库/re-host）→ 返回 OpenAI-images 风格响应（data[].url 为产物视频 URL）。视频是
 * 长任务，复用 createJsonKeepAliveResponse 撑住连接；operation 内出错则 throw，由其转成带
 * 状态的 OpenAI 错误响应。
 */

import { isFireflyVideoModelId } from "@repo/shared/adobe/firefly-direct/video-catalog";
import { withApiLogging } from "@repo/shared/api-logger";
import { logError } from "@repo/shared/logger";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import {
  canUsePlanCapability,
  getPlanQueueSettings,
} from "@repo/shared/subscription/services/plan-capabilities";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { nanoid } from "nanoid";
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  toAsyncImageTaskResponse,
  validateCallbackUrl,
} from "@/features/external-api/async-image-tasks";
import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import {
  GenerationTaskConflictError,
  GenerationTaskIdempotencyKeyError,
  readGenerationIdempotencyKey,
} from "@/features/external-api/generation-task-idempotency";
import type { GenerationTaskInputObject } from "@/features/external-api/generation-task-input";
import { enqueueGenerationTask } from "@/features/external-api/generation-task-service";
import {
  createJsonKeepAliveResponse,
  IMAGE_JSON_KEEP_ALIVE_INITIAL_WAIT_MS,
  openAIImageError,
} from "@/features/external-api/images";
import {
  IMAGE_PROMPT_MAX_CHARACTERS,
  IMAGE_PROMPT_TOO_LONG_MESSAGE,
} from "@/features/image-generation/resolution";
import { runAdobeVideoGenerationForUser } from "@/features/image-generation/video-operations";

const inputImageSchema = z
  .string()
  .min(1)
  .max(20_000_000)
  .regex(/^data:image\/[a-zA-Z.+-]+;base64,/, "Invalid image data URL");

const externalVideoSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(IMAGE_PROMPT_MAX_CHARACTERS, IMAGE_PROMPT_TOO_LONG_MESSAGE),
  // 完整 Firefly 视频 model id：firefly-<family>-<dur>s-<ratio>[-<res>]。
  model: z.string().trim().min(1).max(120),
  negativePrompt: z.string().max(8000).optional(),
  negative_prompt: z.string().max(8000).optional(),
  // 图生视频输入图（base64 data URL，首帧/尾帧/参考），最多 3 张。
  image: z.array(inputImageSchema).max(3).optional(),
  // 异步开关（视频是长任务，建议异步）：立即返回 task_...，后台生成，凭 task_id 或
  // generation_id 轮询 GET /v1/videos/{id}；可选 callback_url 完成回调。
  async: z.boolean().optional(),
  callback_url: z.string().url().max(2048).optional(),
  callbackUrl: z.string().url().max(2048).optional(),
});

/**
 * 解码已通过外部请求 schema 限长和格式校验的图片 data URL。
 *
 * @param value 以 image MIME 开头的 base64 data URL。
 * @returns 解码后的媒体字节与 MIME；正则不匹配时返回空 PNG，由后续大小校验拒绝。
 * @sideEffects 分配有界 Buffer，不访问网络或存储。
 */
function decodeImageDataUrl(value: string): { data: Buffer; type: string } {
  const match = value.match(/^data:(image\/[a-zA-Z.+-]+);base64,(.*)$/);
  const type = match?.[1] || "image/png";
  const base64 = match?.[2] || "";
  return { data: Buffer.from(base64, "base64"), type };
}

/**
 * 把视频输入图按 API 顺序映射为首帧、尾帧与参考图对象。
 *
 * @param images 已解码且最多三项的图片输入。
 * @returns 可交给持久入队服务写对象存储的有序媒体。
 * @sideEffects 无；Buffer 由返回对象共享，不复制正文。
 */
function toVideoTaskMediaInputs(
  images: readonly { data: Buffer; type: string }[]
): GenerationTaskInputObject[] {
  const roles = ["first", "last", "reference"] as const;
  return images.map((image, index) => ({
    data: image.data,
    name: `video-input-${index + 1}.img`,
    contentType: image.type,
    role: roles[index] ?? "reference",
  }));
}

export const postExternalVideoGenerations = withApiLogging(
  async (request: NextRequest) => {
    const auth = await authenticateExternalApiRequest(request);
    if (!auth) {
      return openAIImageError(
        "Invalid or missing API key",
        401,
        "invalid_api_key"
      );
    }
    if (
      !(await canUsePlanCapability(auth.plan, "externalApi.images.generate"))
    ) {
      return openAIImageError(
        "External video generation is not enabled for this plan.",
        403,
        "insufficient_plan"
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return openAIImageError("Invalid JSON body");
    }

    const parsed = externalVideoSchema.safeParse(body);
    if (!parsed.success) {
      return openAIImageError(
        parsed.error.issues[0]?.message || "Invalid request"
      );
    }
    if (!isFireflyVideoModelId(parsed.data.model)) {
      return openAIImageError(
        "Unsupported video model. Use a firefly-<family>-<dur>s-<ratio>[-<res>] id; see /v1/models."
      );
    }

    const negativePrompt =
      parsed.data.negativePrompt ?? parsed.data.negative_prompt;

    const useAsync =
      parsed.data.async === true ||
      request.nextUrl.searchParams.get("async") === "true";
    if (useAsync && auth.relayOnly) {
      return openAIImageError(
        "Relay-only API keys cannot use persisted async generation.",
        400,
        "unsupported_async_mode"
      );
    }
    let clientRequestId: string | undefined;
    if (useAsync) {
      try {
        clientRequestId = readGenerationIdempotencyKey(request);
      } catch (error) {
        if (error instanceof GenerationTaskIdempotencyKeyError) {
          return openAIImageError(
            error.message,
            400,
            "invalid_idempotency_key"
          );
        }
        throw error;
      }
    }
    const inputImages = parsed.data.image?.map(decodeImageDataUrl);
    let callbackUrl: string | undefined;
    if (parsed.data.callback_url || parsed.data.callbackUrl) {
      try {
        callbackUrl = await validateCallbackUrl(
          (parsed.data.callback_url || parsed.data.callbackUrl) as string
        );
      } catch (error) {
        return openAIImageError(
          error instanceof Error ? error.message : "Invalid callback_url."
        );
      }
    }

    const runInput = {
      userId: auth.userId,
      resolvedUserPlan: auth.plan,
      apiKeyId: auth.apiKeyId,
      prompt: parsed.data.prompt,
      model: parsed.data.model,
      ...(negativePrompt ? { negativePrompt } : {}),
      ...(inputImages?.length ? { inputImages } : {}),
    };
    const bucketName = async () =>
      (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
      "generations";

    // 异步仅持久化严格标量和对象引用；worker 用 lease token 创建/接管业务行。
    if (useAsync) {
      const videoId = nanoid();
      try {
        const queueSettings = await getPlanQueueSettings(auth.plan);
        const task = await enqueueGenerationTask({
          userId: auth.userId,
          apiKeyId: auth.apiKeyId,
          relayOnly: auth.relayOnly,
          ...(clientRequestId ? { clientRequestId } : {}),
          callbackUrl,
          priority: queueSettings.priority,
          userConcurrency: queueSettings.userConcurrency,
          request: {
            kind: "video",
            generationId: videoId,
            createdAtEpochSeconds: Math.floor(Date.now() / 1000),
            input: {
              prompt: parsed.data.prompt,
              model: parsed.data.model,
              ...(negativePrompt ? { negativePrompt } : {}),
            },
          },
          mediaInputs: toVideoTaskMediaInputs(inputImages ?? []),
        });
        return Response.json(toAsyncImageTaskResponse(task), {
          headers: { "Cache-Control": "no-store" },
        });
      } catch (error) {
        if (error instanceof GenerationTaskConflictError) {
          return openAIImageError(
            error.message,
            409,
            "idempotency_key_conflict"
          );
        }
        logError(error, {
          source: "external-api-video-enqueue",
          userId: auth.userId,
        });
        return openAIImageError(
          "Video generation queue is temporarily unavailable.",
          503,
          "queue_unavailable"
        );
      }
    }

    // 同步：keep-alive 撑住长连接,跑完直接返回视频 URL(并带 generation_id 便于后续复查)。
    return createJsonKeepAliveResponse(
      async () => {
        const result = await runAdobeVideoGenerationForUser({
          ...runInput,
          signal: request.signal,
        });
        if ("error" in result) {
          // 由 createJsonKeepAliveResponse 转成带状态的 OpenAI 错误响应。
          throw new Error(result.error);
        }
        const bucket = await bucketName();
        return {
          created: Math.floor(Date.now() / 1000),
          model: parsed.data.model,
          data: [
            {
              url: buildSignedStorageImageUrl(result.storageKey, bucket) ?? "",
            },
          ],
          generation_id: result.videoGenerationId,
          generationId: result.videoGenerationId,
          credits_consumed: result.creditsConsumed,
        };
      },
      { initialWaitMs: IMAGE_JSON_KEEP_ALIVE_INITIAL_WAIT_MS }
    );
  }
);
