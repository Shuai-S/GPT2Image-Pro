/**
 * 图生图参考图数量限制纯工具。
 *
 * 职责：提供前后端都可安全复用的参考图数量上限常量与交集计算。
 * 使用方：客户端定价组件、服务端请求校验、运行时系统设置读取模块。
 * 关键依赖：无服务端依赖，避免客户端 bundle 拉入数据库或 Node.js 内置模块。
 */

export const DEFAULT_IMAGE_EDIT_MAX_REFERENCE_IMAGES = 4;

/**
 * 计算当前请求最终允许的图生图参考图数量。
 *
 * @param planLimit 套餐能力矩阵中的编辑参考图数量上限。
 * @param runtimeLimit 全站系统设置中的图生图参考图硬上限。
 * @returns 两者交集后的正整数上限。
 * @sideEffects 无。
 * @failureMode 任一输入异常时按 1 处理，避免服务端放大上传面。
 */
export function getEffectiveImageEditMaxReferenceImages(
  planLimit: number,
  runtimeLimit: number
) {
  const safePlanLimit = Number.isFinite(planLimit)
    ? Math.max(1, Math.floor(planLimit))
    : 1;
  const safeRuntimeLimit = Number.isFinite(runtimeLimit)
    ? Math.max(1, Math.floor(runtimeLimit))
    : 1;
  return Math.min(safePlanLimit, safeRuntimeLimit);
}
