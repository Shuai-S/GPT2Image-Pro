/**
 * 外部 API 异步任务公开契约。
 *
 * 职责：创建/读取/完成 PostgreSQL 持久 task_* 外壳，将内部任务行映射为兼容响应，
 * 并提供经过 SSRF 防护、会显式抛错的 callback 投递函数。数据库状态机在
 * external-async-task-store.ts，worker 重试在 editable-task-worker.ts 与
 * async-callback-worker.ts。
 */

import { randomUUID } from "node:crypto";
import { materializeEditableTaskResult } from "./editable-task-result";
import {
  completeExternalAsyncTask,
  createExternalAsyncTask,
  type ExternalAsyncTaskRow,
  getExternalAsyncTask,
} from "./external-async-task-store";
import {
  type MaterializedGenerationTask,
  materializeGenerationTask,
} from "./generation-task-materializer";
import {
  assertPublicCallbackUrl,
  fetchPublicCallback,
} from "./safe-image-fetch";

type AsyncImageTaskStatus = "processing" | "completed" | "failed";

export type AsyncImageTask = {
  id: string;
  object: "image.generation" | "image" | "video" | "editable_file_task";
  userId: string;
  apiKeyId?: string;
  model?: string;
  status: AsyncImageTaskStatus;
  created_at: string;
  completed_at?: string;
  generation_id?: string;
  generationId?: string;
  generation_ids?: string[];
  generationIds?: string[];
  [key: string]: unknown;
};

type CreateAsyncImageTaskParams = {
  id?: string;
  userId: string;
  apiKeyId?: string;
  model?: string;
  generationIds?: string[];
  taskType?: "image" | "video";
  callbackUrl?: string;
  status?: "queued" | "running";
  priority?: number;
  userConcurrency?: number;
  maxAttempts?: number;
  clientRequestId?: string;
  requestHash?: string;
  requestPayload?: Record<string, unknown>;
};

type CompleteAsyncImageTaskParams = {
  result?: unknown;
  error?: unknown;
  // 完成后的 object 类型。图像任务从 image.generation 转为 image(默认);可编辑文件任务
  // 传 "editable_file_task" 以保持类型不变(不被误标成 image)。
  completedObject?: AsyncImageTask["object"];
};

const CALLBACK_TIMEOUT_MS = 10_000;

/** 提交期校验 callback URL，强制 HTTPS 且目标为公网地址。 */
export async function validateCallbackUrl(value: string): Promise<string> {
  const url = await assertPublicCallbackUrl(value);
  return url.toString();
}

/**
 * 持久化一个 image/video 异步任务外壳。
 *
 * generationIds 指向底层产物真相；插入失败会向上传播，调用方不得启动后台闭包。
 */
export async function createAsyncImageTask(
  params: CreateAsyncImageTaskParams
): Promise<AsyncImageTask> {
  const id = params.id ?? `task_${randomUUID().replace(/-/g, "")}`;
  const generationIds = params.generationIds?.filter(Boolean);
  const now = new Date();
  const task: AsyncImageTask = {
    id,
    object: "image.generation",
    userId: params.userId,
    apiKeyId: params.apiKeyId,
    model: params.model,
    status: "processing",
    created: Math.floor(now.getTime() / 1000),
    created_at: now.toISOString(),
    ...(generationIds?.length === 1
      ? {
          generation_id: generationIds[0],
          generationId: generationIds[0],
        }
      : generationIds?.length
        ? {
            generation_ids: generationIds,
            generationIds,
          }
        : {}),
  };
  await createExternalAsyncTask({
    id,
    taskType: params.taskType ?? "image",
    objectType: task.object,
    userId: params.userId,
    apiKeyId: params.apiKeyId,
    model: params.model,
    status: params.status ?? "running",
    priority: params.priority,
    userConcurrency: params.userConcurrency,
    maxAttempts: params.maxAttempts,
    clientRequestId: params.clientRequestId,
    requestHash: params.requestHash,
    initialPayload: task,
    requestPayload: params.requestPayload,
    callbackUrl: params.callbackUrl,
  });
  return task;
}

/**
 * 将持久任务行还原成对外兼容的 AsyncImageTask。
 *
 * initialPayload 保留创建响应；终态 result/error 字段覆盖其上，内部租约与回调字段
 * 永不进入公开对象。
 */
function mapAsyncImageTask(
  row: ExternalAsyncTaskRow,
  materializedGeneration?: MaterializedGenerationTask
): AsyncImageTask {
  const initialPayload =
    row.initialPayload && typeof row.initialPayload === "object"
      ? (row.initialPayload as Record<string, unknown>)
      : {};
  const materializedEditableResult =
    row.taskType === "editable_file" && row.status === "completed"
      ? materializeEditableTaskResult(row.resultPayload, row.userId)
      : undefined;
  const invalidEditableResult =
    row.taskType === "editable_file" &&
    row.status === "completed" &&
    !materializedEditableResult;
  const resultPayload = materializedGeneration
    ? materializedGeneration.status === "completed"
      ? materializedGeneration.payload
      : {}
    : materializedEditableResult
      ? materializedEditableResult
      : row.taskType === "editable_file"
        ? {}
        : row.resultPayload && typeof row.resultPayload === "object"
          ? (row.resultPayload as Record<string, unknown>)
          : row.resultPayload === null
            ? {}
            : { result: row.resultPayload };
  const errorPayload = materializedGeneration
    ? materializedGeneration.status === "failed"
      ? materializedGeneration.payload
      : {}
    : row.errorPayload && typeof row.errorPayload === "object"
      ? (row.errorPayload as Record<string, unknown>)
      : row.errorPayload === null
        ? {}
        : { error: row.errorPayload };
  return {
    ...initialPayload,
    ...resultPayload,
    ...(invalidEditableResult
      ? { error: { message: "Editable file task result is unavailable." } }
      : errorPayload),
    id: row.id,
    object: (materializedGeneration?.objectType ??
      row.objectType) as AsyncImageTask["object"],
    userId: row.userId,
    apiKeyId: row.apiKeyId ?? undefined,
    model: row.model ?? undefined,
    status:
      materializedGeneration?.status ??
      (invalidEditableResult
        ? "failed"
        : row.status === "completed"
          ? "completed"
          : row.status === "failed"
            ? "failed"
            : "processing"),
    created_at: row.createdAt.toISOString(),
    ...(row.completedAt
      ? {
          completed: Math.floor(row.completedAt.getTime() / 1000),
          completed_at: row.completedAt.toISOString(),
        }
      : {}),
  };
}

/**
 * 将持久任务行同步还原为基础公开任务。
 *
 * @param row external_async_task 完整行。
 * @returns 处理中任务、editable 动态签名或持久终态字段。
 * @sideEffects editable 完成行会生成当前签名，不访问数据库或对象存储。
 */
export function toAsyncImageTask(row: ExternalAsyncTaskRow): AsyncImageTask {
  return mapAsyncImageTask(row);
}

/**
 * 在读取当下从 generation 真相动态物化普通图像/视频任务。
 *
 * @param row external_async_task 完整行。
 * @returns 普通终态使用重新签名/有限读取的当前产物；其他任务返回基础映射。
 * @throws generation 查询、对象读取或归属校验失败时向上抛，callback 会安排重试。
 * @sideEffects 普通终态查询产物表；b64_json 结果有限读取对象存储。
 */
export async function materializeAsyncImageTask(
  row: ExternalAsyncTaskRow
): Promise<AsyncImageTask> {
  const materializedGeneration = await materializeGenerationTask(row);
  return mapAsyncImageTask(row, materializedGeneration);
}

/** 按 task id 读取并物化公开任务；不存在时返回 undefined。 */
export async function getAsyncImageTask(
  id: string
): Promise<AsyncImageTask | undefined> {
  const row = await getExternalAsyncTask(id);
  return row ? await materializeAsyncImageTask(row) : undefined;
}

/** 删除内部 userId/apiKeyId 后生成可直接编码的公开任务对象。 */
export function toAsyncImageTaskResponse(
  task: AsyncImageTask
): Omit<AsyncImageTask, "userId" | "apiKeyId"> {
  const { userId: _userId, apiKeyId: _apiKeyId, ...publicTask } = task;
  return publicTask;
}

/** 一条 generation 记录(DB 回退查询用的最小字段集)。 */
export type GenerationTaskRow = {
  id: string;
  model: string;
  status: "pending" | "completed" | "failed";
  revisedPrompt: string | null;
  creditsConsumed: string | number | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

/**
 * 把一条 generation 记录转成 /v1/images/{id} 的响应（DB 回退路径，纯函数 DB-free）。
 *
 * task_* 外壳与 generation 都已持久化；同步请求拿到的是 generation_id 而非 task id。
 * 本函数让接口按 generation_id 从产物真相取回，归属校验由调用方完成。
 *
 * 结构对齐同步成功响应（data:[{url, revised_prompt}]）+ 任务状态字段；并额外给
 * image_url 顶层兜底，便于只取单一 URL 的客户端。
 */
export function toGenerationImageTaskResponse(
  row: GenerationTaskRow,
  imageUrl: string | null
) {
  const status: AsyncImageTaskStatus =
    row.status === "completed"
      ? "completed"
      : row.status === "failed"
        ? "failed"
        : "processing";
  const credits = Number(row.creditsConsumed ?? 0);
  return {
    id: row.id,
    object: status === "completed" ? "image" : "image.generation",
    model: row.model,
    status,
    created: Math.floor(row.createdAt.getTime() / 1000),
    created_at: row.createdAt.toISOString(),
    ...(row.completedAt ? { completed_at: row.completedAt.toISOString() } : {}),
    generation_id: row.id,
    generationId: row.id,
    ...(status === "completed" && imageUrl
      ? {
          image_url: imageUrl,
          data: [
            {
              url: imageUrl,
              ...(row.revisedPrompt
                ? { revised_prompt: row.revisedPrompt }
                : {}),
            },
          ],
        }
      : {}),
    ...(status === "failed" && row.error
      ? { error: { message: row.error } }
      : {}),
    ...(Number.isFinite(credits) ? { credits_consumed: credits } : {}),
  };
}

/** 一条 video_generation 记录(DB 回退查询用的最小字段集)。 */
export type VideoTaskRow = {
  id: string;
  model: string;
  // video_generation.status 是 text 列(pending/running/completed/failed),按字符串判定。
  status: string;
  durationSeconds: number;
  creditsConsumed: string | number | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date | null;
};

/**
 * 把一条 video_generation 记录转成 /v1/videos/{id} 的响应（DB 持久查询路径,纯函数）。
 * 与图像版同构,但产物是视频 URL,且带 duration_seconds。归属校验由调用方完成。
 * video_generation 无 completedAt 列,completed 时以 updatedAt 作为完成时间。
 */
export function toVideoGenerationTaskResponse(
  row: VideoTaskRow,
  videoUrl: string | null
) {
  const status: AsyncImageTaskStatus =
    row.status === "completed"
      ? "completed"
      : row.status === "failed"
        ? "failed"
        : "processing";
  const credits = Number(row.creditsConsumed ?? 0);
  return {
    id: row.id,
    object: status === "completed" ? "video" : "video.generation",
    model: row.model,
    status,
    duration_seconds: row.durationSeconds,
    created: Math.floor(row.createdAt.getTime() / 1000),
    created_at: row.createdAt.toISOString(),
    ...(status === "completed" && row.updatedAt
      ? { completed_at: row.updatedAt.toISOString() }
      : {}),
    generation_id: row.id,
    generationId: row.id,
    ...(status === "completed" && videoUrl
      ? { video_url: videoUrl, data: [{ url: videoUrl }] }
      : {}),
    ...(status === "failed" && row.error
      ? { error: { message: row.error } }
      : {}),
    ...(Number.isFinite(credits) ? { credits_consumed: credits } : {}),
  };
}

export async function completeAsyncImageTask(
  id: string,
  params: CompleteAsyncImageTaskParams
): Promise<AsyncImageTask | undefined> {
  const existing = await getAsyncImageTask(id);
  if (!existing) return undefined;
  if (existing.status === "completed" || existing.status === "failed") {
    return existing;
  }

  const now = new Date();
  const completedAt = now.toISOString();
  const payload = params.error ?? params.result;
  const payloadFields =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : params.error
        ? { error: payload }
        : { result: payload };
  const task: AsyncImageTask = {
    ...existing,
    ...payloadFields,
    object: params.completedObject ?? "image",
    status: params.error ? "failed" : "completed",
    completed: Math.floor(now.getTime() / 1000),
    completed_at: completedAt,
  };
  const row = await completeExternalAsyncTask({
    id,
    objectType: task.object,
    resultPayload: params.error ? undefined : payloadFields,
    errorPayload: params.error ? payloadFields : undefined,
  });
  if (row) return toAsyncImageTask(row);
  return await getAsyncImageTask(id);
}

/**
 * 向已提交期校验的 callback URL 投递一个公开任务终态。
 *
 * 每次重试使用稳定 task id 作为事件 ID；逐跳网络校验阻断 DNS rebinding/重定向 SSRF。
 * 超时、网络错误与非 2xx 响应都会抛出，由 outbox worker 安排指数退避。
 */
export async function deliverAsyncImageCallback(
  callbackUrl: string,
  payload: AsyncImageTask
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);
  try {
    // 完成时再经逐跳复检投递：弥补"提交校验通过、30 分钟后被 302 跳内网"的 TOCTOU 盲 SSRF。
    const response = await fetchPublicCallback(callbackUrl, {
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Tokens-Callback": "true",
        "X-Tokens-Callback-Event-Id": payload.id,
      },
      body: JSON.stringify(toAsyncImageTaskResponse(payload)),
    });
    await response.body?.cancel();
    if (!response.ok) {
      throw new Error(`Callback returned HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
