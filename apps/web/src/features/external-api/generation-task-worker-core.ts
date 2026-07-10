/**
 * 普通 image/video generation worker 的 DB-free 单任务状态机。
 *
 * 职责：校验持久请求、维持 task lease 心跳、在明确丢租时中止业务，并以 fencing token
 * 完成终态、重排和输入清理。数据库对账与实际图像/视频执行由生产适配注入。
 */

import {
  type GenerationTaskInputReference,
  type GenerationTaskRequestPayload,
  type GenerationTaskResultPayload,
  generationTaskRequestPayloadSchema,
  generationTaskResultPayloadSchema,
} from "./generation-task-input";

export type GenerationTaskWorkerRow = {
  id: string;
  userId: string;
  apiKeyId: string | null;
  taskType: "image" | "video";
  requestPayload: Record<string, unknown> | null;
};

export type GenerationTaskWorkerClaim = {
  row: GenerationTaskWorkerRow;
  leaseToken: string;
};

export type GenerationTaskResolution =
  | {
      status: "completed";
      objectType: "image" | "video";
      resultPayload: GenerationTaskResultPayload;
    }
  | {
      status: "failed";
      objectType: "image" | "video";
      errorPayload: Record<string, unknown>;
    }
  | { status: "requeue"; delayMs?: number };

export type GenerationTaskWorkerResult =
  | { status: "completed" }
  | { status: "failed" }
  | { status: "requeued" }
  | { status: "lease_lost" };

export type GenerationTaskWorkerDependencies = {
  heartbeatTask: (id: string, leaseToken: string) => Promise<boolean>;
  requeueTask: (
    id: string,
    leaseToken: string,
    delayMs?: number
  ) => Promise<boolean>;
  finalizeTask: (input: {
    id: string;
    leaseToken: string;
    objectType: "image" | "video";
    resultPayload?: Record<string, unknown>;
    errorPayload?: Record<string, unknown>;
  }) => Promise<boolean>;
  resolveTask: (input: {
    row: GenerationTaskWorkerRow;
    request: GenerationTaskRequestPayload;
    signal: AbortSignal;
  }) => Promise<GenerationTaskResolution>;
  cleanupInputs: (input: {
    userId: string;
    taskId: string;
    references: readonly GenerationTaskInputReference[];
  }) => Promise<void>;
  toErrorPayload: (error: unknown) => Record<string, unknown>;
  heartbeatIntervalMs?: number;
  onHeartbeatError?: (error: unknown) => void;
  onCleanupError?: (error: unknown) => void;
};

type TaskHeartbeat = {
  lost: () => boolean;
  signal: AbortSignal;
  stop: () => Promise<void>;
};

/**
 * 判断持久行 taskType 与判别 payload 是否一致。
 *
 * @param taskType 数据库受约束任务类型。
 * @param request 严格解析后的请求。
 * @returns image payload 只允许 image 行，video payload 只允许 video 行。
 * @sideEffects 无。
 */
function matchesPersistedTaskType(
  taskType: GenerationTaskWorkerRow["taskType"],
  request: GenerationTaskRequestPayload
): boolean {
  return request.kind === "video" ? taskType === "video" : taskType === "image";
}

/**
 * 取严格请求中的临时媒体引用。
 *
 * @param request generation 判别联合。
 * @returns generate 为空数组；edit/video 返回保持顺序的对象引用。
 * @sideEffects 无。
 */
function getTaskInputReferences(
  request: GenerationTaskRequestPayload
): readonly GenerationTaskInputReference[] {
  return request.kind === "image_generate" ? [] : request.inputReferences;
}

/**
 * 启动递归 task lease 心跳并暴露中止信号。
 *
 * @param input task/token、心跳间隔和存储续租函数。
 * @returns 可查询丢租、传给业务管线的 AbortSignal 和可等待停止句柄。
 * @sideEffects 定时续租；明确 false 时 abort，数据库异常仅上报并继续尝试。
 */
function startTaskHeartbeat(input: {
  id: string;
  leaseToken: string;
  intervalMs: number;
  heartbeat: (id: string, leaseToken: string) => Promise<boolean>;
  onError?: (error: unknown) => void;
}): TaskHeartbeat {
  const controller = new AbortController();
  let stopped = false;
  let leaseLost = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const schedule = () => {
    if (stopped || leaseLost) return;
    timer = setTimeout(() => {
      inFlight = tick();
    }, input.intervalMs);
    timer.unref?.();
  };
  const tick = async () => {
    if (stopped || leaseLost) return;
    try {
      const renewed = await input.heartbeat(input.id, input.leaseToken);
      if (!renewed) {
        leaseLost = true;
        controller.abort(new Error("Generation task lease was lost"));
      }
    } catch (error) {
      input.onError?.(error);
    }
    schedule();
  };

  schedule();
  return {
    lost: () => leaseLost,
    signal: controller.signal,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}

/**
 * 在有效终态写入后尽力删除临时输入对象。
 *
 * @param claim 当前任务归属。
 * @param references 已由严格 payload 校验的对象引用。
 * @param dependencies 清理适配与日志钩子。
 * @returns 全部清理尝试结束后完成；异常不会改变已提交终态。
 * @sideEffects 删除对象存储，失败时调用 onCleanupError。
 */
async function cleanupFinalizedInputs(
  claim: GenerationTaskWorkerClaim,
  references: readonly GenerationTaskInputReference[],
  dependencies: GenerationTaskWorkerDependencies
): Promise<void> {
  try {
    await dependencies.cleanupInputs({
      userId: claim.row.userId,
      taskId: claim.row.id,
      references,
    });
  } catch (error) {
    dependencies.onCleanupError?.(error);
  }
}

/**
 * 用当前 token 终结非法持久请求。
 *
 * @param claim 已领取任务。
 * @param dependencies fencing 终态和错误映射依赖。
 * @returns 写入成功为 failed，token 已失为 lease_lost。
 * @sideEffects 条件写任务失败；不清理无法信任的引用。
 */
async function finalizeInvalidTask(
  claim: GenerationTaskWorkerClaim,
  dependencies: GenerationTaskWorkerDependencies
): Promise<GenerationTaskWorkerResult> {
  const finalized = await dependencies.finalizeTask({
    id: claim.row.id,
    leaseToken: claim.leaseToken,
    objectType: claim.row.taskType === "video" ? "video" : "image",
    errorPayload: dependencies.toErrorPayload(
      new Error("Persisted generation task request is invalid")
    ),
  });
  return finalized ? { status: "failed" } : { status: "lease_lost" };
}

/**
 * 执行一条已由 PostgreSQL SKIP LOCKED 领取的普通 generation 任务。
 *
 * @param claim 任务行与本次 fencing token。
 * @param dependencies 业务对账、心跳、终态、重排和对象清理适配。
 * @returns completed/failed/requeued/lease_lost，不泄露业务结果正文。
 * @sideEffects 调用注入业务；只有当前 token 成功终态后才清理输入。明确丢租会 abort
 * 业务，旧 worker 不得终态、重排或删除新 worker 仍需的输入。
 */
export async function processGenerationTaskClaim(
  claim: GenerationTaskWorkerClaim,
  dependencies: GenerationTaskWorkerDependencies
): Promise<GenerationTaskWorkerResult> {
  const request = generationTaskRequestPayloadSchema.safeParse(
    claim.row.requestPayload
  );
  if (
    !request.success ||
    request.data.relayOnly !== false ||
    !matchesPersistedTaskType(claim.row.taskType, request.data)
  ) {
    return await finalizeInvalidTask(claim, dependencies);
  }

  const references = getTaskInputReferences(request.data);
  const heartbeat = startTaskHeartbeat({
    id: claim.row.id,
    leaseToken: claim.leaseToken,
    intervalMs: dependencies.heartbeatIntervalMs ?? 30_000,
    heartbeat: dependencies.heartbeatTask,
    onError: dependencies.onHeartbeatError,
  });

  let resolution: GenerationTaskResolution;
  try {
    resolution = await dependencies.resolveTask({
      row: claim.row,
      request: request.data,
      signal: heartbeat.signal,
    });
  } catch (error) {
    resolution = {
      status: "failed",
      objectType: claim.row.taskType === "video" ? "video" : "image",
      errorPayload: dependencies.toErrorPayload(error),
    };
  }
  await heartbeat.stop();
  if (heartbeat.lost()) return { status: "lease_lost" };

  if (resolution.status === "requeue") {
    const requeued = await dependencies.requeueTask(
      claim.row.id,
      claim.leaseToken,
      resolution.delayMs
    );
    return requeued ? { status: "requeued" } : { status: "lease_lost" };
  }

  if (resolution.status === "completed") {
    const storedResult = generationTaskResultPayloadSchema.safeParse(
      resolution.resultPayload
    );
    if (!storedResult.success) {
      resolution = {
        status: "failed",
        objectType: resolution.objectType,
        errorPayload: dependencies.toErrorPayload(
          new Error("Generation task result contains invalid persisted data")
        ),
      };
    } else {
      resolution = { ...resolution, resultPayload: storedResult.data };
    }
  }

  const finalized = await dependencies.finalizeTask({
    id: claim.row.id,
    leaseToken: claim.leaseToken,
    objectType: resolution.objectType,
    ...(resolution.status === "completed"
      ? { resultPayload: resolution.resultPayload }
      : { errorPayload: resolution.errorPayload }),
  });
  if (!finalized) return { status: "lease_lost" };
  await cleanupFinalizedInputs(claim, references, dependencies);
  return { status: resolution.status };
}
