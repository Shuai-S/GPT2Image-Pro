/**
 * PostgreSQL 普通 image/video generation worker 的生产适配器。
 *
 * 职责：所有 Node Web 副本以 SKIP LOCKED 领取任务，重新校验 API Key 与套餐，恢复
 * 对象输入并调用单一图像/视频管线。正常任务与 exhausted 对账共享 core、resolver 和
 * fencing token；后者只做业务/财务收敛，永不盲跑上游。
 */

import { db } from "@repo/database";
import { externalApiKey, generation, user } from "@repo/database/schema";
import {
  isModerationBlockRiskLevel,
  type ModerationBlockRiskLevel,
} from "@repo/shared/config/subscription-plan";
import { expireStalePendingGenerations } from "@repo/shared/generation-maintenance";
import { createContextLogger } from "@repo/shared/logger";
import { canUsePlanCapability } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { and, eq, inArray } from "drizzle-orm";
import {
  getVideoGenerationById,
  recoverStaleVideoGeneration,
} from "@/features/image-generation/video-operations";
import {
  claimExhaustedGenerationTask,
  claimGenerationTask,
  deferExhaustedGenerationTask,
  deferGenerationTask,
  type ExternalAsyncTaskRow,
  finalizeGenerationTask,
  heartbeatGenerationTask,
  releaseUnstartedGenerationTask,
} from "./external-async-task-store";
import { getGenerationTaskAccessError } from "./generation-task-access";
import {
  runGenerationTaskImage,
  runGenerationTaskVideo,
} from "./generation-task-executor";
import {
  cleanupGenerationTaskInputs,
  type GenerationTaskRequestPayload,
  type LoadedGenerationTaskInput,
  loadGenerationTaskInputs,
} from "./generation-task-input";
import {
  createGenerationTaskResolvers,
  type GenerationTaskExecutionCapability,
  type GenerationTaskResolverDependencies,
} from "./generation-task-resolver";
import {
  type GenerationTaskWorkerClaim,
  type GenerationTaskWorkerDependencies,
  type GenerationTaskWorkerRow,
  processGenerationTaskClaim,
} from "./generation-task-worker-core";
import { toOpenAIErrorPayload } from "./images";

const DEFAULT_WORKER_COUNT = 2;
const IDLE_POLL_MS = 500;
const ERROR_RETRY_MS = 5_000;
const MAX_WORKER_COUNT = 16;

type GenerationWorkerState = {
  started: boolean;
};

type GenerationWorkerGlobal = typeof globalThis & {
  __gpt2imageGenerationTaskWorker?: GenerationWorkerState;
};

const workerGlobal = globalThis as GenerationWorkerGlobal;
const log = createContextLogger({ component: "generation-task-worker" });

/** 读取 1..16 的普通 generation worker 数量，非法配置回退为 2。 */
function getWorkerCount(): number {
  const parsed = Number.parseInt(
    process.env.GENERATION_TASK_WORKER_CONCURRENCY ?? "",
    10
  );
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WORKER_COUNT;
  return Math.min(MAX_WORKER_COUNT, parsed);
}

/** 获取热重载安全的进程启动状态；跨副本互斥仍由 PostgreSQL 租约保证。 */
function getWorkerState(): GenerationWorkerState {
  if (!workerGlobal.__gpt2imageGenerationTaskWorker) {
    workerGlobal.__gpt2imageGenerationTaskWorker = { started: false };
  }
  return workerGlobal.__gpt2imageGenerationTaskWorker;
}

/** 按 task 声明顺序读取一组图像 generation 完整行。 */
async function readImageRows(generationIds: readonly string[]) {
  return await db
    .select()
    .from(generation)
    .where(inArray(generation.id, [...generationIds]));
}

/** 对当前用户执行一次有界 pending 超时维护，resolver 随后必定重新查询目标行。 */
async function expireStaleImages(userId: string): Promise<void> {
  await expireStalePendingGenerations({ userId, limit: 10_000 });
}

/** 按 ID 读取一条视频业务行；不存在时返回 null。 */
async function readVideoRow(generationId: string) {
  return await getVideoGenerationById(generationId);
}

/** 运行视频 stale/recovering 的可重入财务补偿；最终状态由 resolver 重查数据库。 */
async function recoverVideo(input: {
  generationId: string;
  userId: string;
  apiKeyId: string | null;
  executionToken: string;
}): Promise<void> {
  await recoverStaleVideoGeneration({
    videoGenerationId: input.generationId,
    userId: input.userId,
    apiKeyId: input.apiKeyId,
    executionToken: input.executionToken,
  });
}

/**
 * 重新校验任务绑定 API Key、用户与当前套餐能力。
 *
 * @param row 已领取任务的不可变归属。
 * @returns 可执行上下文，或面向 task 的永久拒绝原因。
 * @throws 数据库/设置读取异常向上抛，core 会保留 task 并消耗一次暂态重试预算。
 * @sideEffects 查询 API Key、用户、订阅与能力矩阵；不修改 lastUsedAt。
 */
async function authorizeExecution(
  row: GenerationTaskWorkerRow,
  capability: GenerationTaskExecutionCapability
) {
  if (!row.apiKeyId) {
    return {
      ok: false as const,
      message: "Generation task API key is missing",
    };
  }
  const [key] = await db
    .select({
      id: externalApiKey.id,
      userId: externalApiKey.userId,
      isActive: externalApiKey.isActive,
      relayOnly: externalApiKey.relayOnly,
      moderationBlockRiskLevel: externalApiKey.moderationBlockRiskLevel,
      userBanned: user.banned,
    })
    .from(externalApiKey)
    .innerJoin(user, eq(user.id, externalApiKey.userId))
    .where(
      and(
        eq(externalApiKey.id, row.apiKeyId),
        eq(externalApiKey.userId, row.userId)
      )
    )
    .limit(1);
  if (!key) {
    return {
      ok: false as const,
      message: "Generation task API key is no longer active",
    };
  }
  const plan = await getUserPlan(row.userId);
  const [canUseRelay, canExecute] = await Promise.all([
    key.relayOnly
      ? canUsePlanCapability(plan.plan, "externalApi.relay")
      : Promise.resolve(false),
    canUsePlanCapability(plan.plan, capability),
  ]);
  const accessError = getGenerationTaskAccessError({
    isActive: key.isActive,
    userBanned: key.userBanned,
    rawRelayOnly: key.relayOnly,
    canUseRelay,
    canExecute,
    capability,
  });
  if (accessError) {
    return {
      ok: false as const,
      message: accessError,
    };
  }
  const moderationBlockRiskLevel: ModerationBlockRiskLevel =
    isModerationBlockRiskLevel(key.moderationBlockRiskLevel)
      ? key.moderationBlockRiskLevel
      : "low";
  return {
    ok: true as const,
    context: { plan: plan.plan, moderationBlockRiskLevel },
  };
}

/** 严格请求需要媒体时从任务专属对象前缀有限恢复；纯生图返回空数组。 */
async function loadInputs(input: {
  userId: string;
  taskId: string;
  request: GenerationTaskRequestPayload;
}): Promise<LoadedGenerationTaskInput[]> {
  return input.request.kind === "image_generate"
    ? []
    : await loadGenerationTaskInputs({
        userId: input.userId,
        taskId: input.taskId,
        references: input.request.inputReferences,
      });
}

/** 把未知错误转换为不含内部堆栈的 OpenAI 错误信封。 */
function toErrorPayload(error: unknown): Record<string, unknown> {
  return toOpenAIErrorPayload(
    error instanceof Error ? error.message : "Generation task failed"
  );
}

const resolverDependencies: GenerationTaskResolverDependencies = {
  readImageRows,
  expireStaleImages,
  readVideoRow,
  recoverVideo,
  authorizeExecution,
  loadInputs,
  runImage: runGenerationTaskImage,
  runVideo: runGenerationTaskVideo,
  toErrorPayload,
};
const resolvers = createGenerationTaskResolvers(resolverDependencies);

/** 把 store 完整行安全收窄为 generation core 所需字段。 */
function toWorkerClaim(input: {
  row: ExternalAsyncTaskRow;
  leaseToken: string;
}): GenerationTaskWorkerClaim {
  if (input.row.taskType === "editable_file") {
    throw new Error("Editable task was claimed by generation worker");
  }
  return {
    leaseToken: input.leaseToken,
    row: {
      id: input.row.id,
      userId: input.row.userId,
      apiKeyId: input.row.apiKeyId,
      taskType: input.row.taskType,
      userConcurrency: input.row.userConcurrency,
      initialPayload: input.row.initialPayload,
      requestPayload: input.row.requestPayload,
    },
  };
}

/** 为当前 claim 构造 normal 或 exhausted 的 store 状态迁移依赖。 */
function createWorkerDependencies(input: {
  claim: GenerationTaskWorkerClaim;
  reconcileOnly: boolean;
}): GenerationTaskWorkerDependencies {
  const exhaustedDefer = (id: string, leaseToken: string, delayMs?: number) =>
    deferExhaustedGenerationTask(id, leaseToken, delayMs);
  return {
    heartbeatTask: heartbeatGenerationTask,
    releaseUnstartedTask: input.reconcileOnly
      ? exhaustedDefer
      : releaseUnstartedGenerationTask,
    deferTask: input.reconcileOnly ? exhaustedDefer : deferGenerationTask,
    finalizeTask: finalizeGenerationTask,
    resolveTask: resolvers.resolveTask,
    resolveLegacyTask: resolvers.resolveLegacyTask,
    cleanupInputs: cleanupGenerationTaskInputs,
    toErrorPayload,
    onHeartbeatError(error) {
      log.warn(
        { err: error, taskId: input.claim.row.id },
        "Generation task heartbeat failed"
      );
    },
    onResolveError(error) {
      log.warn(
        { err: error, taskId: input.claim.row.id },
        "Generation task will retry after resolver error"
      );
    },
    onCleanupError(error) {
      log.warn(
        { err: error, taskId: input.claim.row.id },
        "Generation task input cleanup failed"
      );
    },
  };
}

/**
 * 执行一个普通 generation worker tick。
 *
 * @param workerIndex 本进程 worker 序号；0 号优先处理 exhausted 对账。
 * @returns 下一 tick 延迟；完成任务后立即继续，空闲/重排后短暂等待。
 * @sideEffects 领取、续租、对账/执行、终态或重排一条任务。
 */
async function runWorkerTick(workerIndex: number): Promise<number> {
  const exhaustedClaim =
    workerIndex === 0 ? await claimExhaustedGenerationTask() : undefined;
  const storeClaim = exhaustedClaim ?? (await claimGenerationTask());
  if (!storeClaim) return IDLE_POLL_MS;
  const claim = toWorkerClaim(storeClaim);
  const reconcileOnly = Boolean(exhaustedClaim);
  const result = await processGenerationTaskClaim(
    claim,
    createWorkerDependencies({ claim, reconcileOnly }),
    { reconcileOnly }
  );
  if (result.status === "completed" || result.status === "failed") {
    log.info(
      { taskId: claim.row.id, outcome: result.status },
      "Generation task finalized"
    );
  } else if (result.status === "lease_lost") {
    log.warn({ taskId: claim.row.id }, "Generation task lease was lost");
  }
  return result.status === "requeued" ? IDLE_POLL_MS : 0;
}

/** 安装一个递归 worker 循环；tick 异常记录后延迟重试且不会产生未处理 Promise。 */
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
        "Generation task worker tick failed"
      );
      scheduleNext(ERROR_RETRY_MS);
    }
  };
  scheduleNext(initialDelayMs);
}

/**
 * 启动本进程的普通 generation worker。
 *
 * @returns 安排有界循环后立即完成；测试、生产构建或显式关闭时不启动。
 * @sideEffects 在每个 Node 副本安装 worker 定时器；globalThis 防热重载重复安装。
 */
export async function startGenerationTaskWorker(): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.EXTERNAL_ASYNC_TASK_WORKERS_ENABLED === "false") return;

  const state = getWorkerState();
  if (state.started) return;
  state.started = true;
  const count = getWorkerCount();
  for (let index = 0; index < count; index += 1) {
    scheduleWorker(index, 200 + index * 100);
  }
  log.info({ workerCount: count }, "Generation task worker started");
}
