/**
 * 注册邮箱域名纯工具。
 *
 * 职责：提供邮箱规范化、注册身份去重键计算、注册邮箱后缀列表解析与白名单判定。
 * 使用方：注册页客户端提示、注册验证码服务、Better Auth 注册钩子、系统设置写入校验。
 * 关键依赖：无运行时 DB 依赖；必须保持可被客户端组件安全导入。
 */

export const REGISTRATION_EMAIL_DOMAINS_SETTING_KEY =
  "REGISTRATION_EMAIL_DOMAINS" as const;

export const DEFAULT_REGISTRATION_EMAIL_DOMAIN_LIST = Object.freeze([
  "163.com",
  "126.com",
  "qq.com",
  "gmail.com",
]);

const REGISTRATION_EMAIL_DOMAIN_SEPARATOR = /[\s,;，；]+/;
const REGISTRATION_EMAIL_DOMAIN_LABEL_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const ALLOWED_REGISTRATION_EMAIL_DOMAIN_LIST = Array.from(
  DEFAULT_REGISTRATION_EMAIL_DOMAIN_LIST
);

/**
 * 规范化邮箱地址用于登录、展示和查重的基础输入。
 *
 * @param email - 用户输入的邮箱地址。
 * @returns 去首尾空白并转小写后的邮箱地址。
 * @sideEffects 无。
 */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const GMAIL_ALIAS_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * 计算用于"注册身份唯一性"判定的规范化邮箱键。
 *
 * 防薅羊毛：同一真实邮箱的别名（Gmail 点号 v.i.c.t.i.m、所有域的 +tag）
 * 会落到同一身份键，从而被唯一约束拦截，避免一个邮箱注册多个账号领取注册奖励。
 *
 * 注意：此值仅用于身份去重，不用于实际收件/展示（那些仍用 normalizeEmail 的原始地址）。
 */
export function canonicalizeEmailForIdentity(email: string) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0) {
    return normalized;
  }

  let local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);

  // 去除 plus-addressing 标签（对所有域生效）
  const plusIndex = local.indexOf("+");
  if (plusIndex >= 0) {
    local = local.slice(0, plusIndex);
  }

  // Gmail / Googlemail 忽略点号
  if (GMAIL_ALIAS_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
  }

  if (!local) {
    return normalized;
  }

  return `${local}@${domain}`;
}

/**
 * 将管理员输入的邮箱后缀单项规范化。
 *
 * @param domain - 单个邮箱域名或带 @ 前缀的后缀。
 * @returns 去空白、去 @ 前缀、去末尾点号并转小写后的域名。
 * @sideEffects 无。
 */
export function normalizeRegistrationEmailDomain(domain: string) {
  return domain.trim().toLowerCase().replace(/^@+/, "").replace(/\.+$/, "");
}

/**
 * 判断邮箱后缀是否是可用于注册白名单的普通域名。
 *
 * @param domain - 已规范化或未规范化的邮箱域名。
 * @returns 域名格式合法时返回 true。
 * @sideEffects 无。
 */
export function isValidRegistrationEmailDomain(domain: string) {
  const normalized = normalizeRegistrationEmailDomain(domain);
  if (!normalized || normalized.length > 253) return false;
  const labels = normalized.split(".");
  if (labels.length < 2) return false;
  const lastLabel = labels[labels.length - 1];
  if (!lastLabel || lastLabel.length < 2) return false;
  return labels.every((label) =>
    REGISTRATION_EMAIL_DOMAIN_LABEL_PATTERN.test(label)
  );
}

/**
 * 解析管理员输入的注册邮箱后缀列表。
 *
 * @param value - 逗号、分号、空白或换行分隔的邮箱域名列表。
 * @returns 去重后的合法域名，以及无法识别的无效项。
 * @sideEffects 无。
 */
export function normalizeRegistrationEmailDomains(value: string) {
  const domains: string[] = [];
  const invalidDomains: string[] = [];
  const seen = new Set<string>();

  for (const rawToken of value.split(REGISTRATION_EMAIL_DOMAIN_SEPARATOR)) {
    const domain = normalizeRegistrationEmailDomain(rawToken);
    if (!domain) continue;

    if (!isValidRegistrationEmailDomain(domain)) {
      invalidDomains.push(domain);
      continue;
    }

    if (!seen.has(domain)) {
      seen.add(domain);
      domains.push(domain);
    }
  }

  return { domains, invalidDomains };
}

/**
 * 读取注册邮箱白名单域名列表，空值或无有效项时回退代码默认值。
 *
 * @param value - 后台配置或环境变量中的域名列表。
 * @returns 可用于展示和校验的域名数组。
 * @sideEffects 无。
 */
export function parseRegistrationEmailDomains(value?: string | null) {
  const { domains } = normalizeRegistrationEmailDomains(value ?? "");
  return domains.length > 0
    ? domains
    : Array.from(DEFAULT_REGISTRATION_EMAIL_DOMAIN_LIST);
}

/**
 * 格式化注册邮箱域名列表用于存储、提示和错误消息。
 *
 * @param domains - 域名列表。
 * @returns 逗号分隔的域名字符串。
 * @sideEffects 无。
 */
export function formatRegistrationEmailDomains(
  domains: readonly string[] = DEFAULT_REGISTRATION_EMAIL_DOMAIN_LIST
) {
  return domains.join(",");
}

/**
 * 判断邮箱是否命中当前注册白名单域名。
 *
 * @param email - 用户输入的邮箱地址。
 * @param allowedDomains - 允许注册的邮箱域名列表；空数组回退默认列表。
 * @returns 邮箱域名在白名单内时返回 true。
 * @sideEffects 无。
 */
export function isAllowedRegistrationEmail(
  email: string,
  allowedDomains: readonly string[] = DEFAULT_REGISTRATION_EMAIL_DOMAIN_LIST
) {
  const normalizedEmail = normalizeEmail(email);
  const domain = normalizedEmail.split("@")[1];
  const effectiveDomains =
    allowedDomains.length > 0
      ? allowedDomains
      : DEFAULT_REGISTRATION_EMAIL_DOMAIN_LIST;
  const allowed = new Set(
    effectiveDomains
      .map((item) => normalizeRegistrationEmailDomain(item))
      .filter(isValidRegistrationEmailDomain)
  );
  return Boolean(domain && allowed.has(domain));
}

/**
 * 生成注册邮箱后缀不允许时的用户可见错误消息。
 *
 * @param allowedDomains - 允许注册的邮箱域名列表。
 * @returns 英文错误消息，供服务端 API 透传和客户端兜底识别。
 * @sideEffects 无。
 */
export function getAllowedRegistrationEmailMessage(
  allowedDomains: readonly string[] = DEFAULT_REGISTRATION_EMAIL_DOMAIN_LIST
) {
  return `Please use one of these email domains: ${allowedDomains.join(", ")}.`;
}
