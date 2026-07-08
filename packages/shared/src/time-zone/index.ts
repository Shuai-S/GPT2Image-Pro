/**
 * 时区工具
 *
 * 职责：集中校验 IANA 时区，并为客户端组件提供本机时区日期格式化兼容工具。
 * 使用方：仍在客户端内直接格式化时间的设置、积分与管理后台组件。
 * 关键依赖：Intl.DateTimeFormat；数据库时间仍以 UTC 存储。
 */
export const APP_TIME_ZONE_SETTING_KEY = "APP_TIME_ZONE";
export const DEFAULT_APP_TIME_ZONE = "UTC";

export const APP_TIME_ZONE_OPTIONS = [
  { label: "UTC", value: "UTC" },
  { label: "中国标准时间 (Asia/Shanghai)", value: "Asia/Shanghai" },
  { label: "香港时间 (Asia/Hong_Kong)", value: "Asia/Hong_Kong" },
  { label: "新加坡时间 (Asia/Singapore)", value: "Asia/Singapore" },
  { label: "日本时间 (Asia/Tokyo)", value: "Asia/Tokyo" },
  { label: "太平洋时间 (America/Los_Angeles)", value: "America/Los_Angeles" },
  { label: "东部时间 (America/New_York)", value: "America/New_York" },
  { label: "伦敦时间 (Europe/London)", value: "Europe/London" },
] as const;

/**
 * 校验并归一化 IANA 时区。
 *
 * @param value 待校验的时区字符串。
 * @param fallback 校验失败或为空时返回的兜底值。
 * @returns 合法 IANA 时区或 fallback。
 * @sideEffects 无。
 * @failureMode 非法时区不会抛出，而是回退到 fallback。
 */
export function normalizeTimeZone(
  value?: string | null,
  fallback = DEFAULT_APP_TIME_ZONE
) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return fallback;
  }
}

/**
 * 将应用语言转换为 Intl 日期时间 locale。
 *
 * @param locale 应用语言代码。
 * @returns Intl 可识别的 locale。
 * @sideEffects 无。
 * @failureMode 未知语言按英文展示，避免生成非法 locale。
 */
export function getDateTimeLocale(locale: string) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

/**
 * 格式化日期时间。
 *
 * @param value 日期值；允许 Date、时间字符串或时间戳。
 * @param locale 应用语言代码。
 * @param options Intl 日期时间格式化选项。
 * @param timeZone 兼容旧调用的可选 IANA 时区；新页面应留空，由浏览器本机时区渲染。
 * @returns 本地化日期时间字符串；空值返回空字符串，非法日期返回原值字符串。
 * @sideEffects 无。
 * @failureMode 非法日期不会抛错；传入非法兼容时区时按 normalizeTimeZone 的兜底规则处理。
 */
export function formatDateInTimeZone(
  value: Date | string | number | null | undefined,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  timeZone?: string | null
) {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const normalizedTimeZone = timeZone ? normalizeTimeZone(timeZone) : undefined;
  return new Intl.DateTimeFormat(getDateTimeLocale(locale), {
    ...options,
    ...(normalizedTimeZone ? { timeZone: normalizedTimeZone } : {}),
  }).format(date);
}

/**
 * 从 Intl formatToParts 结果中读取指定部分。
 *
 * @param parts Intl 日期时间片段。
 * @param type 需要读取的片段类型。
 * @returns 对应片段值；不存在时返回空字符串。
 * @sideEffects 无。
 * @failureMode 缺失字段返回空字符串，调用方负责处理无效日期。
 */
function getPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/**
 * 把 Date 格式化为指定时区中的日期输入值。
 *
 * @param date UTC 时间点。
 * @param timeZone IANA 时区。
 * @returns YYYY-MM-DD 日期字符串。
 * @sideEffects 无。
 * @failureMode 时区非法时回退到 DEFAULT_APP_TIME_ZONE。
 */
export function formatDateInputInTimeZone(
  date: Date,
  timeZone?: string | null
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${getPart(parts, "year")}-${getPart(parts, "month")}-${getPart(
    parts,
    "day"
  )}`;
}

/**
 * 计算指定时区相对 UTC 的偏移。
 *
 * @param date 用于计算偏移的 UTC 时间点。
 * @param timeZone IANA 时区。
 * @returns 毫秒级偏移量。
 * @sideEffects 无。
 * @failureMode 传入非法时区时 Intl 会抛错；调用方应先完成校验。
 */
function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const dateWithoutMs = new Date(date.getTime() - date.getMilliseconds());
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(dateWithoutMs);
  const asUtc = Date.UTC(
    Number(getPart(parts, "year")),
    Number(getPart(parts, "month")) - 1,
    Number(getPart(parts, "day")),
    Number(getPart(parts, "hour")),
    Number(getPart(parts, "minute")),
    Number(getPart(parts, "second"))
  );
  return asUtc - dateWithoutMs.getTime();
}

/**
 * 把指定时区中的本地日期时间转换为 UTC Date。
 *
 * @param timeZone IANA 时区。
 * @param year 年。
 * @param month 月，取值 1-12。
 * @param day 日。
 * @param hour 时。
 * @param minute 分。
 * @param second 秒。
 * @param millisecond 毫秒。
 * @returns 对应的 UTC Date。
 * @sideEffects 无。
 * @failureMode DST 边界使用二次偏移修正；非法时区由 getTimeZoneOffsetMs 抛出。
 */
function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number
) {
  const localAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond
  );
  const firstPass = new Date(
    localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timeZone)
  );
  return new Date(localAsUtc - getTimeZoneOffsetMs(firstPass, timeZone));
}

/**
 * 解析日期输入为指定时区自然日的 UTC 边界。
 *
 * @param value YYYY-MM-DD 日期输入。
 * @param options 解析选项，包含是否取日末与目标时区。
 * @returns UTC Date；输入非法时返回 null。
 * @sideEffects 无。
 * @failureMode 非法日期和非法数字返回 null；非法时区回退到 DEFAULT_APP_TIME_ZONE。
 */
export function parseDateInputInTimeZone(
  value: string | undefined,
  options?: { endOfDay?: boolean; timeZone?: string | null }
) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const timeZone = normalizeTimeZone(options?.timeZone);
  const date = zonedTimeToUtc(
    timeZone,
    year,
    month,
    day,
    options?.endOfDay ? 23 : 0,
    options?.endOfDay ? 59 : 0,
    options?.endOfDay ? 59 : 0,
    options?.endOfDay ? 999 : 0
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
