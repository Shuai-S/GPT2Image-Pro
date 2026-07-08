/**
 * 图像批量数量限制。
 *
 * 职责：统一 Web 路由、外部 API 与统一管线对单次批量张数的上限口径。
 * 使用方：/api/images/*、外部 API handler、runImageGenerationForUser。
 * 关键依赖：套餐 limits.maxBatchCount。并发只决定同一批内同时起跑多少任务，
 * 不再决定用户一次最多请求多少张，避免“并发”和“张数”两个概念互相污染。
 */

export const MAX_IMAGE_BATCH_COUNT = 4;

/**
 * 从套餐限制中解析单次批量张数上限。
 *
 * @param limits 套餐限制快照，优先读取 maxBatchCount。
 * @returns 归一化后的正整数上限，并受平台硬上限 4 张约束。
 * @sideEffects 无。
 * @failureMode 非有限值、0 或负数会被视为配置异常并兜底到 1。
 */
export function getImageBatchCountLimit(limits: {
  maxBatchCount?: number;
  imageGenerationConcurrency?: number;
}) {
  const rawCount =
    limits.maxBatchCount ?? limits.imageGenerationConcurrency ?? 1;
  const count = Math.floor(rawCount);
  return Number.isFinite(count) && count > 0
    ? Math.min(count, MAX_IMAGE_BATCH_COUNT)
    : 1;
}
