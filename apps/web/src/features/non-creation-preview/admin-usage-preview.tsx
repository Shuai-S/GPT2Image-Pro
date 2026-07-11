"use client";

// 管理“使用记录”高保真原型。负责编排本地筛选、分页、URL 状态和记录检查器。

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { copy } from "./admin-usage-format";
import { AdminUsageInspector } from "./admin-usage-inspector";
import {
  UsageFilterBar,
  UsagePagination,
  UsageTable,
} from "./admin-usage-list";
import { adminUsageRecords } from "./admin-usage-mock-data";
import styles from "./admin-usage-preview.module.css";
import {
  defaultFilters,
  readUsageUrlState,
  type UsageFilters,
  validateDateRange,
  writeUsageUrlState,
} from "./admin-usage-url-state";

const PAGE_SIZE = 20;

/** 使用记录独立预览支持的显式主题。 */
export type AdminUsagePreviewTheme = "dark" | "light";

/**
 * 管理端全站使用记录高保真原型。
 *
 * @param props.locale 当前预览路由语言。
 * @param props.theme 可选独立主题；嵌入管理壳时省略即可继承全局 Token。
 * @param props.onOpenUser 可选的用户详情跳转命令。
 * @returns 仅修改本地状态的筛选表格、分页和记录检查器。
 * @sideEffects 同步白名单 URL，并监听 popstate 与 Escape。
 */
export function AdminUsagePreview({
  locale,
  theme,
  onOpenUser,
}: {
  locale: string;
  theme?: AdminUsagePreviewTheme;
  onOpenUser?: (userId: string) => void;
}) {
  const initialState = readUsageUrlState();
  const [filters, setFilters] = useState<UsageFilters>(initialState.filters);
  const [draftFilters, setDraftFilters] = useState<UsageFilters>(
    initialState.filters
  );
  const [page, setPage] = useState(initialState.page);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialState.selectedId
  );
  const [filterError, setFilterError] = useState<string | null>(null);

  const filteredRecords = useMemo(() => {
    const userQuery = filters.user.toLocaleLowerCase();
    const promptQuery = filters.prompt.toLocaleLowerCase();
    return adminUsageRecords.filter((record) => {
      const userText =
        `${record.user.name} ${record.user.email} ${record.user.id}`.toLocaleLowerCase();
      const createdDate = record.createdAt.slice(0, 10);
      return (
        (!userQuery || userText.includes(userQuery)) &&
        (filters.status === "all" || record.status === filters.status) &&
        (filters.model === "all" || record.model === filters.model) &&
        (!promptQuery ||
          record.prompt.toLocaleLowerCase().includes(promptQuery)) &&
        (!filters.start || createdDate >= filters.start) &&
        (!filters.end || createdDate <= filters.end)
      );
    });
  }, [filters]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRecords = filteredRecords.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const selected =
    adminUsageRecords.find((record) => record.id === selectedId) ?? null;
  const totalCredits = filteredRecords.reduce(
    (sum, record) => sum + record.credits.total,
    0
  );

  useEffect(() => {
    /** 从地址栏恢复已应用筛选、草稿、分页和检查器对象。 */
    const applyLocation = () => {
      const next = readUsageUrlState();
      setFilters(next.filters);
      setDraftFilters(next.filters);
      setPage(next.page);
      setSelectedId(next.selectedId);
      setFilterError(null);
    };
    applyLocation();
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, []);

  useEffect(() => {
    /** Escape 只关闭当前检查器，并保留筛选和分页上下文。 */
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !selectedId) return;
      setSelectedId(null);
      writeUsageUrlState(
        { filters, page: currentPage, selectedId: null },
        "replace"
      );
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [currentPage, filters, selectedId]);

  useEffect(() => {
    if (page === currentPage) return;
    setPage(currentPage);
    writeUsageUrlState({ filters, page: currentPage, selectedId }, "replace");
  }, [currentPage, filters, page, selectedId]);

  /**
   * 应用已校验筛选，并从第一页开始新的可返回历史记录。
   *
   * @param event 筛选表单提交事件。
   * @sideEffects 更新本地状态并通过 pushState 写入 URL。
   */
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const error = validateDateRange(draftFilters, locale);
    if (error) {
      setFilterError(error);
      return;
    }
    const nextFilters: UsageFilters = {
      ...draftFilters,
      user: draftFilters.user.trim().slice(0, 80),
      prompt: draftFilters.prompt.trim().slice(0, 160),
    };
    setFilters(nextFilters);
    setDraftFilters(nextFilters);
    setPage(1);
    setSelectedId(null);
    setFilterError(null);
    writeUsageUrlState(
      { filters: nextFilters, page: 1, selectedId: null },
      "push"
    );
  };

  /**
   * 清空全部筛选和检查器，并写入一条可返回历史记录。
   *
   * @sideEffects 更新本地状态并通过 pushState 写入 URL。
   */
  const resetFilters = () => {
    setFilters(defaultFilters);
    setDraftFilters(defaultFilters);
    setPage(1);
    setSelectedId(null);
    setFilterError(null);
    writeUsageUrlState(
      { filters: defaultFilters, page: 1, selectedId: null },
      "push"
    );
  };

  /**
   * 切换分页并保持当前筛选。
   *
   * @param nextPage 目标页码。
   * @sideEffects 关闭检查器并通过 pushState 写入安全页码。
   */
  const changePage = (nextPage: number) => {
    const safePage = Math.min(totalPages, Math.max(1, nextPage));
    setPage(safePage);
    setSelectedId(null);
    writeUsageUrlState({ filters, page: safePage, selectedId: null }, "push");
  };

  /**
   * 打开记录检查器并把当前对象写入 URL。
   *
   * @param recordId 选中的生成记录 ID。
   * @sideEffects 更新选中状态并通过 pushState 写入 URL。
   */
  const openInspector = (recordId: string) => {
    setSelectedId(recordId);
    writeUsageUrlState(
      { filters, page: currentPage, selectedId: recordId },
      "push"
    );
  };

  /**
   * 关闭记录检查器并保留筛选、分页与滚动上下文。
   *
   * @sideEffects 清空选中状态并通过 replaceState 更新 URL。
   */
  const closeInspector = () => {
    setSelectedId(null);
    writeUsageUrlState(
      { filters, page: currentPage, selectedId: null },
      "replace"
    );
  };

  return (
    <section
      className={styles.root}
      data-theme={theme}
      aria-label={copy(locale, "All usage records", "全站使用记录")}
    >
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>
            {copy(locale, "Generation operations", "生成运营")}
          </span>
          <p>
            {copy(
              locale,
              "All users' generation requests, billing context, channels, and results.",
              "查看所有用户的生成请求、积分口径、执行渠道与结果。"
            )}
          </p>
        </div>
      </header>

      <UsageFilterBar
        draft={draftFilters}
        error={filterError}
        locale={locale}
        resultCount={filteredRecords.length}
        totalCredits={totalCredits}
        onApply={applyFilters}
        onDraftChange={(patch) => {
          setDraftFilters((current) => ({ ...current, ...patch }));
          setFilterError(null);
        }}
        onReset={resetFilters}
      />

      <UsageTable
        locale={locale}
        records={pageRecords}
        onOpen={openInspector}
      />

      <UsagePagination
        currentPage={currentPage}
        locale={locale}
        pageSize={PAGE_SIZE}
        totalCount={filteredRecords.length}
        totalPages={totalPages}
        onChange={changePage}
      />

      {selected && (
        <AdminUsageInspector
          locale={locale}
          record={selected}
          onClose={closeInspector}
          onOpenUser={onOpenUser}
        />
      )}
    </section>
  );
}

/** 重新导出页面语义别名与检查器，保持既有模块 API。 */
export { AdminUsageInspector, AdminUsagePreview as AdminUsagePage };
