/**
 * 图像批量数量限制。
 *
 * 职责：统一 Web 路由、外部 API 与统一管线对单次批量张数的上限口径。
 * 使用方：/api/images/*、外部 API handler、runImageGenerationForUser。
 * 关键依赖：套餐 limits.imageGenerationConcurrency；maxBatchCount 已保留为历史配置字段，
 * 但不再作为批量张数闸门，避免管理员调高并发后前后端仍被默认 10 张卡住。
 */

/**
 * 从套餐限制中解析单次批量张数上限。
 *
 * @param limits 套餐限制快照，至少包含 imageGenerationConcurrency。
 * @returns 归一化后的正整数上限，异常配置兜底为 1。
 * @sideEffects 无。
 * @failureMode 非有限值、0 或负数会被视为配置异常并兜底到 1。
 */
export function getImageBatchCountLimit(limits: {
  imageGenerationConcurrency: number;
}) {
  const count = Math.floor(limits.imageGenerationConcurrency);
  return Number.isFinite(count) && count > 0 ? count : 1;
}
