/**
 * 普通图像与视频持久任务入队服务。
 *
 * 职责：生成 task ID，把媒体字节转存到任务专属对象前缀，并以严格 request payload
 * 创建 queued 外壳。外部 API Route 只调用本服务，不得再启动进程内后台闭包。
 */

import { randomUUID } from "node:crypto";
import type { QueuePriority } from "@repo/shared/config/subscription-plan";

import { type AsyncImageTask, createAsyncImageTask } from "./async-image-tasks";
import {
  cleanupGenerationTaskInputs,
  type GenerationTaskInputObject,
  type GenerationTaskRequestPayload,
  generationTaskRequestPayloadSchema,
  storeGenerationTaskInputs,
} from "./generation-task-input";

type ImageGenerateTaskRequest = Omit<
  Extract<GenerationTaskRequestPayload, { kind: "image_generate" }>,
  "relayOnly"
>;

type ImageEditTaskRequest = Omit<
  Extract<GenerationTaskRequestPayload, { kind: "image_edit" }>,
  "relayOnly" | "inputReferences"
>;

type VideoTaskRequest = Omit<
  Extract<GenerationTaskRequestPayload, { kind: "video" }>,
  "relayOnly" | "inputReferences"
>;

export type EnqueueGenerationTaskRequest =
  | ImageGenerateTaskRequest
  | ImageEditTaskRequest
  | VideoTaskRequest;

/** 把套餐队列等级映射为数据库可排序整数。 */
function queuePriorityValue(priority: QueuePriority): number {
  if (priority === "highest") return 2;
  if (priority === "priority") return 1;
  return 0;
}

/** 从请求类型提取任务外壳使用的 generation ID 列表。 */
function generationIdsForRequest(
  request: EnqueueGenerationTaskRequest
): string[] {
  return request.kind === "video"
    ? [request.generationId]
    : [...request.generationIds];
}

/**
 * 创建一个可跨进程恢复的普通 generation 任务。
 *
 * @param input 已鉴权归属、套餐队列设置、严格标量请求与已校验媒体 Buffer。
 * @returns 可直接映射为外部 API 创建响应的 processing 任务。
 * @throws 媒体存储、payload 校验或数据库插入失败时抛错；插入失败会先清理已写对象。
 * @sideEffects 写对象存储并插入 external_async_task queued 行。
 */
export async function enqueueGenerationTask(input: {
  userId: string;
  apiKeyId?: string;
  relayOnly: boolean;
  callbackUrl?: string;
  priority: QueuePriority;
  userConcurrency: number;
  request: EnqueueGenerationTaskRequest;
  mediaInputs?: readonly GenerationTaskInputObject[];
}): Promise<AsyncImageTask> {
  if (input.relayOnly) {
    throw new Error("Relay-only identities cannot enqueue generation tasks");
  }
  const taskId = `task_${randomUUID().replace(/-/g, "")}`;
  const mediaInputs = input.mediaInputs ?? [];
  if (input.request.kind === "image_generate" && mediaInputs.length > 0) {
    throw new Error("Image generation task must not contain media inputs");
  }

  const inputReferences = await storeGenerationTaskInputs({
    userId: input.userId,
    taskId,
    inputs: mediaInputs,
  });

  try {
    const requestPayload = generationTaskRequestPayloadSchema.parse(
      input.request.kind === "image_generate"
        ? { ...input.request, relayOnly: input.relayOnly }
        : { ...input.request, relayOnly: input.relayOnly, inputReferences }
    );
    const generationIds = generationIdsForRequest(input.request);
    return await createAsyncImageTask({
      id: taskId,
      userId: input.userId,
      apiKeyId: input.apiKeyId,
      model: input.request.input.model,
      generationIds,
      taskType: input.request.kind === "video" ? "video" : "image",
      callbackUrl: input.callbackUrl,
      status: "queued",
      priority: queuePriorityValue(input.priority),
      userConcurrency: Number.isFinite(input.userConcurrency)
        ? Math.max(1, Math.floor(input.userConcurrency))
        : 1,
      maxAttempts: 3,
      requestPayload,
    });
  } catch (error) {
    try {
      await cleanupGenerationTaskInputs({
        userId: input.userId,
        taskId,
        references: inputReferences,
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Failed to enqueue generation task and clean stored inputs"
      );
    }
    throw error;
  }
}
