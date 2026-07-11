// 管理控制台原型的共享类型、格式化函数和小型展示组件。

import {
  BookOpenCheck,
  LifeBuoy,
  type LucideIcon,
  WalletCards,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AdminUserStatus } from "./admin-mock-data";
import styles from "./admin-preview.module.css";

/** 原型支持的明暗主题。 */
export type PreviewTheme = "dark" | "light";

/** 管理控制台一级页面标识。 */
export type AdminSection =
  | "overview"
  | "users"
  | "usage"
  | "tickets"
  | "payments"
  | "referrals"
  | "announcements"
  | "backends"
  | "settings";

/** 用户检查器的可链接标签。 */
export type UserInspectorTab =
  | "overview"
  | "credits"
  | "orders"
  | "generations"
  | "api"
  | "support"
  | "audit";

/**
 * 根据路由 locale 选择原型文案。
 *
 * @param locale 当前页面语言。
 * @param english 英文文案。
 * @param chinese 简体中文文案。
 * @returns 与 locale 匹配的文案，不产生副作用。
 */
export function copy(locale: string, english: string, chinese: string) {
  return locale.toLowerCase().startsWith("zh") ? chinese : english;
}

/**
 * 格式化紧凑整数，保持不同指标宽度稳定。
 *
 * @param value 需要显示的数值。
 * @param locale 当前页面语言。
 * @returns 使用本地千分位的紧凑数值。
 */
export function formatCompactNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * 格式化人民币金额。
 *
 * @param value 人民币元值。
 * @param locale 当前页面语言。
 * @returns 不包含多余小数的人民币金额。
 */
export function formatCny(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * 将用户状态映射为本地化文本。
 *
 * @param status 用户状态枚举。
 * @param locale 当前页面语言。
 * @returns 用于状态标签的可读文本。
 */
export function formatUserStatus(status: AdminUserStatus, locale: string) {
  const labels: Record<AdminUserStatus, [string, string]> = {
    active: ["Active", "正常"],
    frozen: ["Frozen", "冻结"],
    disabled: ["Disabled", "停用"],
  };
  const label = labels[status];
  return copy(locale, label[0], label[1]);
}

/**
 * 渲染带语义色和文字双重编码的小型状态标签。
 *
 * @param props.tone 状态语义键。
 * @param props.children 可读状态文本。
 * @returns 不依赖颜色单独表达含义的标签。
 */
export function StatusBadge({
  tone,
  children,
}: {
  tone: string;
  children: ReactNode;
}) {
  return (
    <span className={styles.statusBadge} data-tone={tone}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * 统一检查器内部区块标题与内容间距。
 *
 * @param props.title 区块标题。
 * @param props.children 区块主体。
 * @returns 无嵌套装饰卡片的检查器内容区。
 */
export function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.detailSection}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/**
 * 为检查器内的数据表提供稳定滚动容器。
 *
 * @param props.children 合法 table 子节点。
 * @returns 紧凑表格元素。
 */
export function CompactTable({ children }: { children: ReactNode }) {
  return (
    <div className={styles.compactTableScroll}>
      <table className={styles.compactTable}>{children}</table>
    </div>
  );
}

/**
 * 渲染检查器标签的明确空状态。
 *
 * @param props.locale 当前语言。
 * @param props.label 空数据类型。
 * @returns 不提供虚假操作的空状态。
 */
export function InspectorEmpty({
  locale,
  label,
}: {
  locale: string;
  label: "orders" | "tickets" | "audit";
}) {
  const iconNames: Record<typeof label, LucideIcon> = {
    orders: WalletCards,
    tickets: LifeBuoy,
    audit: BookOpenCheck,
  };
  const Icon = iconNames[label];
  const labels: Record<typeof label, [string, string]> = {
    orders: ["No payment orders", "暂无支付订单"],
    tickets: ["No support tickets", "暂无支持工单"],
    audit: ["No resource audit records", "暂无相关审计记录"],
  };

  return (
    <div className={styles.inspectorEmpty}>
      <Icon size={20} aria-hidden="true" />
      <p>{copy(locale, labels[label][0], labels[label][1])}</p>
    </div>
  );
}
