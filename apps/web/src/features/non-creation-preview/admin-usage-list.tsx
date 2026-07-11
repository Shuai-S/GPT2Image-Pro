// 管理使用记录原型的筛选栏、紧凑表格和分页渲染组件。

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Filter,
  ImageIcon,
  RotateCcw,
  Search,
  UserRound,
} from "lucide-react";
import Image from "next/image";
import type { FormEvent } from "react";
import {
  copy,
  formatCredits,
  formatDuration,
  formatUsageDate,
  statusLabel,
} from "./admin-usage-format";
import {
  type AdminUsageRecord,
  type AdminUsageStatus,
  adminUsageModels,
} from "./admin-usage-mock-data";
import styles from "./admin-usage-preview.module.css";
import {
  parseModel,
  parseStatus,
  type UsageFilters,
} from "./admin-usage-url-state";

/**
 * 渲染六项筛选、结果摘要及显式应用和重置命令。
 *
 * @param props 当前草稿筛选与交互回调。
 * @returns 不会在输入过程中误触发查询的筛选表单。
 */
export function UsageFilterBar({
  draft,
  error,
  locale,
  resultCount,
  totalCredits,
  onApply,
  onDraftChange,
  onReset,
}: {
  draft: UsageFilters;
  error: string | null;
  locale: string;
  resultCount: number;
  totalCredits: number;
  onApply: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (patch: Partial<UsageFilters>) => void;
  onReset: () => void;
}) {
  return (
    <form className={styles.filterBand} onSubmit={onApply}>
      <div className={styles.filterGrid}>
        <label>
          <span>{copy(locale, "User", "用户")}</span>
          <div className={styles.inputShell}>
            <UserRound size={14} aria-hidden="true" />
            <input
              value={draft.user}
              maxLength={80}
              placeholder={copy(
                locale,
                "Email, name, or ID",
                "邮箱、名称或用户 ID"
              )}
              onChange={(event) => onDraftChange({ user: event.target.value })}
            />
          </div>
        </label>
        <label>
          <span>{copy(locale, "Status", "状态")}</span>
          <select
            value={draft.status}
            onChange={(event) =>
              onDraftChange({ status: parseStatus(event.target.value) })
            }
          >
            <option value="all">
              {copy(locale, "All statuses", "全部状态")}
            </option>
            <option value="completed">
              {copy(locale, "Completed", "已完成")}
            </option>
            <option value="pending">{copy(locale, "Pending", "处理中")}</option>
            <option value="failed">{copy(locale, "Failed", "失败")}</option>
          </select>
        </label>
        <label>
          <span>{copy(locale, "Model", "模型")}</span>
          <select
            value={draft.model}
            onChange={(event) =>
              onDraftChange({ model: parseModel(event.target.value) })
            }
          >
            <option value="all">
              {copy(locale, "All models", "全部模型")}
            </option>
            {adminUsageModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{copy(locale, "Prompt", "提示词")}</span>
          <div className={styles.inputShell}>
            <Search size={14} aria-hidden="true" />
            <input
              value={draft.prompt}
              maxLength={160}
              placeholder={copy(locale, "Prompt contains", "提示词包含")}
              onChange={(event) =>
                onDraftChange({ prompt: event.target.value })
              }
            />
          </div>
        </label>
        <label>
          <span>{copy(locale, "From", "开始日期")}</span>
          <div className={styles.inputShell}>
            <CalendarDays size={14} aria-hidden="true" />
            <input
              type="date"
              value={draft.start}
              onChange={(event) => onDraftChange({ start: event.target.value })}
            />
          </div>
        </label>
        <label>
          <span>{copy(locale, "To", "结束日期")}</span>
          <div className={styles.inputShell}>
            <CalendarDays size={14} aria-hidden="true" />
            <input
              type="date"
              value={draft.end}
              onChange={(event) => onDraftChange({ end: event.target.value })}
            />
          </div>
        </label>
      </div>
      <div className={styles.filterFooter}>
        <span>
          {copy(
            locale,
            `${resultCount} records · ${formatCredits(totalCredits, locale)} credits`,
            `共 ${resultCount} 条 · ${formatCredits(totalCredits, locale)} 积分`
          )}
        </span>
        {error && (
          <span className={styles.filterError} role="alert">
            <CircleAlert size={13} aria-hidden="true" />
            {error}
          </span>
        )}
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onReset}
        >
          <RotateCcw size={14} aria-hidden="true" />
          {copy(locale, "Reset", "重置")}
        </button>
        <button type="submit" className={styles.primaryButton}>
          <Filter size={14} aria-hidden="true" />
          {copy(locale, "Apply filters", "应用筛选")}
        </button>
      </div>
    </form>
  );
}

/**
 * 渲染紧凑的全站生成记录表。
 *
 * @param props.records 当前分页记录。
 * @param props.locale 当前语言。
 * @param props.onOpen 打开记录检查器。
 * @returns 整行可点击且没有批量选择控件的数据表。
 */
export function UsageTable({
  records,
  locale,
  onOpen,
}: {
  records: AdminUsageRecord[];
  locale: string;
  onOpen: (recordId: string) => void;
}) {
  return (
    <section className={styles.tableFrame} aria-label="Usage record table">
      <div className={styles.tableScroll}>
        <div className={styles.tableHeader} aria-hidden="true">
          <span>{copy(locale, "Image", "缩略图")}</span>
          <span>{copy(locale, "User", "用户")}</span>
          <span>{copy(locale, "Channel", "渠道")}</span>
          <span>{copy(locale, "Prompt", "提示词")}</span>
          <span>{copy(locale, "Model / size", "模型 / 尺寸")}</span>
          <span>{copy(locale, "Credits", "积分")}</span>
          <span>{copy(locale, "Status", "状态")}</span>
          <span>{copy(locale, "Duration", "耗时")}</span>
          <span>{copy(locale, "Time", "时间")}</span>
        </div>
        <div className={styles.tableBody}>
          {records.map((record, index) => (
            <button
              type="button"
              className={styles.tableRow}
              key={record.id}
              aria-label={copy(
                locale,
                `Inspect ${record.id}`,
                `检查记录 ${record.id}`
              )}
              onClick={() => onOpen(record.id)}
            >
              <UsageThumbnail eager={index < 8} record={record} />
              <span className={styles.userCell}>
                <strong>{record.user.email}</strong>
                <small>
                  {record.user.name} · {record.user.id}
                </small>
              </span>
              <span
                className={styles.channelCell}
                title={record.channel.detail}
              >
                <strong>{record.channel.provider}</strong>
                <small>{record.channel.detail}</small>
              </span>
              <span className={styles.promptCell}>
                <strong>{record.prompt}</strong>
                {record.error && (
                  <small data-tone="failed">{record.error.message}</small>
                )}
              </span>
              <span className={styles.modelCell}>
                <strong>{record.model}</strong>
                <small>{record.size}</small>
              </span>
              <span className={styles.creditCell}>
                <strong>{formatCredits(record.credits.total, locale)}</strong>
                <small>x{record.credits.multiplier}</small>
              </span>
              <StatusBadge locale={locale} status={record.status} />
              <span className={styles.durationCell}>
                <Clock3 size={12} aria-hidden="true" />
                {formatDuration(record.durationMs, locale)}
              </span>
              <span className={styles.timeCell}>
                {formatUsageDate(record.createdAt, locale)}
              </span>
            </button>
          ))}
          {records.length === 0 && (
            <div className={styles.emptyState}>
              <Search size={20} aria-hidden="true" />
              <strong>
                {copy(locale, "No matching records", "没有匹配的记录")}
              </strong>
              <span>
                {copy(
                  locale,
                  "Adjust or reset the current filters.",
                  "请调整或重置当前筛选条件。"
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * 渲染生成结果缩略图，非完成状态显示稳定占位。
 *
 * @param props.eager 是否作为首屏媒体立即加载。
 * @param props.record 当前使用记录。
 * @returns 固定 48px 的结果预览。
 */
function UsageThumbnail({
  eager,
  record,
}: {
  eager: boolean;
  record: AdminUsageRecord;
}) {
  return (
    <span className={styles.thumbnail} data-status={record.status}>
      {record.thumbnail ? (
        <Image
          src={record.thumbnail}
          alt=""
          fill
          loading={eager ? "eager" : "lazy"}
          sizes="48px"
          className={styles.thumbnailImage}
        />
      ) : (
        <ImageIcon size={17} aria-hidden="true" />
      )}
    </span>
  );
}

/**
 * 渲染带文字与状态点的生成状态。
 *
 * @param props.status 当前生成状态。
 * @param props.locale 当前语言。
 * @returns 不仅依赖颜色表达含义的紧凑状态。
 */
export function StatusBadge({
  status,
  locale,
}: {
  status: AdminUsageStatus;
  locale: string;
}) {
  return (
    <span className={styles.statusBadge} data-tone={status}>
      <i aria-hidden="true" />
      {statusLabel(status, locale)}
    </span>
  );
}

/**
 * 渲染上一页、页码、下一页和总记录摘要。
 *
 * @param props 当前分页信息与切换回调。
 * @returns 最少一页的稳定分页栏。
 */
export function UsagePagination({
  currentPage,
  locale,
  pageSize,
  totalCount,
  totalPages,
  onChange,
}: {
  currentPage: number;
  locale: string;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  const start = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(totalCount, currentPage * pageSize);
  const visiblePages = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => {
      const windowStart = Math.min(
        Math.max(1, currentPage - 2),
        Math.max(1, totalPages - 4)
      );
      return windowStart + index;
    }
  );

  return (
    <footer className={styles.pagination}>
      <span>
        {copy(
          locale,
          `${start}-${end} of ${totalCount}`,
          `第 ${start}-${end} 条，共 ${totalCount} 条`
        )}
      </span>
      <div>
        <button
          type="button"
          disabled={currentPage <= 1}
          aria-label={copy(locale, "Previous page", "上一页")}
          title={copy(locale, "Previous page", "上一页")}
          onClick={() => onChange(currentPage - 1)}
        >
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        {visiblePages.map((item) => (
          <button
            type="button"
            data-active={item === currentPage}
            aria-current={item === currentPage ? "page" : undefined}
            key={item}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ))}
        <button
          type="button"
          disabled={currentPage >= totalPages}
          aria-label={copy(locale, "Next page", "下一页")}
          title={copy(locale, "Next page", "下一页")}
          onClick={() => onChange(currentPage + 1)}
        >
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
