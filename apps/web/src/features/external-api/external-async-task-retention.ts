/**
 * 外部 API 异步任务终态保留任务编排。
 *
 * 职责：读取运行时保留策略、经纯核心施加安全边界，并调用 PostgreSQL 存储删除
 * 一个固定批次。使用方是 UOL cron operation；跨副本互斥由 internal-job lease 负责。
 */

import { getRuntimeSettingNumber } from "@repo/shared/system-settings";
import { createContextLogger } from "@repo/shared/logger";

import {
  createExternalAsyncTaskRetentionCutoff,
  DEFAULT_EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE,
  DEFAULT_EXTERNAL_ASYNC_TASK_RETENTION_DAYS,
  normalizeExternalAsyncTaskRetentionConfig,
} from "./external-async-task-retention-core";
import {
  cleanupEditableTaskInputsStrict,
  editableTaskRequestPayloadSchema,
} from "./editable-task-input";
import {
  type ExternalAsyncTaskRetentionCandidate,
  deleteExternalAsyncTaskTerminalBatch,
  listExternalAsyncTaskTerminalRetentionCandidates,
} from "./external-async-task-store";
import {
  cleanupGenerationTaskInputsStrict,
  generationTaskRequestPayloadSchema,
} from "./generation-task-input";

const CLEANUP_CONCURRENCY = 8;
const strictEditableTaskRequestPayloadSchema =
  editableTaskRequestPayloadSchema.strict();
const log = createContextLogger({
  component: "external-async-task-retention",
});

export type ExternalAsyncTaskRetentionResult = {
  candidateCount: number;
  cleanupFailedCount: number;
  deletedCount: number;
  retentionDays: number;
  batchSize: number;
  cutoff: string;
  batchLimitReached: boolean;
};

/**
 * 清理单条终态任务仍引用的临时输入对象。
 *
 * @param candidate 数据库候选的任务类型、归属和未知 requestPayload。
 * @returns 合法 image_generate 无输入或全部合法输入清理成功时完成。
 * @throws 合法 generation/editable 输入对象任一删除失败时抛出，调用方必须保留行。
 * @throws payload 非法或与 taskType 不匹配时也抛出，避免删除唯一对象引用。
 * @sideEffects 对严格 payload 中且属于当前 user/task 前缀的对象执行删除；引用未通过
 * 归属校验时不触发任意对象删除。image_generate 没有输入对象，可直接完成。
 */
async function cleanupRetentionCandidateInputs(
  candidate: ExternalAsyncTaskRetentionCandidate
): Promise<void> {
  if (candidate.taskType === "editable_file") {
    const request = strictEditableTaskRequestPayloadSchema.safeParse(
      candidate.requestPayload
    );
    if (!request.success) {
      throw new Error("Invalid editable task retention request payload");
    }
    await cleanupEditableTaskInputsStrict({
      userId: candidate.userId,
      taskId: candidate.id,
      references: request.data.inputReferences,
    });
    return;
  }

  const request = generationTaskRequestPayloadSchema.safeParse(
    candidate.requestPayload
  );
  if (!request.success) {
    throw new Error("Invalid generation task retention request payload");
  }
  if (
    (candidate.taskType === "video" && request.data.kind !== "video") ||
    (candidate.taskType === "image" && request.data.kind === "video")
  ) {
    throw new Error("Generation task retention payload type mismatch");
  }
  if (request.data.kind === "image_generate") return;
  await cleanupGenerationTaskInputsStrict({
    userId: candidate.userId,
    taskId: candidate.id,
    references: request.data.inputReferences,
  });
}

/**
 * 以固定并发清理候选输入，并筛出允许删除数据库行的任务 ID。
 *
 * @param candidates 已由存储层限定终态、callback 与截止时间的候选。
 * @returns 输入清理成功或无可信输入引用的 ID，以及清理失败数量。
 * @sideEffects 每组最多八个并发对象清理；失败逐任务记录结构化告警并继续其他任务。
 */
async function cleanupRetentionCandidates(
  candidates: readonly ExternalAsyncTaskRetentionCandidate[]
): Promise<{ candidateIds: string[]; failedCount: number }> {
  const candidateIds: string[] = [];
  let failedCount = 0;
  for (
    let offset = 0;
    offset < candidates.length;
    offset += CLEANUP_CONCURRENCY
  ) {
    const group = candidates.slice(offset, offset + CLEANUP_CONCURRENCY);
    const results = await Promise.all(
      group.map(async (candidate) => {
        try {
          await cleanupRetentionCandidateInputs(candidate);
          return candidate.id;
        } catch (error) {
          log.warn(
            { err: error, taskId: candidate.id, taskType: candidate.taskType },
            "External async task retention input cleanup failed"
          );
          return undefined;
        }
      })
    );
    for (const result of results) {
      if (result) candidateIds.push(result);
      else failedCount += 1;
    }
  }
  return { candidateIds, failedCount };
}

/**
 * 删除一个到期且 callback 已结束的异步任务批次。
 *
 * @returns 本次实际删除量、规范化配置、截止时间和是否打满批次。
 * @sideEffects 读取系统设置并在短事务内删除最多 batchSize 条终态任务。
 * @throws 设置读取或数据库操作失败时原样上抛，由内部任务调度器记录并重试。
 */
export async function runExternalAsyncTaskRetention(): Promise<ExternalAsyncTaskRetentionResult> {
  const [retentionDaysValue, batchSizeValue] = await Promise.all([
    getRuntimeSettingNumber(
      "EXTERNAL_ASYNC_TASK_RETENTION_DAYS",
      DEFAULT_EXTERNAL_ASYNC_TASK_RETENTION_DAYS,
      { positive: true }
    ),
    getRuntimeSettingNumber(
      "EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE",
      DEFAULT_EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE,
      { positive: true }
    ),
  ]);
  const config = normalizeExternalAsyncTaskRetentionConfig({
    retentionDays: retentionDaysValue,
    batchSize: batchSizeValue,
  });
  const cutoff = createExternalAsyncTaskRetentionCutoff(
    new Date(),
    config.retentionDays
  );
  const candidates = await listExternalAsyncTaskTerminalRetentionCandidates({
    cutoff,
    batchSize: config.batchSize,
  });
  const cleanup = await cleanupRetentionCandidates(candidates);
  const deletedCount = await deleteExternalAsyncTaskTerminalBatch({
    candidateIds: cleanup.candidateIds,
    cutoff,
    batchSize: config.batchSize,
  });

  return {
    candidateCount: candidates.length,
    cleanupFailedCount: cleanup.failedCount,
    deletedCount,
    retentionDays: config.retentionDays,
    batchSize: config.batchSize,
    cutoff: cutoff.toISOString(),
    batchLimitReached: candidates.length === config.batchSize,
  };
}
