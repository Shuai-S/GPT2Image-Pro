"use client";

// 普通用户使用记录列表。提供筛选、桌面紧凑表格、手机记录列表与分页控件。

import {
  ChevronLeft,
  ChevronRight,
  History,
  ImageIcon,
  RotateCcw,
  Search,
} from "lucide-react";
import Image from "next/image";
import type { GenerationUsageRow } from "./account-mock-data";
import sharedStyles from "./account-preview.module.css";
import {
  EmptyState,
  formatCredits,
  StatusText,
} from "./account-preview-shared";
import styles from "./account-usage-preview.module.css";

export type UsageStatusFilter = "all" | GenerationUsageRow["status"];
export type UsageSourceFilter = "all" | GenerationUsageRow["source"];
export type UsageModelFilter =
  | "all"
  | "GPT Image 2"
  | "GPT Image 1.5"
  | "GPT Image 1 Mini";

/**
 * 把未知状态值收窄为使用记录筛选白名单。
 *
 * @param value URL 或表单提供的未信任字符串。
 * @returns 合法状态；未知值回退 all。
 * @sideEffects 无。
 */
export function parseUsageStatusFilter(
  value: string | null
): UsageStatusFilter {
  if (value === "处理中" || value === "完成" || value === "失败") {
    return value;
  }
  return "all";
}

/**
 * 把未知来源值收窄为使用记录筛选白名单。
 *
 * @param value URL 或表单提供的未信任字符串。
 * @returns 合法来源；未知值回退 all。
 * @sideEffects 无。
 */
export function parseUsageSourceFilter(
  value: string | null
): UsageSourceFilter {
  return value === "基础创作" || value === "无限画布" ? value : "all";
}

/**
 * 把未知模型值收窄为普通用户可见的模型筛选白名单。
 *
 * @param value URL 或表单提供的未信任字符串。
 * @returns 合法模型；未知值回退 all。
 * @sideEffects 无。
 */
export function parseUsageModelFilter(value: string | null): UsageModelFilter {
  if (
    value === "GPT Image 2" ||
    value === "GPT Image 1.5" ||
    value === "GPT Image 1 Mini"
  ) {
    return value;
  }
  return "all";
}

/**
 * 选择最能代表记录的用户可见缩略图。
 *
 * @param record 当前用户的一条生成记录。
 * @returns 首张结果图、首张参考图或 null。
 * @sideEffects 无；不读取内部渠道或存储元数据。
 */
function getUsageThumbnail(record: GenerationUsageRow) {
  return record.resultImages[0] ?? record.referenceImages[0] ?? null;
}

/**
 * 渲染单条使用记录的稳定缩略图。
 *
 * @param props.eager 是否作为当前页首屏媒体立即加载。
 * @param props.record 当前用户记录。
 * @returns 结果或参考图缩略图；无图片时显示中性占位。
 * @sideEffects 仅加载仓库内 gallery-examples 资源。
 */
function UsageThumbnail({
  eager,
  record,
}: {
  eager: boolean;
  record: GenerationUsageRow;
}) {
  const src = getUsageThumbnail(record);
  if (!src) {
    return (
      <span className={styles.thumbnailPlaceholder}>
        <ImageIcon size={15} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className={styles.thumbnail}>
      <Image
        src={src}
        alt=""
        width={96}
        height={72}
        loading={eager ? "eager" : "lazy"}
        sizes="56px"
        unoptimized
      />
    </span>
  );
}

/**
 * 渲染使用记录筛选栏。
 *
 * @param props 当前查询、状态、来源及变更回调。
 * @returns 可清空的提示词、标识、状态和来源筛选控件。
 * @sideEffects 仅通知父组件更新本地与 URL 状态。
 */
function UsageFilters({
  model,
  query,
  status,
  source,
  onModelChange,
  onQueryChange,
  onReset,
  onSourceChange,
  onStatusChange,
}: {
  model: UsageModelFilter;
  query: string;
  status: UsageStatusFilter;
  source: UsageSourceFilter;
  onModelChange: (model: UsageModelFilter) => void;
  onQueryChange: (query: string) => void;
  onReset: () => void;
  onSourceChange: (source: UsageSourceFilter) => void;
  onStatusChange: (status: UsageStatusFilter) => void;
}) {
  const hasFilters = Boolean(
    query || status !== "all" || model !== "all" || source !== "all"
  );

  return (
    <div className={styles.filterBar}>
      <label className={styles.searchField}>
        <span>搜索使用记录</span>
        <Search size={14} aria-hidden="true" />
        <input
          value={query}
          placeholder="提示词、模型、生成 ID 或请求 ID"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <label className={styles.filterField}>
        <span>状态</span>
        <select
          value={status}
          onChange={(event) =>
            onStatusChange(parseUsageStatusFilter(event.target.value))
          }
        >
          <option value="all">全部状态</option>
          <option value="处理中">处理中</option>
          <option value="完成">完成</option>
          <option value="失败">失败</option>
        </select>
      </label>
      <label className={styles.filterField}>
        <span>模型</span>
        <select
          value={model}
          onChange={(event) =>
            onModelChange(parseUsageModelFilter(event.target.value))
          }
        >
          <option value="all">全部模型</option>
          <option value="GPT Image 2">GPT Image 2</option>
          <option value="GPT Image 1.5">GPT Image 1.5</option>
          <option value="GPT Image 1 Mini">GPT Image 1 Mini</option>
        </select>
      </label>
      <label className={styles.filterField}>
        <span>来源</span>
        <select
          value={source}
          onChange={(event) =>
            onSourceChange(parseUsageSourceFilter(event.target.value))
          }
        >
          <option value="all">全部来源</option>
          <option value="基础创作">基础创作</option>
          <option value="无限画布">无限画布</option>
        </select>
      </label>
      <button
        type="button"
        className={sharedStyles.iconButton}
        aria-label="清除使用记录筛选"
        title="清除筛选"
        disabled={!hasFilters}
        onClick={onReset}
      >
        <RotateCcw size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * 渲染桌面端当前页使用记录紧凑表格。
 *
 * @param props.records 当前筛选页的用户记录。
 * @param props.onOpen 打开只读详情的回调。
 * @returns 固定列宽、可扫描且不包含管理员字段的表格。
 * @sideEffects 点击详情按钮时通知父组件写入 URL。
 */
function DesktopUsageTable({
  records,
  onOpen,
}: {
  records: GenerationUsageRow[];
  onOpen: (recordId: string) => void;
}) {
  return (
    <div className={styles.desktopUsageTable}>
      <table>
        <thead>
          <tr>
            <th aria-label="预览" />
            <th>提示词与记录</th>
            <th>模型与尺寸</th>
            <th>来源</th>
            <th>状态</th>
            <th>实际积分</th>
            <th>创建时间</th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => (
            <tr key={record.id}>
              <td>
                <UsageThumbnail eager={index < 6} record={record} />
              </td>
              <td className={styles.promptCell}>
                <strong>{record.prompt}</strong>
                <small>{record.id}</small>
              </td>
              <td>
                <strong>{record.model}</strong>
                <small>
                  {record.size} · {record.images} 张
                </small>
              </td>
              <td>{record.source}</td>
              <td>
                <StatusText status={record.status} />
              </td>
              <td>{formatCredits(record.credits)}</td>
              <td>{record.occurredAt}</td>
              <td>
                <button
                  type="button"
                  className={sharedStyles.iconButton}
                  aria-label={`查看 ${record.id} 详情`}
                  title="查看详情"
                  onClick={() => onOpen(record.id)}
                >
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 渲染手机端当前页使用记录列表。
 *
 * @param props.records 当前筛选页的用户记录。
 * @param props.onOpen 打开只读详情的回调。
 * @returns 不依赖横向滚动的分组记录按钮。
 * @sideEffects 点击记录时通知父组件写入 URL。
 */
function MobileUsageList({
  records,
  onOpen,
}: {
  records: GenerationUsageRow[];
  onOpen: (recordId: string) => void;
}) {
  return (
    <div className={styles.mobileUsageList}>
      {records.map((record, index) => (
        <button
          type="button"
          className={styles.mobileUsageRecord}
          key={record.id}
          onClick={() => onOpen(record.id)}
        >
          <UsageThumbnail eager={index < 6} record={record} />
          <span className={styles.mobileRecordBody}>
            <span>
              <StatusText status={record.status} />
              <time>{record.occurredAt}</time>
            </span>
            <strong>{record.prompt}</strong>
            <small>
              {record.model} · {record.size} · {record.images} 张 ·{" "}
              {record.source}
            </small>
            <small>
              {record.id} · {formatCredits(record.credits)} 积分
            </small>
          </span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/**
 * 渲染使用记录分页。
 *
 * @param props 当前页、总页数、总记录数及翻页回调。
 * @returns 稳定尺寸的上一页、下一页命令与计数。
 * @sideEffects 仅通知父组件更新 URL 页码。
 */
function UsagePagination({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <footer className={styles.pagination}>
      <span>
        第 {page} / {pageCount} 页，共 {total} 条
      </span>
      <div>
        <button
          type="button"
          className={sharedStyles.iconButton}
          aria-label="上一页"
          title="上一页"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={sharedStyles.iconButton}
          aria-label="下一页"
          title="下一页"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}

/**
 * 渲染普通用户使用记录的完整列表区域。
 *
 * @param props 当前筛选状态、分页结果和交互回调。
 * @returns 筛选栏、双端列表、空状态及可实际切换的分页。
 * @sideEffects 所有交互均由父组件同步本地 URL，不调用真实接口。
 */
export function UsageRecords({
  model,
  page,
  pageCount,
  pageRecords,
  query,
  source,
  status,
  total,
  onModelChange,
  onOpen,
  onPageChange,
  onQueryChange,
  onReset,
  onSourceChange,
  onStatusChange,
}: {
  model: UsageModelFilter;
  page: number;
  pageCount: number;
  pageRecords: GenerationUsageRow[];
  query: string;
  source: UsageSourceFilter;
  status: UsageStatusFilter;
  total: number;
  onModelChange: (model: UsageModelFilter) => void;
  onOpen: (recordId: string) => void;
  onPageChange: (page: number) => void;
  onQueryChange: (query: string) => void;
  onReset: () => void;
  onSourceChange: (source: UsageSourceFilter) => void;
  onStatusChange: (status: UsageStatusFilter) => void;
}) {
  return (
    <section className={styles.usageRecordsRegion}>
      <header className={styles.recordsHeader}>
        <div>
          <h2>使用记录</h2>
          <p>仅显示你的生成记录。</p>
        </div>
        <span>{total} 条匹配记录</span>
      </header>
      <UsageFilters
        model={model}
        query={query}
        source={source}
        status={status}
        onModelChange={onModelChange}
        onQueryChange={onQueryChange}
        onReset={onReset}
        onSourceChange={onSourceChange}
        onStatusChange={onStatusChange}
      />

      {pageRecords.length > 0 ? (
        <>
          <DesktopUsageTable records={pageRecords} onOpen={onOpen} />
          <MobileUsageList records={pageRecords} onOpen={onOpen} />
          <UsagePagination
            page={page}
            pageCount={pageCount}
            total={total}
            onPageChange={onPageChange}
          />
        </>
      ) : (
        <EmptyState
          icon={History}
          title="没有匹配的使用记录"
          description="调整提示词、状态、模型或来源筛选后再试。"
        />
      )}
    </section>
  );
}
