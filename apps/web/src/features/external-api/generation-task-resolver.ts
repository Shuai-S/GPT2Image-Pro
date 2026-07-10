/**
 * 普通 image/video 持久任务的 DB-free 业务对账与执行决策。
 *
 * 职责：始终先读取 generation 真相，必要时运行超时补偿；严格新请求才允许重新校验
 * API Key 后调用上游，legacy 与 exhausted 模式只对账。任何执行返回后都重新读取业务行，
 * 只有明确 completed/failed 才发布 task 终态，pending/缺失保持可重试。
 */

import type { Generation } from "@repo/database/schema";
import type { SubscriptionPlan } from "@repo/shared/config/subscription-plan";
import type { ModerationBlockRiskLevel } from "@/features/image-generation/types";
import {
  type GenerationTaskRequestPayload,
  type LoadedGenerationTaskInput,
  parseLegacyGenerationTaskIds,
} from "./generation-task-input";
import type {
  GenerationTaskResolution,
  GenerationTaskWorkerRow,
} from "./generation-task-worker-core";

export type VideoGenerationTaskExecutionRow = {
  id: string;
  userId: string;
  apiKeyId: string | null;
  status: string;
  error: string | null;
};

export type GenerationTaskExecutionContext = {
  plan: SubscriptionPlan;
  moderationBlockRiskLevel: ModerationBlockRiskLevel;
};

export type GenerationTaskAuthorization =
  | { ok: true; context: GenerationTaskExecutionContext }
  | { ok: false; message: string };

export type GenerationTaskExecutionCapability =
  | "externalApi.images.generate"
  | "externalApi.images.edit";

export type GenerationTaskResolverDependencies = {
  readImageRows: (generationIds: readonly string[]) => Promise<Generation[]>;
  expireStaleImages: (userId: string) => Promise<void>;
  readVideoRow: (
    generationId: string
  ) => Promise<VideoGenerationTaskExecutionRow | null>;
  recoverVideo: (input: {
    generationId: string;
    userId: string;
    apiKeyId: string | null;
    executionToken: string;
  }) => Promise<void>;
  authorizeExecution: (
    row: GenerationTaskWorkerRow,
    capability: GenerationTaskExecutionCapability
  ) => Promise<GenerationTaskAuthorization>;
  loadInputs: (input: {
    userId: string;
    taskId: string;
    request: GenerationTaskRequestPayload;
  }) => Promise<LoadedGenerationTaskInput[]>;
  runImage: (input: {
    row: GenerationTaskWorkerRow;
    request: Extract<
      GenerationTaskRequestPayload,
      { kind: "image_generate" | "image_edit" }
    >;
    generationId: string;
    executionToken: string;
    context: GenerationTaskExecutionContext;
    inputs: readonly LoadedGenerationTaskInput[];
    signal: AbortSignal;
  }) => Promise<void>;
  runVideo: (input: {
    row: GenerationTaskWorkerRow;
    request: Extract<GenerationTaskRequestPayload, { kind: "video" }>;
    executionToken: string;
    context: GenerationTaskExecutionContext;
    inputs: readonly LoadedGenerationTaskInput[];
    signal: AbortSignal;
  }) => Promise<void>;
  toErrorPayload: (error: unknown) => Record<string, unknown>;
};

type ImageSnapshot = {
  byId: Map<string, Generation>;
  failed: Generation[];
  missingIds: string[];
  pending: Generation[];
};

type ImageExecutionOutcome =
  | { status: "completed" }
  | { status: "failed"; error: Error }
  | { status: "requeue" }
  | { status: "thrown"; error: unknown };

/**
 * 校验并分类一组图像业务行。
 *
 * @param rows 数据库命中行。
 * @param generationIds task 声明顺序。
 * @param expectedUserId task 用户归属。
 * @returns 按 ID 索引，以及 failed/pending/missing 分类。
 * @throws 任一命中行用户不符时 fail-closed。
 * @sideEffects 无。
 */
function inspectImageRows(
  rows: readonly Generation[],
  generationIds: readonly string[],
  expectedUserId: string
): ImageSnapshot {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = generationIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  if (ordered.some((row) => row.userId !== expectedUserId)) {
    throw new Error("Generation result ownership does not match task");
  }
  return {
    byId,
    failed: ordered.filter((row) => row.status === "failed"),
    pending: ordered.filter((row) => row.status === "pending"),
    missingIds: generationIds.filter((id) => !byId.has(id)),
  };
}

/** 构造明确业务失败的 task 决议。 */
function failedResolution(
  objectType: "image" | "video",
  error: unknown,
  dependencies: GenerationTaskResolverDependencies
): GenerationTaskResolution {
  return {
    status: "failed",
    objectType,
    errorPayload: dependencies.toErrorPayload(error),
  };
}

/** 构造不执行上游的纯对账重排决议。 */
function reconciliationRequeue(delayMs = 2_000): GenerationTaskResolution {
  return { status: "requeue", consumeAttempt: false, delayMs };
}

/** 构造已实际进入执行路径的暂态重排决议。 */
function executionRequeue(delayMs = 2_000): GenerationTaskResolution {
  return { status: "requeue", consumeAttempt: true, delayMs };
}

/**
 * 返回持久任务在执行时必须重新具备的套餐能力。
 *
 * @param request 已由严格 schema 收窄的普通 generation 请求。
 * @returns 编辑任务使用 edit 能力；文生图和视频使用 generate 能力。
 * @sideEffects 无。
 */
function requiredExecutionCapability(
  request: GenerationTaskRequestPayload
): GenerationTaskExecutionCapability {
  return request.kind === "image_edit"
    ? "externalApi.images.edit"
    : "externalApi.images.generate";
}

/**
 * 把 task 入队时持久化的用户并发快照收窄为本批 worker 数量。
 *
 * @param userConcurrency task 行的套餐并发快照。
 * @param itemCount 本次仍需执行的 generation 数量。
 * @returns 1..itemCount 的有限整数；异常快照回退为 1。
 * @sideEffects 无。
 */
function imageWorkerCount(userConcurrency: number, itemCount: number): number {
  const normalized = Math.floor(userConcurrency);
  return Number.isFinite(normalized) && normalized > 0
    ? Math.min(itemCount, normalized)
    : 1;
}

/**
 * 在单一 task 租约内有界并行执行未决 generation。
 *
 * @param input 原始 ID 顺序、持久并发、同一 fencing token/signal 与执行快照。
 * @param dependencies 统一图像管线及业务行重查依赖。
 * @returns 按 unresolvedIds 下标保存的执行观察；未派发项保持 undefined。
 * @sideEffects 最多同时调用 userConcurrency 个统一图像管线，并在每项返回后重查业务行。
 * @failureMode 明确失败、pending/缺失、异常或 signal 中止会停止继续派发；已在途项会等待
 * 收敛，避免 resolver 返回后仍有旧租约业务运行。
 */
async function executeUnresolvedImages(
  input: {
    row: GenerationTaskWorkerRow;
    request: Extract<
      GenerationTaskRequestPayload,
      { kind: "image_generate" | "image_edit" }
    >;
    generationIds: readonly string[];
    unresolvedIds: readonly string[];
    executionToken: string;
    context: GenerationTaskExecutionContext;
    inputs: readonly LoadedGenerationTaskInput[];
    signal: AbortSignal;
  },
  dependencies: GenerationTaskResolverDependencies
): Promise<Array<ImageExecutionOutcome | undefined>> {
  const outcomes: Array<ImageExecutionOutcome | undefined> = Array.from({
    length: input.unresolvedIds.length,
  });
  let nextIndex = 0;
  let stopDispatch = false;

  const runWorker = async () => {
    while (!stopDispatch && !input.signal.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      const generationId = input.unresolvedIds[index];
      if (!generationId) return;

      try {
        await dependencies.runImage({
          row: input.row,
          request: input.request,
          generationId,
          executionToken: input.executionToken,
          context: input.context,
          inputs: input.inputs,
          signal: input.signal,
        });
        const rows = await dependencies.readImageRows(input.generationIds);
        const snapshot = inspectImageRows(
          rows,
          input.generationIds,
          input.row.userId
        );
        const current = snapshot.byId.get(generationId);
        if (current?.status === "failed") {
          outcomes[index] = {
            status: "failed",
            error: new Error(current.error || "Image generation failed"),
          };
          stopDispatch = true;
          return;
        }
        if (!current || current.status === "pending") {
          outcomes[index] = { status: "requeue" };
          stopDispatch = true;
          return;
        }
        outcomes[index] = { status: "completed" };
      } catch (error) {
        outcomes[index] = { status: "thrown", error };
        stopDispatch = true;
        return;
      }
    }
  };

  const workerCount = imageWorkerCount(
    input.row.userConcurrency,
    input.unresolvedIds.length
  );
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return outcomes;
}

/**
 * 对账并按需执行一个图像任务。
 *
 * @param input task、严格请求或 legacy IDs、租约与执行模式。
 * @param dependencies 数据库、维护、鉴权与业务管线适配。
 * @returns 只有全部业务行终结才返回 task 终态；否则显式返回两类 requeue。
 * @throws 数据库、维护、输入存储或业务管线异常，交 core 作为暂态错误处理。
 * @sideEffects 可运行超时维护、读取输入并按 task 持久并发调用统一图像管线。
 */
async function resolveImageTask(
  input: {
    row: GenerationTaskWorkerRow;
    request: Extract<
      GenerationTaskRequestPayload,
      { kind: "image_generate" | "image_edit" }
    > | null;
    generationIds: readonly string[];
    executionToken: string;
    reconcileOnly: boolean;
    signal: AbortSignal;
  },
  dependencies: GenerationTaskResolverDependencies
): Promise<GenerationTaskResolution> {
  let rows = await dependencies.readImageRows(input.generationIds);
  let snapshot = inspectImageRows(rows, input.generationIds, input.row.userId);
  if (snapshot.pending.length > 0) {
    await dependencies.expireStaleImages(input.row.userId);
    rows = await dependencies.readImageRows(input.generationIds);
    snapshot = inspectImageRows(rows, input.generationIds, input.row.userId);
  }

  if (snapshot.failed.length > 0) {
    if (snapshot.pending.length > 0) return reconciliationRequeue();
    const failure = snapshot.failed[0];
    return failedResolution(
      "image",
      new Error(failure?.error || "Image generation failed"),
      dependencies
    );
  }
  if (snapshot.pending.length === 0 && snapshot.missingIds.length === 0) {
    return {
      status: "completed",
      objectType: "image",
      resultPayload: { generationIds: [...input.generationIds] },
    };
  }
  if (input.reconcileOnly || !input.request) {
    return snapshot.pending.length > 0
      ? reconciliationRequeue()
      : failedResolution(
          "image",
          new Error("Generation task could not be recovered after retries"),
          dependencies
        );
  }

  const authorization = await dependencies.authorizeExecution(
    input.row,
    requiredExecutionCapability(input.request)
  );
  if (!authorization.ok) {
    return failedResolution(
      "image",
      new Error(authorization.message),
      dependencies
    );
  }
  const loadedInputs = await dependencies.loadInputs({
    userId: input.row.userId,
    taskId: input.row.id,
    request: input.request,
  });
  const unresolvedIds = input.generationIds.filter((id) => {
    const row = snapshot.byId.get(id);
    return !row || row.status === "pending";
  });

  const outcomes = await executeUnresolvedImages(
    {
      row: input.row,
      request: input.request,
      generationIds: input.generationIds,
      unresolvedIds,
      executionToken: input.executionToken,
      context: authorization.context,
      inputs: loadedInputs,
      signal: input.signal,
    },
    dependencies
  );
  const blockingOutcome = outcomes.find(
    (outcome) => outcome && outcome.status !== "completed"
  );
  if (blockingOutcome?.status === "thrown") {
    throw blockingOutcome.error;
  }
  if (blockingOutcome?.status === "failed") {
    return failedResolution("image", blockingOutcome.error, dependencies);
  }
  if (blockingOutcome?.status === "requeue") {
    return executionRequeue();
  }

  rows = await dependencies.readImageRows(input.generationIds);
  snapshot = inspectImageRows(rows, input.generationIds, input.row.userId);
  if (snapshot.pending.length > 0 || snapshot.missingIds.length > 0) {
    return executionRequeue();
  }
  const failure = snapshot.failed[0];
  return failure
    ? failedResolution(
        "image",
        new Error(failure.error || "Image generation failed"),
        dependencies
      )
    : {
        status: "completed",
        objectType: "image",
        resultPayload: { generationIds: [...input.generationIds] },
      };
}

/**
 * 校验视频行归属并映射明确终态。
 *
 * @param row 当前视频行或 null。
 * @param task 持久任务归属。
 * @param dependencies 错误信封适配。
 * @returns completed/failed 决议；不存在或活动态返回 undefined。
 * @throws 用户或 API Key 归属不符时 fail-closed。
 * @sideEffects 无。
 */
function inspectVideoTerminal(
  row: VideoGenerationTaskExecutionRow | null,
  task: GenerationTaskWorkerRow,
  dependencies: GenerationTaskResolverDependencies
): GenerationTaskResolution | undefined {
  if (!row) return undefined;
  if (row.userId !== task.userId || row.apiKeyId !== task.apiKeyId) {
    throw new Error("Video generation result ownership does not match task");
  }
  if (row.status === "completed") {
    return {
      status: "completed",
      objectType: "video",
      resultPayload: { generationId: row.id },
    };
  }
  if (row.status === "failed") {
    return failedResolution(
      "video",
      new Error(row.error || "Video generation failed"),
      dependencies
    );
  }
  return undefined;
}

/**
 * 对账并按需执行一个视频任务。
 *
 * @param input task、严格请求或 legacy ID、租约与执行模式。
 * @param dependencies 数据库、恢复、鉴权与业务管线适配。
 * @returns 明确终态或两类 requeue。
 * @throws 恢复补偿、数据库、输入或业务执行异常，交 core 重试。
 * @sideEffects 活动态先运行可重入恢复；严格普通任务可调用统一视频管线。
 */
async function resolveVideoTask(
  input: {
    row: GenerationTaskWorkerRow;
    request: Extract<GenerationTaskRequestPayload, { kind: "video" }> | null;
    generationId: string;
    executionToken: string;
    reconcileOnly: boolean;
    signal: AbortSignal;
  },
  dependencies: GenerationTaskResolverDependencies
): Promise<GenerationTaskResolution> {
  let video = await dependencies.readVideoRow(input.generationId);
  const initialTerminal = inspectVideoTerminal(video, input.row, dependencies);
  if (initialTerminal) return initialTerminal;
  if (video) {
    await dependencies.recoverVideo({
      generationId: input.generationId,
      userId: input.row.userId,
      apiKeyId: input.row.apiKeyId,
      executionToken: input.executionToken,
    });
    video = await dependencies.readVideoRow(input.generationId);
    const recoveredTerminal = inspectVideoTerminal(
      video,
      input.row,
      dependencies
    );
    if (recoveredTerminal) return recoveredTerminal;
  }

  if (input.reconcileOnly || !input.request) {
    return video
      ? reconciliationRequeue()
      : failedResolution(
          "video",
          new Error("Video task could not be recovered after retries"),
          dependencies
        );
  }
  const authorization = await dependencies.authorizeExecution(
    input.row,
    requiredExecutionCapability(input.request)
  );
  if (!authorization.ok) {
    return failedResolution(
      "video",
      new Error(authorization.message),
      dependencies
    );
  }
  const loadedInputs = await dependencies.loadInputs({
    userId: input.row.userId,
    taskId: input.row.id,
    request: input.request,
  });
  await dependencies.runVideo({
    row: input.row,
    request: input.request,
    executionToken: input.executionToken,
    context: authorization.context,
    inputs: loadedInputs,
    signal: input.signal,
  });
  video = await dependencies.readVideoRow(input.generationId);
  return (
    inspectVideoTerminal(video, input.row, dependencies) ?? executionRequeue()
  );
}

/**
 * 创建普通 generation task 的严格请求与 legacy 对账 resolver。
 *
 * @param dependencies 生产或测试适配。
 * @returns 可直接注入 generation-task-worker-core 的两个 resolver。
 * @sideEffects 本函数本身无副作用；返回函数按上述契约访问依赖。
 */
export function createGenerationTaskResolvers(
  dependencies: GenerationTaskResolverDependencies
): {
  resolveTask: (input: {
    row: GenerationTaskWorkerRow;
    request: GenerationTaskRequestPayload;
    leaseToken: string;
    reconcileOnly: boolean;
    signal: AbortSignal;
  }) => Promise<GenerationTaskResolution>;
  resolveLegacyTask: (input: {
    row: GenerationTaskWorkerRow;
    leaseToken: string;
    signal: AbortSignal;
  }) => Promise<GenerationTaskResolution>;
} {
  return {
    async resolveTask(input) {
      return input.request.kind === "video"
        ? await resolveVideoTask(
            {
              row: input.row,
              request: input.request,
              generationId: input.request.generationId,
              executionToken: input.leaseToken,
              reconcileOnly: input.reconcileOnly,
              signal: input.signal,
            },
            dependencies
          )
        : await resolveImageTask(
            {
              row: input.row,
              request: input.request,
              generationIds: input.request.generationIds,
              executionToken: input.leaseToken,
              reconcileOnly: input.reconcileOnly,
              signal: input.signal,
            },
            dependencies
          );
    },
    async resolveLegacyTask(input) {
      const generationIds = parseLegacyGenerationTaskIds(
        input.row.initialPayload
      );
      if (generationIds.length === 0) {
        return failedResolution(
          input.row.taskType,
          new Error("Persisted generation task has no recoverable identity"),
          dependencies
        );
      }
      return input.row.taskType === "video"
        ? await resolveVideoTask(
            {
              row: input.row,
              request: null,
              generationId: generationIds[0] as string,
              executionToken: input.leaseToken,
              reconcileOnly: true,
              signal: input.signal,
            },
            dependencies
          )
        : await resolveImageTask(
            {
              row: input.row,
              request: null,
              generationIds,
              executionToken: input.leaseToken,
              reconcileOnly: true,
              signal: input.signal,
            },
            dependencies
          );
    },
  };
}
