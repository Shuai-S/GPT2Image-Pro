/**
 * 外部 API callback outbox worker。
 *
 * 职责：所有 Web 副本用 PostgreSQL SKIP LOCKED 领取终态 callback，动态物化签名结果，
 * 逐跳 SSRF 复检后投递，并以 fencing token 写成功或指数退避状态。
 */

import { createContextLogger } from "@repo/shared/logger";
import { processAsyncCallbackClaim } from "./async-callback-worker-core";
import {
  deliverAsyncImageCallback,
  materializeAsyncImageTask,
} from "./async-image-tasks";
import {
  claimExternalAsyncCallback,
  completeExternalAsyncCallback,
  retryExternalAsyncCallback,
} from "./external-async-task-store";

const IDLE_POLL_MS = 500;
const ERROR_RETRY_MS = 5_000;
const DEFAULT_WORKER_COUNT = 2;

type CallbackWorkerState = {
  started: boolean;
};

type CallbackWorkerGlobal = typeof globalThis & {
  __gpt2imageAsyncCallbackWorker?: CallbackWorkerState;
};

const workerGlobal = globalThis as CallbackWorkerGlobal;
const log = createContextLogger({ component: "async-callback-worker" });

/** 读取 1..16 的 callback worker 数量，非法配置回退为 2。 */
function getWorkerCount(): number {
  const parsed = Number.parseInt(
    process.env.ASYNC_CALLBACK_WORKER_CONCURRENCY ?? "",
    10
  );
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WORKER_COUNT;
  return Math.min(16, parsed);
}

/** 获取同进程热重载安全的 callback worker 启动状态。 */
function getWorkerState(): CallbackWorkerState {
  if (!workerGlobal.__gpt2imageAsyncCallbackWorker) {
    workerGlobal.__gpt2imageAsyncCallbackWorker = { started: false };
  }
  return workerGlobal.__gpt2imageAsyncCallbackWorker;
}

/** 领取并投递一条 callback；无可用事件时返回 idle 延迟。 */
async function runCallbackTick(): Promise<number> {
  const claim = await claimExternalAsyncCallback();
  if (!claim) return IDLE_POLL_MS;
  const outcome = await processAsyncCallbackClaim(claim, {
    getTaskId: (row) => row.id,
    getCallbackUrl: (row) => row.callbackUrl,
    getAttempts: (row) => row.callbackAttempts,
    materializePayload: materializeAsyncImageTask,
    deliver: deliverAsyncImageCallback,
    complete: completeExternalAsyncCallback,
    retry: retryExternalAsyncCallback,
  });
  if (outcome === "lease_lost") {
    log.warn({ taskId: claim.row.id }, "Async callback lease was lost");
  } else if (outcome === "retry_scheduled") {
    log.warn(
      { taskId: claim.row.id, attempts: claim.row.callbackAttempts },
      "Async callback delivery will retry"
    );
  }
  return 0;
}

/** 安装一个递归 callback worker 循环；异常会延迟重试且不会产生未处理 Promise。 */
function scheduleWorker(initialDelayMs: number): void {
  const scheduleNext = (delayMs: number) => {
    const timer = setTimeout(() => {
      void tick();
    }, delayMs);
    timer.unref?.();
  };
  const tick = async () => {
    try {
      scheduleNext(await runCallbackTick());
    } catch (error) {
      log.warn({ err: error }, "Async callback worker tick failed");
      scheduleNext(ERROR_RETRY_MS);
    }
  };
  scheduleNext(initialDelayMs);
}

/**
 * 启动 callback outbox worker。
 *
 * 测试、生产构建或显式关闭时跳过；正常运行时只安排循环并立即返回。
 */
export async function startAsyncCallbackWorker(): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.EXTERNAL_ASYNC_TASK_WORKERS_ENABLED === "false") return;

  const state = getWorkerState();
  if (state.started) return;
  state.started = true;
  const count = getWorkerCount();
  for (let index = 0; index < count; index += 1) {
    scheduleWorker(150 + index * 100);
  }
  log.info({ workerCount: count }, "Async callback worker started");
}
