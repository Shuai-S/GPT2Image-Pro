/**
 * 普通图像与视频持久任务入队服务。
 *
 * 职责：生成 task ID，把媒体字节转存到任务专属对象前缀，并以严格 request payload
 * 创建 queued 外壳。外部 API Route 只调用本服务，不得再启动进程内后台闭包。
 */

import { randomUUID } from "node:crypto";
import type { QueuePriority } from "@repo/shared/config/subscription-plan";

import {
  type AsyncImageTask,
  createAsyncImageTask,
  materializeAsyncImageTask,
} from "./async-image-tasks";
import {
  type ExternalAsyncTaskRow,
  findGenerationTaskByClientRequest,
} from "./external-async-task-store";
import {
  GenerationTaskConflictError,
  type HashableGenerationTaskRequest,
  hashGenerationTaskRequest,
  normalizeGenerationIdempotencyKey,
} from "./generation-task-idempotency";
import {
  cleanupGenerationTaskInputs,
  type GenerationTaskInputObject,
  generationTaskRequestPayloadSchema,
  storeGenerationTaskInputs,
} from "./generation-task-input";

export type EnqueueGenerationTaskRequest = HashableGenerationTaskRequest;

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
 * 从请求判别字段映射唯一索引使用的普通 task 类型。
 *
 * @param request 已由 handler 构造的严格 generation 请求。
 * @returns video 请求返回 video，其余 image 请求返回 image。
 * @sideEffects 无。
 */
function taskTypeForRequest(
  request: EnqueueGenerationTaskRequest
): "image" | "video" {
  return request.kind === "video" ? "video" : "image";
}

/**
 * 校验幂等 winner 的内容摘要并动态物化当前公开任务。
 *
 * @param row 串行重放或并发唯一冲突命中的持久行。
 * @param requestHash 当前请求在写对象前算出的稳定摘要。
 * @returns 终态从 generation 真相重新签名/读取的公开任务。
 * @throws 同 key 异内容时抛 GenerationTaskConflictError；物化错误向上传播。
 * @sideEffects 终态任务可能查询业务行并读取有界对象正文。
 */
async function materializeIdempotentWinner(
  row: ExternalAsyncTaskRow,
  requestHash: string
): Promise<AsyncImageTask> {
  if (row.requestHash !== requestHash) {
    throw new GenerationTaskConflictError();
  }
  return await materializeAsyncImageTask(row);
}

/**
 * 创建一个可跨进程恢复的普通 generation 任务。
 *
 * @param input 已鉴权用户/API Key、套餐队列设置、严格标量请求与已校验媒体 Buffer。
 * @returns 可直接映射为外部 API 创建响应的 processing 任务。
 * @throws 媒体存储、payload 校验或数据库插入失败时抛错；插入失败会先清理已写对象。
 * @sideEffects 写对象存储并插入 external_async_task queued 行。
 */
export async function enqueueGenerationTask(input: {
  userId: string;
  apiKeyId: string;
  relayOnly: boolean;
  clientRequestId?: string;
  callbackUrl?: string;
  priority: QueuePriority;
  userConcurrency: number;
  request: EnqueueGenerationTaskRequest;
  mediaInputs?: readonly GenerationTaskInputObject[];
}): Promise<AsyncImageTask> {
  if (input.relayOnly) {
    throw new Error("Relay-only identities cannot enqueue generation tasks");
  }
  const mediaInputs = input.mediaInputs ?? [];
  if (input.request.kind === "image_generate" && mediaInputs.length > 0) {
    throw new Error("Image generation task must not contain media inputs");
  }
  const clientRequestId = normalizeGenerationIdempotencyKey(
    input.clientRequestId
  );
  const taskType = taskTypeForRequest(input.request);
  const requestHash = clientRequestId
    ? hashGenerationTaskRequest({
        request: input.request,
        callbackUrl: input.callbackUrl,
        mediaInputs,
      })
    : undefined;
  if (clientRequestId && requestHash) {
    const existing = await findGenerationTaskByClientRequest({
      userId: input.userId,
      apiKeyId: input.apiKeyId,
      taskType,
      clientRequestId,
    });
    if (existing) {
      return await materializeIdempotentWinner(existing, requestHash);
    }
  }

  const taskId = `task_${randomUUID().replace(/-/g, "")}`;

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
      taskType,
      callbackUrl: input.callbackUrl,
      status: "queued",
      priority: queuePriorityValue(input.priority),
      userConcurrency: Number.isFinite(input.userConcurrency)
        ? Math.max(1, Math.floor(input.userConcurrency))
        : 1,
      maxAttempts: 3,
      clientRequestId,
      requestHash,
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
    if (clientRequestId && requestHash) {
      const winner = await findGenerationTaskByClientRequest({
        userId: input.userId,
        apiKeyId: input.apiKeyId,
        taskType,
        clientRequestId,
      });
      if (winner) {
        return await materializeIdempotentWinner(winner, requestHash);
      }
    }
    throw error;
  }
}
