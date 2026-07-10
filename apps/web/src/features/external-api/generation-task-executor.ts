/**
 * 持久 generation task 到单一图像/视频业务管线的生产执行适配。
 *
 * 职责：把严格 request payload、当前执行身份和对象存储输入映射为既有管线参数，
 * 强制透传 task leaseToken 作为 executionToken 与同一个 AbortSignal。终态判定不在本层，
 * 调用方必须在函数返回后重新查询 generation/video_generation。
 */

import { runImageGenerationForUser } from "@/features/image-generation/operations";
import { runAdobeVideoGenerationForUser } from "@/features/image-generation/video-operations";
import type { LoadedGenerationTaskInput } from "./generation-task-input";
import type { GenerationTaskResolverDependencies } from "./generation-task-resolver";

/** 把持久对象输入恢复成统一图像管线的 ImageInputFile。 */
function toImageInput(input: LoadedGenerationTaskInput) {
  return {
    data: input.data,
    name: input.name,
    type: input.contentType,
    storageBucket: input.bucket,
    storageKey: input.key,
  };
}

/**
 * 执行一个严格 image_generate/image_edit generation ID。
 *
 * @param input task、当前身份、媒体、lease token 与 AbortSignal。
 * @returns 业务函数返回后结束；不把返回对象解释成 task 终态。
 * @throws 输入角色非法、租约中止或统一图像管线异常时向上抛。
 * @sideEffects 可能调用上游、扣费、写 generation 与对象存储；均由统一管线负责。
 */
export async function runGenerationTaskImage(
  input: Parameters<GenerationTaskResolverDependencies["runImage"]>[0]
): Promise<void> {
  const common = {
    ...input.request.input,
    userId: input.row.userId,
    resolvedUserPlan: input.context.plan,
    generationId: input.generationId,
    apiKeyId: input.row.apiKeyId ?? undefined,
    executionToken: input.executionToken,
    relayOnly: false,
    moderationBlockRiskLevel: input.context.moderationBlockRiskLevel,
    signal: input.signal,
  };
  if (input.request.kind === "image_generate") {
    await runImageGenerationForUser({
      ...common,
      mode: "generate",
      backendRequestKind: "image_generation",
    });
    return;
  }

  const sources = input.inputs
    .filter((entry) => entry.role === "source")
    .map(toImageInput);
  const masks = input.inputs
    .filter((entry) => entry.role === "mask")
    .map(toImageInput);
  if (sources.length === 0 || masks.length > 1) {
    throw new Error("Persisted image edit inputs are invalid");
  }
  await runImageGenerationForUser({
    ...common,
    mode: "edit",
    backendRequestKind: "image_edit",
    images: sources,
    ...(masks[0] ? { mask: masks[0] } : {}),
    n: 1,
  });
}

/**
 * 执行一个严格 video generation ID。
 *
 * @param input task、当前身份、媒体、lease token 与 AbortSignal。
 * @returns 业务函数返回后结束；不把返回对象解释成 task 终态。
 * @throws 租约中止、持久输入或统一视频管线异常时向上抛。
 * @sideEffects 可能调用 Adobe、扣费、补偿并写对象存储/视频业务行。
 */
export async function runGenerationTaskVideo(
  input: Parameters<GenerationTaskResolverDependencies["runVideo"]>[0]
): Promise<void> {
  await runAdobeVideoGenerationForUser({
    userId: input.row.userId,
    apiKeyId: input.row.apiKeyId,
    executionToken: input.executionToken,
    videoGenerationId: input.request.generationId,
    prompt: input.request.input.prompt,
    model: input.request.input.model,
    ...(input.request.input.negativePrompt
      ? { negativePrompt: input.request.input.negativePrompt }
      : {}),
    ...(input.inputs.length > 0
      ? {
          inputImages: input.inputs.map((entry) => ({
            data: entry.data,
            type: entry.contentType,
          })),
          inputImageRefs: input.inputs.map((entry) => ({
            storageKey: entry.key,
            role: entry.role,
          })),
        }
      : {}),
    signal: input.signal,
  });
}
