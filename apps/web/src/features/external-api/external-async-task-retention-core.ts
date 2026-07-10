/**
 * 外部 API 异步任务终态保留策略的纯逻辑。
 *
 * 职责：规范化保留天数和单批删除量、计算截止时间，并判断任务是否满足清理
 * 条件。使用方是 retention 编排服务和 DB-free 单元测试；不依赖数据库或运行时设置。
 */

export const DEFAULT_EXTERNAL_ASYNC_TASK_RETENTION_DAYS = 30;
export const MAX_EXTERNAL_ASYNC_TASK_RETENTION_DAYS = 3650;
export const DEFAULT_EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE = 500;
export const MAX_EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE = 5000;

const MIN_EXTERNAL_ASYNC_TASK_RETENTION_DAYS = 1;
const MIN_EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ExternalAsyncTaskRetentionConfig = {
  retentionDays: number;
  batchSize: number;
};

/**
 * 把未知来源的数值收敛为有界正整数。
 *
 * @param value 设置值。
 * @param fallback 非有限值、非正值或截断后低于下限时采用的安全默认值。
 * @param minimum 允许的最小整数。
 * @param maximum 允许的最大整数，超出时硬钳制以限制资源占用。
 * @returns 可安全用于时间计算或 SQL LIMIT 的有界整数。
 * @sideEffects 无；不会抛错。
 */
function normalizeBoundedPositiveInteger(
  value: number,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback;
  const integer = Math.trunc(value);
  if (integer < minimum) return fallback;
  return Math.min(integer, maximum);
}

/**
 * 规范化异步任务保留策略。
 *
 * @param input 运行时读取的保留天数和单批删除量，可能越界或不是有限数。
 * @returns 带安全默认值和硬上限的整数配置。
 * @sideEffects 无；无效值回退默认值，超大值钳制而不抛错。
 */
export function normalizeExternalAsyncTaskRetentionConfig(
  input: ExternalAsyncTaskRetentionConfig
): ExternalAsyncTaskRetentionConfig {
  return {
    retentionDays: normalizeBoundedPositiveInteger(
      input.retentionDays,
      DEFAULT_EXTERNAL_ASYNC_TASK_RETENTION_DAYS,
      MIN_EXTERNAL_ASYNC_TASK_RETENTION_DAYS,
      MAX_EXTERNAL_ASYNC_TASK_RETENTION_DAYS
    ),
    batchSize: normalizeBoundedPositiveInteger(
      input.batchSize,
      DEFAULT_EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE,
      MIN_EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE,
      MAX_EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE
    ),
  };
}

/**
 * 根据当前时间和已规范化的保留天数计算清理截止时间。
 *
 * @param now 本次任务使用的稳定当前时间。
 * @param retentionDays 正整数保留天数。
 * @returns `now - retentionDays` 对应的新 Date。
 * @throws RangeError 当 now 无效或 retentionDays 不是正的安全整数时抛出。
 * @sideEffects 无；不修改传入 Date。
 */
export function createExternalAsyncTaskRetentionCutoff(
  now: Date,
  retentionDays: number
): Date {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(retentionDays) ||
    retentionDays < MIN_EXTERNAL_ASYNC_TASK_RETENTION_DAYS ||
    retentionDays > MAX_EXTERNAL_ASYNC_TASK_RETENTION_DAYS
  ) {
    throw new RangeError("Invalid external async task retention cutoff input");
  }
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/**
 * 判断一条任务是否可被终态保留任务删除。
 *
 * @param input 任务状态、callback 状态、完成时间和本次固定截止时间。
 * @returns 仅 completed/failed、callback 已结束且完成时间不晚于 cutoff 时为 true。
 * @sideEffects 无；无效或缺失时间按不可删除处理。
 */
export function isExternalAsyncTaskRetentionEligible(input: {
  status: string;
  callbackStatus: string;
  completedAt: Date | null;
  cutoff: Date;
}): boolean {
  const completedAtMs = input.completedAt?.getTime();
  const cutoffMs = input.cutoff.getTime();
  if (
    completedAtMs === undefined ||
    !Number.isFinite(completedAtMs) ||
    !Number.isFinite(cutoffMs)
  ) {
    return false;
  }

  const terminal = input.status === "completed" || input.status === "failed";
  const callbackFinished =
    input.callbackStatus === "none" ||
    input.callbackStatus === "sent" ||
    input.callbackStatus === "permanent_failed";
  return terminal && callbackFinished && completedAtMs <= cutoffMs;
}
