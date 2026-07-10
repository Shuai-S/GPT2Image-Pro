/**
 * Adobe Firefly 视频生成路由（创作页用）。
 *
 * 视频是长任务（最长 ~600s），普通阻塞请求会被反代/Cloudflare 掐断，故复用图像生成的
 * SSE 机制（createImageStreamResponse）：keep-alive 撑住连接，operation 跑完后推 completed
 * 事件（含产物 video URL）或 error。鉴权 → 解析 → runAdobeVideoGenerationForUser。
 */

import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  IMAGE_PROMPT_MAX_CHARACTERS,
  IMAGE_PROMPT_TOO_LONG_MESSAGE,
} from "@/features/image-generation/resolution";
import { createImageStreamResponse } from "@/features/image-generation/streaming";
import { runAdobeVideoGenerationForUser } from "@/features/image-generation/video-operations";

// 输入图：base64 data URL（图生视频首帧/尾帧/参考），最多 3 张。
const inputImageSchema = z
  .string()
  .min(1)
  .max(20_000_000)
  .regex(/^data:image\/[a-zA-Z.+-]+;base64,/, "Invalid image data URL");

const generateVideoSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(IMAGE_PROMPT_MAX_CHARACTERS, IMAGE_PROMPT_TOO_LONG_MESSAGE),
  model: z.string().trim().min(1).max(120),
  negativePrompt: z.string().max(8000).optional(),
  inputImages: z.array(inputImageSchema).max(3).optional(),
  inputImageRefs: z
    .array(
      z.object({
        generationId: z.string().trim().max(128).optional(),
        storageKey: z.string().trim().max(256).optional(),
        role: z.string().trim().max(32).optional(),
      })
    )
    .max(3)
    .optional(),
});

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// data URL → { data, type }。
function decodeImageDataUrl(value: string): { data: Buffer; type: string } {
  const match = value.match(/^data:(image\/[a-zA-Z.+-]+);base64,(.*)$/);
  const type = match?.[1] || "image/png";
  const base64 = match?.[2] || "";
  return { data: Buffer.from(base64, "base64"), type };
}

export const POST = withApiLogging(async (request: NextRequest) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return errorResponse("Unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const parsed = generateVideoSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message || "Invalid request");
  }

  const userId = session.user.id;
  const inputImages = parsed.data.inputImages?.map(decodeImageDataUrl);
  const [resolvedUserPlan, bucketSetting] = await Promise.all([
    getUserPlan(userId),
    getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME"),
  ]);
  const bucket = bucketSetting || "generations";

  return createImageStreamResponse(async (emit) => {
    const result = await runAdobeVideoGenerationForUser({
      userId,
      resolvedUserPlan: resolvedUserPlan.plan,
      prompt: parsed.data.prompt,
      model: parsed.data.model,
      ...(parsed.data.negativePrompt
        ? { negativePrompt: parsed.data.negativePrompt }
        : {}),
      ...(inputImages?.length ? { inputImages } : {}),
      ...(parsed.data.inputImageRefs?.length
        ? { inputImageRefs: parsed.data.inputImageRefs }
        : {}),
      signal: request.signal,
    });

    if ("error" in result) {
      await emit({
        type: "error",
        error: result.error,
        ...(result.videoGenerationId
          ? { generationId: result.videoGenerationId }
          : {}),
      });
      return null;
    }

    await emit({
      type: "completed",
      videoGenerationId: result.videoGenerationId,
      videoUrl:
        buildSignedStorageImageUrl(result.storageKey, bucket) ?? undefined,
      creditsConsumed: result.creditsConsumed,
    });
    return null;
  });
});
