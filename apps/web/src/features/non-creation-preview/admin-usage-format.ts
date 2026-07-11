// 管理使用记录原型的双语文案与展示格式，供列表和检查器复用。

import type { AdminUsageStatus } from "./admin-usage-mock-data";

/**
 * 根据 locale 选择双语界面文案。
 *
 * @param locale 当前预览路由语言。
 * @param english 英文文案。
 * @param chinese 简体中文文案。
 * @returns 与 locale 匹配的文本。
 */
export function copy(locale: string, english: string, chinese: string) {
  return locale.toLowerCase().startsWith("zh") ? chinese : english;
}

/**
 * 格式化积分并去除无意义尾零。
 *
 * @param value 积分数值。
 * @param locale 当前语言。
 * @returns 最多两位小数的本地化积分。
 */
export function formatCredits(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    value
  );
}

/**
 * 格式化生成耗时。
 *
 * @param durationMs 毫秒耗时，pending 时为 null。
 * @param locale 当前语言。
 * @returns 秒级紧凑文本或短横线。
 */
export function formatDuration(durationMs: number | null, locale: string) {
  if (durationMs === null) return "-";
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return copy(locale, `${seconds}s`, `${seconds} 秒`);
}

/**
 * 格式化生成时间供表格和检查器展示。
 *
 * @param iso ISO 时间。
 * @param locale 当前语言。
 * @param detailed 是否包含秒。
 * @returns 当前 locale 的稳定日期时间。
 */
export function formatUsageDate(iso: string, locale: string, detailed = false) {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: detailed ? "2-digit" : undefined,
    hour12: false,
  }).format(new Date(iso));
}

/**
 * 返回本地化状态文本。
 *
 * @param status 生成状态。
 * @param locale 当前语言。
 * @returns 状态标签文案。
 */
export function statusLabel(status: AdminUsageStatus, locale: string) {
  const labels: Record<AdminUsageStatus, [string, string]> = {
    completed: ["Completed", "已完成"],
    pending: ["Pending", "处理中"],
    failed: ["Failed", "失败"],
  };
  return copy(locale, labels[status][0], labels[status][1]);
}
