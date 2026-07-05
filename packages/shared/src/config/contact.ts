/**
 * 公开联系邮箱配置。
 *
 * 职责：提供可在浏览器与服务端共享的联系邮箱默认值、规范化与回退规则。
 * 使用方：系统设置定义、后台设置校验、公开页脚与 SEO 展示逻辑。
 * 关键依赖：无数据库依赖；运行时读取 CONTACT_EMAIL 的逻辑放在 contact-runtime.ts。
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
 * @returns 合法邮箱；非法或为空时回退代码默认联系邮箱。
 * @sideEffects 无。
 * @throws 不抛出异常。
 */
export function resolveContactEmail(value: string | undefined) {
  return normalizeContactEmail(value) ?? DEFAULT_CONTACT_EMAIL;
}
