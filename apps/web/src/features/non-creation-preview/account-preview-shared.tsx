"use client";

// 账户中心原型共享的标题、状态、标签、空白状态和对话框基础组件。

import { type LucideIcon, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import styles from "./account-preview.module.css";

export type AccountNotice = {
  tone: "success" | "info";
  text: string;
} | null;

/**
 * 格式化积分数值，统一保留最多两位小数。
 *
 * @param value 积分数量。
 * @returns 适合账务界面展示的数值文本。
 * @sideEffects 无。
 */
export function formatCredits(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * 根据业务状态返回受控语义色名称。
 *
 * @param status 页面中已知的状态文本。
 * @returns CSS 数据属性使用的语义状态。
 * @sideEffects 无；未知状态安全回退到中性样式。
 */
function getStatusTone(status: string) {
  if (
    ["已支付", "已履约", "完成", "可转换", "已完成", "当前"].includes(status)
  ) {
    return "success";
  }
  if (["处理中", "冻结中", "待处理", "重要"].includes(status)) {
    return "warning";
  }
  if (["失败", "已退款", "已撤销"].includes(status)) return "danger";
  return "neutral";
}

/**
 * 渲染具备统一关闭行为的原型对话框外壳。
 *
 * @param props 标题、说明、内容、宽度和关闭回调。
 * @returns 带遮罩、语义和稳定尺寸的模态层。
 * @sideEffects 挂载时聚焦面板，按 Escape 关闭；不实现真实业务动作。
 */
export function DialogShell({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <button
        type="button"
        className={styles.dialogScrim}
        aria-label="关闭对话框"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className={styles.dialog}
        data-wide={wide}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-preview-dialog-title"
        tabIndex={-1}
      >
        <header className={styles.dialogHeader}>
          <div>
            <h2 id="account-preview-dialog-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="关闭对话框"
            title="关闭"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.dialogBody}>{children}</div>
      </div>
    </div>
  );
}

/**
 * 渲染统一页面标题与可选命令区。
 *
 * @param props 层级标签、标题、说明和命令节点。
 * @returns 响应式页面抬头。
 * @sideEffects 无。
 */
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.pageHeading}>
      <div>
        <span className={styles.sectionLabel}>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className={styles.pageHeadingAction}>{action}</div>}
    </header>
  );
}

/**
 * 渲染类型安全的分段标签控件。
 *
 * @param props 当前值、可选项和切换回调。
 * @returns 适合少量互斥视图的分段控件。
 * @sideEffects 点击后只通知父组件更新本地值。
 */
export function SegmentedTabs<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T;
  items: Array<{ id: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmentedTabs} role="tablist">
      {items.map((item) => (
        <button
          type="button"
          role="tab"
          key={item.id}
          aria-selected={value === item.id}
          data-active={value === item.id}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 渲染带标题的数据表区域，不把页面区块包装成浮动卡片。
 *
 * @param props 标题、说明和表格或记录列表内容。
 * @returns 连续数据带布局。
 * @sideEffects 无。
 */
export function DataRegion({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.dataRegion}>
      <header>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span>模拟数据</span>
      </header>
      {children}
    </section>
  );
}

/**
 * 渲染带文字编码的语义状态，颜色不是唯一识别方式。
 *
 * @param props.status 需要展示的状态文本。
 * @returns 状态点与原始文字。
 * @sideEffects 无。
 */
export function StatusText({ status }: { status: string }) {
  return (
    <span className={styles.statusText} data-tone={getStatusTone(status)}>
      <span aria-hidden="true" />
      {status}
    </span>
  );
}

/**
 * 渲染可复用的空白状态。
 *
 * @param props 图标、标题、说明和紧凑模式。
 * @returns 无营销装饰的中性空状态。
 * @sideEffects 无。
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div className={styles.emptyState} data-compact={compact}>
      <Icon size={20} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
