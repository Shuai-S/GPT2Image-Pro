/**
 * 图生图参考图数量限制。
 *
 * 职责：读取全站图生图参考图硬上限，并与套餐限制取交集。
 * 使用方：创作页、/api/images/edit 与外部 /v1/images/edits。
 * 关键依赖：system-settings 的 IMAGE_EDIT_MAX_REFERENCE_IMAGES。
 */
import { getRuntimeSettingNumber } from "@repo/shared/system-settings";
import { DEFAULT_IMAGE_EDIT_MAX_REFERENCE_IMAGES } from "./edit-reference-limit-utils";

export {
  DEFAULT_IMAGE_EDIT_MAX_REFERENCE_IMAGES,
  getEffectiveImageEditMaxReferenceImages,
} from "./edit-reference-limit-utils";

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
