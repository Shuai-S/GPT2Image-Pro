/**
 * 图生图参考图数量限制。
 *
 * 职责：读取全站图生图参考图硬上限，并与套餐限制取交集。
 * 使用方：创作页、/api/images/edit 与外部 /v1/images/edits。
 * 关键依赖：system-settings 的 IMAGE_EDIT_MAX_REFERENCE_IMAGES。
 */
import { getRuntimeSettingNumber } from "@repo/shared/system-settings";

export const DEFAULT_IMAGE_EDIT_MAX_REFERENCE_IMAGES = 4;
const IMAGE_EDIT_MAX_REFERENCE_IMAGES_SETTING =
  "IMAGE_EDIT_MAX_REFERENCE_IMAGES";

/**
 * 获取全站图生图参考图硬上限。
 *
 * @returns 正整数参考图上限；配置异常时回退到 4。
 * @sideEffects 读取运行时系统设置缓存，可能触达数据库。
 * @failureMode 非正数或非数字配置由 system-settings fallback 兜底。
 */
export async function getRuntimeImageEditMaxReferenceImages() {
  const value = await getRuntimeSettingNumber(
    IMAGE_EDIT_MAX_REFERENCE_IMAGES_SETTING,
    DEFAULT_IMAGE_EDIT_MAX_REFERENCE_IMAGES,
    { positive: true }
  );
  return Math.max(1, Math.floor(value));
}

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
