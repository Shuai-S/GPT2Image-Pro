/**
 * PostgreSQL 可编辑文件 worker 生产适配器。
 *
 * 职责：所有 Web 副本启动有界 worker 循环，使用 SKIP LOCKED 领取 PPT/PSD 任务，
 * 注入 task lease、集群 semaphore、对象存储与业务管线，并清理已终结任务的输入对象。
 */

import { createContextLogger } from "@repo/shared/logger";

import { toOpenAIErrorPayload } from "@/features/external-api/images";
import { runEditableFileForUser } from "@/features/image-generation/editable-file-operations";
import { postgresImageGenerationConcurrencyCoordinator } from "@/features/image-generation/distributed-concurrency";
import { getImageGenerationGlobalConcurrency } from "@/features/image-generation/queue";

import {
  cleanupEditableTaskInputs,
  editableTaskRequestPayloadSchema,
  loadEditableTaskImages,
} from "./editable-task-input";
import { buildEditableTaskStoredResult } from "./editable-task-result";
import { processEditableTaskClaim } from "./editable-task-worker-core";
import {
  claimEditableTask,
  failExhaustedEditableTasks,
  finalizeEditableTask,
  heartbeatEditableTask,
  requeueEditableTask,
} from "./external-async-task-store";

const DEFAULT_WORKER_COUNT = 2;
const IDLE_POLL_MS = 500;
const ERROR_RETRY_MS = 5_000;

type EditableWorkerState = {
  started: boolean;
};

type EditableWorkerGlobal = typeof globalThis & {
  __gpt2imageEditableTaskWorker?: EditableWorkerState;
};

const workerGlobal = globalThis as EditableWorkerGlobal;
const log = createContextLogger({ component: "editable-task-worker" });

/** 读取有上限的正整数环境变量，防止错误配置创建过多本地循环。 */
function getBoundedWorkerCount(): number {
  const parsed = Number.parseInt(
    process.env.EDITABLE_TASK_WORKER_CONCURRENCY ?? "",
    10
  );
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WORKER_COUNT;
  return Math.min(32, parsed);
}

/** 获取热重载安全的进程级启动状态；跨副本竞争仍由数据库负责。 */
function getWorkerState(): EditableWorkerState {
  if (!workerGlobal.__gpt2imageEditableTaskWorker) {
    workerGlobal.__gpt2imageEditableTaskWorker = { started: false };
  }
  return workerGlobal.__gpt2imageEditableTaskWorker;
}

/**
 * 清理一批因连续进程崩溃而耗尽尝试次数的任务输入。
 *
 * 数据库函数每批最多收敛 100 行；无效旧载荷不会触发任意对象删除。
 */
async function cleanupExhaustedTasks(): Promise<void> {
  const exhausted = await failExhaustedEditableTasks();
  for (const row of exhausted) {
    const request = editableTaskRequestPayloadSchema.safeParse(row.requestPayload);
    if (!request.success) continue;
    await cleanupEditableTaskInputs({
      userId: row.userId,
      taskId: row.id,
      references: request.data.inputReferences,
    }).catch((error: unknown) => {
      log.warn(
        { err: error, taskId: row.id },
        "Exhausted editable task input cleanup failed"
      );
    });
  }
}

/**
 * 执行一个 worker tick。
 *
 * worker 0 兼做有界耗尽任务维护；无任务返回 idle 延迟，有任务则立即允许下一 tick。
 */
async function runWorkerTick(workerIndex: number): Promise<number> {
  if (workerIndex === 0) await cleanupExhaustedTasks();
  const claim = await claimEditableTask();
  if (!claim) return IDLE_POLL_MS;

  const result = await processEditableTaskClaim(claim, {
    coordinator: postgresImageGenerationConcurrencyCoordinator,
    getGlobalConcurrency: getImageGenerationGlobalConcurrency,
    heartbeatTask: heartbeatEditableTask,
    requeueTask: requeueEditableTask,
    finalizeTask: finalizeEditableTask,
    loadImages: loadEditableTaskImages,
    cleanupInputs: cleanupEditableTaskInputs,
    async runEditableFile(input) {
      const output = await runEditableFileForUser(input);
      return buildEditableTaskStoredResult({
        kind: input.kind,
        output,
      });
    },
    toErrorPayload(error) {
      return toOpenAIErrorPayload(
        error instanceof Error ? error.message : "Editable file generation failed"
      );
    },
    onHeartbeatError(error) {
      log.warn(
        { err: error, taskId: claim.row.id },
        "Editable task heartbeat failed"
      );
    },
    onCleanupError(error) {
      log.warn(
        { err: error, taskId: claim.row.id },
        "Editable task input cleanup failed"
      );
    },
  });

  if (result.status === "completed" || result.status === "failed") {
    log.info(
      { taskId: claim.row.id, outcome: result.status },
      "Editable task finalized"
    );
  } else if (result.status === "lease_lost") {
    log.warn({ taskId: claim.row.id }, "Editable task lease was lost");
  }
  return result.status === "requeued" ? IDLE_POLL_MS : 0;
}

/**
 * 安装一个永不重入的递归 worker 循环。
 *
 * tick 异常被记录并延迟重试；unref 定时器不会单独阻止进程退出。
 */
function scheduleWorker(workerIndex: number, initialDelayMs: number): void {
  const scheduleNext = (delayMs: number) => {
    const timer = setTimeout(() => {
      void tick();
    }, delayMs);
    timer.unref?.();
  };
  const tick = async () => {
    try {
      scheduleNext(await runWorkerTick(workerIndex));
    } catch (error) {
      log.warn(
        { err: error, workerIndex },
        "Editable task worker tick failed"
      );
      scheduleNext(ERROR_RETRY_MS);
    }
  };
  scheduleNext(initialDelayMs);
}

/**
 * 启动本进程的可编辑文件 worker。
 *
 * 测试、Next 生产构建或显式关闭时不启动；globalThis 保证热重载和重复 instrumentation
 * 不会重复安装。函数只安排循环，不等待长任务完成。
 */
export async function startEditableTaskWorker(): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.EXTERNAL_ASYNC_TASK_WORKERS_ENABLED === "false") return;

  const state = getWorkerState();
  if (state.started) return;
  state.started = true;
  const count = getBoundedWorkerCount();
  for (let index = 0; index < count; index += 1) {
    scheduleWorker(index, 100 + index * 100);
  }
  log.info({ workerCount: count }, "Editable task worker started");
}
