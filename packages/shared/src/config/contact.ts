/**
 * 公开联系邮箱配置。
 *
 * 职责：规范化管理员配置的站点联系邮箱，并在运行时从 system_settings 读取。
 * 使用方：首页页脚、SEO 结构化数据与其他公开联系方式展示。
 * 关键依赖：system-settings 运行时配置读取；为避免 DB 依赖扩散，读取函数内动态导入。
 */

export const DEFAULT_CONTACT_EMAIL = "hello@gpt2image.com";

const MAX_CONTACT_EMAIL_LENGTH = 254;
const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 规范化公开联系邮箱。
 *
 * @param value - 管理员配置或环境变量中的邮箱文本。
 * @returns 合法邮箱的小写形式；为空或非法时返回 undefined。
 * @sideEffects 无。
 * @throws 不抛出异常；由调用方决定非法输入是回退还是拒绝。
 */
export function normalizeContactEmail(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > MAX_CONTACT_EMAIL_LENGTH) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase();
  return CONTACT_EMAIL_PATTERN.test(normalized) ? normalized : undefined;
}

/**
 * 解析可公开展示的联系邮箱。
 *
 * @param value - 未规范化的邮箱文本。
 * @returns 合法邮箱，非法或为空时回退代码默认联系邮箱。
 * @sideEffects 无。
 * @throws 不抛出异常。
 */
export function resolveContactEmail(value: string | undefined) {
  return normalizeContactEmail(value) ?? DEFAULT_CONTACT_EMAIL;
}

/**
 * 读取运行时公开联系邮箱。
 *
 * @returns 后台系统设置、环境变量或代码默认值解析出的公开联系邮箱。
 * @sideEffects 正常运行时读取 system_settings 表；构建期可按系统设置规则回退环境变量。
 * @throws DB 访问异常会向上抛出，由调用方所属页面处理。
 */
export async function getRuntimeContactEmail() {
  const { getRuntimeSettingString } = await import("../system-settings");
  return resolveContactEmail(await getRuntimeSettingString("CONTACT_EMAIL"));
}
