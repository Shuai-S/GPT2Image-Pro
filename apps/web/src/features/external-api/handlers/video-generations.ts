/**
 * v1 视频生成端点 handler（外部 API）。
 *
 * 鉴权（外部 API key）→ 校验 Firefly 视频模型 → runAdobeVideoGenerationForUser（含幂等
 * 扣费/落库/re-host）→ 返回 OpenAI-images 风格响应（data[].url 为产物视频 URL）。视频是
 * 长任务，复用 createJsonKeepAliveResponse 撑住连接；operation 内出错则 throw，由其转成带
 * 状态的 OpenAI 错误响应。
 */

import { withApiLogging } from "@repo/shared/api-logger";
import { isFireflyVideoModelId } from "@repo/shared/adobe/firefly-direct/video-catalog";
import { canUsePlanCapability } from "@repo/shared/subscription/services/plan-capabilities";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { authenticateExternalApiRequest } from "@/features/external-api/auth";
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
});

function decodeImageDataUrl(value: string): { data: Buffer; type: string } {
  const match = value.match(/^data:(image\/[a-zA-Z.+-]+);base64,(.*)$/);
  const type = match?.[1] || "image/png";
  const base64 = match?.[2] || "";
  return { data: Buffer.from(base64, "base64"), type };
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

    const inputImages = parsed.data.image?.map(decodeImageDataUrl);
    const negativePrompt =
      parsed.data.negativePrompt ?? parsed.data.negative_prompt;

    return createJsonKeepAliveResponse(
      async () => {
        const result = await runAdobeVideoGenerationForUser({
          userId: auth.userId,
          apiKeyId: auth.apiKeyId,
          prompt: parsed.data.prompt,
          model: parsed.data.model,
          ...(negativePrompt ? { negativePrompt } : {}),
          ...(inputImages?.length ? { inputImages } : {}),
          signal: request.signal,
        });
        if ("error" in result) {
          // 由 createJsonKeepAliveResponse 转成带状态的 OpenAI 错误响应。
          throw new Error(result.error);
        }
        const bucket =
          (await getRuntimeSettingString(
            "NEXT_PUBLIC_GENERATIONS_BUCKET_NAME"
          )) || "generations";
        return {
          created: Math.floor(Date.now() / 1000),
          model: parsed.data.model,
          data: [
            {
              url:
                buildSignedStorageImageUrl(result.storageKey, bucket) ?? "",
            },
          ],
          credits_consumed: result.creditsConsumed,
        };
      },
      { initialWaitMs: IMAGE_JSON_KEEP_ALIVE_INITIAL_WAIT_MS }
    );
  }
);
