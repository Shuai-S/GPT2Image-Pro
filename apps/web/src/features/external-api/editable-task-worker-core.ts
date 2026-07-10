/**
 * 可编辑文件 worker 的 DB-free 单任务状态机。
 *
 * 职责：在注入的任务租约与分布式 semaphore 上执行一条已领取任务，处理请求校验、
 * 心跳、重排、fencing 终态和输入清理。生产适配在 editable-task-worker.ts，测试可用
 * 内存依赖覆盖崩溃接管与旧 worker 晚到场景。
 */

import type {
  ImageGenerationConcurrencyCoordinator,
  ImageGenerationConcurrencyLease,
} from "@/features/image-generation/queue-core";
import type { EditableInputImage } from "@/features/image-generation/editable-file-util";

import {
  type EditableTaskInputReference,
  editableTaskRequestPayloadSchema,
} from "./editable-task-input";

export type EditableTaskWorkerRow = {
  id: string;
  userId: string;
  apiKeyId: string | null;
  kind: "ppt" | "psd" | null;
  clientRequestId: string | null;
  requestPayload: Record<string, unknown> | null;
  userConcurrency: number;
};

export type EditableTaskWorkerClaim = {
  row: EditableTaskWorkerRow;
  leaseToken: string;
};

export type EditableTaskWorkerResult =
  | { status: "completed" }
  | { status: "failed" }
  | { status: "requeued"; reason: "user_limit" | "global_limit" | "error" }
  | { status: "lease_lost" };

export type EditableTaskWorkerDependencies = {
  coordinator: ImageGenerationConcurrencyCoordinator;
  getGlobalConcurrency: () => Promise<number>;
  heartbeatTask: (id: string, leaseToken: string) => Promise<boolean>;
  requeueTask: (
    id: string,
    leaseToken: string,
    delayMs?: number
  ) => Promise<boolean>;
  finalizeTask: (input: {
    id: string;
    leaseToken: string;
    resultPayload?: Record<string, unknown>;
    errorPayload?: Record<string, unknown>;
  }) => Promise<boolean>;
  loadImages: (input: {
    userId: string;
    taskId: string;
    references: readonly EditableTaskInputReference[];
  }) => Promise<EditableInputImage[]>;
  runEditableFile: (input: {
    userId: string;
    apiKeyId?: string;
    kind: "ppt" | "psd";
    prompt: string;
    inputImages: readonly EditableInputImage[];
    taskId: string;
  }) => Promise<Record<string, unknown>>;
  cleanupInputs: (input: {
    userId: string;
    taskId: string;
    references: readonly EditableTaskInputReference[];
  }) => Promise<void>;
  toErrorPayload: (error: unknown) => Record<string, unknown>;
  heartbeatIntervalMs?: number;
  requeueDelayMs?: number;
  onHeartbeatError?: (error: unknown) => void;
  onCleanupError?: (error: unknown) => void;
};

type TaskHeartbeat = {
  lost: () => boolean;
  stop: () => Promise<void>;
};

/**
 * 启动一条递归 task lease 心跳并返回可等待的停止句柄。
 *
 * 数据库异常仅上报并继续尝试；明确返回 false 才说明 fencing token 已失效。stop 会等待
 * 当前续租结束，避免心跳与终态更新互相竞争。
 */
function startTaskHeartbeat(input: {
  id: string;
  leaseToken: string;
  intervalMs: number;
  heartbeat: (id: string, leaseToken: string) => Promise<boolean>;
  onError?: (error: unknown) => void;
}): TaskHeartbeat {
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
      if (!renewed) leaseLost = true;
    } catch (error) {
      input.onError?.(error);
    }
    schedule();
  };

  schedule();
  return {
    lost: () => leaseLost,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}

/** 在终态成功写入后尽力删除输入对象，不让清理异常改变任务终态。 */
async function cleanupFinalizedInputs(
  input: {
    userId: string;
    taskId: string;
    references: readonly EditableTaskInputReference[];
  },
  dependencies: EditableTaskWorkerDependencies
): Promise<void> {
  try {
    await dependencies.cleanupInputs(input);
  } catch (error) {
    dependencies.onCleanupError?.(error);
  }
}

/**
 * 把无法执行的已领取任务写为失败。
 *
 * 仅当前 leaseToken 仍有效时成功；旧 worker 或已过期租约返回 lease_lost。
 */
async function finalizeInvalidTask(
  claim: EditableTaskWorkerClaim,
  dependencies: EditableTaskWorkerDependencies,
  error: unknown
): Promise<EditableTaskWorkerResult> {
  const finalized = await dependencies.finalizeTask({
    id: claim.row.id,
    leaseToken: claim.leaseToken,
    errorPayload: dependencies.toErrorPayload(error),
  });
  return finalized ? { status: "failed" } : { status: "lease_lost" };
}

/**
 * 执行一条已由 PostgreSQL SKIP LOCKED 领取的可编辑文件任务。
 *
 * 请求校验失败直接终结；无分布式并发槽时不消耗 attempt，并短暂重排。业务执行同时
 * 受到 task lease 与 user/global semaphore 心跳保护，终态和清理只由当前 fencing token
 * 完成。进程崩溃时不会运行终态逻辑，租约过期后可由其他 worker 接管。
 */
export async function processEditableTaskClaim(
  claim: EditableTaskWorkerClaim,
  dependencies: EditableTaskWorkerDependencies
): Promise<EditableTaskWorkerResult> {
  const request = editableTaskRequestPayloadSchema.safeParse(
    claim.row.requestPayload
  );
  if (
    !request.success ||
    !claim.row.kind ||
    !claim.row.clientRequestId
  ) {
    return await finalizeInvalidTask(
      claim,
      dependencies,
      new Error("Persisted editable task request is invalid")
    );
  }
  const kind = claim.row.kind;
  const clientRequestId = claim.row.clientRequestId;

  let acquired:
    | Awaited<ReturnType<ImageGenerationConcurrencyCoordinator["acquire"]>>
    | undefined;
  try {
    acquired = await dependencies.coordinator.acquire({
      taskId: claim.row.id,
      userId: claim.row.userId,
      userConcurrency: Math.max(1, Math.floor(claim.row.userConcurrency)),
      globalConcurrency: await dependencies.getGlobalConcurrency(),
    });
  } catch {
    const requeued = await dependencies.requeueTask(
      claim.row.id,
      claim.leaseToken,
      dependencies.requeueDelayMs
    );
    return requeued
      ? { status: "requeued", reason: "error" }
      : { status: "lease_lost" };
  }

  if (!acquired.acquired) {
    const requeued = await dependencies.requeueTask(
      claim.row.id,
      claim.leaseToken,
      dependencies.requeueDelayMs
    );
    return requeued
      ? { status: "requeued", reason: acquired.reason }
      : { status: "lease_lost" };
  }

  const references = request.data.inputReferences;
  return await dependencies.coordinator.runWithLease(
    acquired.lease as ImageGenerationConcurrencyLease,
    async () => {
      const heartbeat = startTaskHeartbeat({
        id: claim.row.id,
        leaseToken: claim.leaseToken,
        intervalMs: dependencies.heartbeatIntervalMs ?? 30_000,
        heartbeat: dependencies.heartbeatTask,
        onError: dependencies.onHeartbeatError,
      });
      try {
        const inputImages = await dependencies.loadImages({
          userId: claim.row.userId,
          taskId: claim.row.id,
          references,
        });
        const resultPayload = await dependencies.runEditableFile({
          userId: claim.row.userId,
          apiKeyId: claim.row.apiKeyId ?? undefined,
          kind,
          prompt: request.data.prompt,
          inputImages,
          taskId: clientRequestId,
        });
        await heartbeat.stop();
        if (heartbeat.lost()) return { status: "lease_lost" };

        const finalized = await dependencies.finalizeTask({
          id: claim.row.id,
          leaseToken: claim.leaseToken,
          resultPayload,
        });
        if (!finalized) return { status: "lease_lost" };
        await cleanupFinalizedInputs(
          { userId: claim.row.userId, taskId: claim.row.id, references },
          dependencies
        );
        return { status: "completed" };
      } catch (error) {
        await heartbeat.stop();
        if (heartbeat.lost()) return { status: "lease_lost" };

        const finalized = await dependencies.finalizeTask({
          id: claim.row.id,
          leaseToken: claim.leaseToken,
          errorPayload: dependencies.toErrorPayload(error),
        });
        if (!finalized) return { status: "lease_lost" };
        await cleanupFinalizedInputs(
          { userId: claim.row.userId, taskId: claim.row.id, references },
          dependencies
        );
        return { status: "failed" };
      } finally {
        await heartbeat.stop();
      }
    }
  );
}
