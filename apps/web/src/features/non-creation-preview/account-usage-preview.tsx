"use client";

// 账户中心订单与用量入口。管理三标签及普通用户使用记录的可刷新 URL 状态。

import { useEffect, useMemo, useRef, useState } from "react";
import { generationUsage } from "./account-mock-data";
import { PageHeading, SegmentedTabs } from "./account-preview-shared";
import { UsageRecordInspector } from "./account-usage-detail";
import { CreditLedgerTable, PaymentOrdersTable } from "./account-usage-finance";
import {
  parseUsageModelFilter,
  parseUsageSourceFilter,
  parseUsageStatusFilter,
  type UsageModelFilter,
  UsageRecords,
  type UsageSourceFilter,
  type UsageStatusFilter,
} from "./account-usage-records";

type UsageTab = "credits" | "payments" | "generations";
type UrlWriteMode = "push" | "replace";

type UsageUrlState = {
  tab: UsageTab;
  query: string;
  status: UsageStatusFilter;
  model: UsageModelFilter;
  source: UsageSourceFilter;
  page: number;
  recordId: string | null;
};

const PAGE_SIZE = 6;
const DEFAULT_USAGE_STATE: UsageUrlState = {
  tab: "credits",
  query: "",
  status: "all",
  model: "all",
  source: "all",
  page: 1,
  recordId: null,
};

/**
 * 校验 URL 中的订单与用量标签。
 *
 * @param value 未信任的查询值。
 * @returns 合法标签；未知值回退积分流水。
 * @sideEffects 无。
 */
function parseUsageTab(value: string | null): UsageTab {
  return value === "payments" || value === "generations" ? value : "credits";
}

/**
 * 从当前地址读取并归一化使用记录状态。
 *
 * @returns 经过白名单、长度和页码边界校验的状态。
 * @sideEffects 读取 window.location，不修改浏览器历史。
 */
function readUsageUrlState(): UsageUrlState {
  const params = new URL(window.location.href).searchParams;
  const rawPage = Number.parseInt(params.get("usagePage") ?? "1", 10);
  const requestedRecordId = params.get("usageRecord");
  const recordId = generationUsage.some(
    (record) => record.id === requestedRecordId
  )
    ? requestedRecordId
    : null;

  return {
    tab: parseUsageTab(params.get("usageTab")),
    query: (params.get("usageQuery") ?? "").trim().slice(0, 120),
    status: parseUsageStatusFilter(params.get("usageStatus")),
    model: parseUsageModelFilter(params.get("usageModel")),
    source: parseUsageSourceFilter(params.get("usageSource")),
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
    recordId,
  };
}

/**
 * 把使用记录状态编码到当前账户 URL。
 *
 * @param state 已通过组件约束的状态。
 * @param mode 新导航使用 push，输入筛选和修正使用 replace。
 * @sideEffects 写入 history；不触发网络请求或页面重载。
 */
function writeUsageUrlState(state: UsageUrlState, mode: UrlWriteMode) {
  const url = new URL(window.location.href);
  const params = url.searchParams;

  if (state.tab === "credits") params.delete("usageTab");
  else params.set("usageTab", state.tab);

  if (state.query) params.set("usageQuery", state.query);
  else params.delete("usageQuery");

  if (state.status === "all") params.delete("usageStatus");
  else params.set("usageStatus", state.status);

  if (state.model === "all") params.delete("usageModel");
  else params.set("usageModel", state.model);

  if (state.source === "all") params.delete("usageSource");
  else params.set("usageSource", state.source);

  if (state.page > 1) params.set("usagePage", String(state.page));
  else params.delete("usagePage");

  if (state.recordId) params.set("usageRecord", state.recordId);
  else params.delete("usageRecord");

  if (mode === "push") window.history.pushState({}, "", url);
  else window.history.replaceState({}, "", url);
}

/**
 * 渲染订单与用量三个标签，并维护使用记录筛选、分页和详情 URL。
 *
 * @returns 积分流水、支付订单和普通用户使用记录子模块。
 * @sideEffects 仅同步浏览器历史与本地原型状态，不调用真实接口。
 */
export function UsagePage() {
  const [urlState, setUrlState] = useState<UsageUrlState>(DEFAULT_USAGE_STATE);
  const detailOpenedByPushRef = useRef(false);

  useEffect(() => {
    /** 从地址恢复状态，供刷新与浏览器返回、前进复用。 */
    const applyLocation = () => {
      detailOpenedByPushRef.current = false;
      setUrlState(readUsageUrlState());
    };

    applyLocation();
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, []);

  const filteredRecords = useMemo(() => {
    const query = urlState.query.toLocaleLowerCase("zh-CN");
    return generationUsage.filter((record) => {
      if (urlState.status !== "all" && record.status !== urlState.status) {
        return false;
      }
      if (urlState.source !== "all" && record.source !== urlState.source) {
        return false;
      }
      if (urlState.model !== "all" && record.model !== urlState.model) {
        return false;
      }
      if (!query) return true;
      return [
        record.id,
        record.requestId,
        record.prompt,
        record.model,
        record.size,
      ]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(query);
    });
  }, [urlState.model, urlState.query, urlState.source, urlState.status]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const page = Math.min(urlState.page, pageCount);
  const pageRecords = filteredRecords.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );
  const selectedRecord =
    generationUsage.find((record) => record.id === urlState.recordId) ?? null;

  useEffect(() => {
    if (urlState.page <= pageCount) return;
    const nextState = { ...urlState, page: pageCount };
    setUrlState(nextState);
    writeUsageUrlState(nextState, "replace");
  }, [pageCount, urlState]);

  /**
   * 提交一组已校验状态并同步 URL。
   *
   * @param nextState 下一组完整状态。
   * @param mode 浏览历史写入方式。
   * @sideEffects 更新 React 状态与 history。
   */
  const commitState = (nextState: UsageUrlState, mode: UrlWriteMode) => {
    setUrlState(nextState);
    writeUsageUrlState(nextState, mode);
  };

  /** 切换一级标签并保留可分享的标签 URL。 */
  const changeTab = (tab: UsageTab) => {
    commitState({ ...urlState, tab, page: 1, recordId: null }, "push");
  };

  /** 更新搜索文本，输入期间替换当前历史项并回到第一页。 */
  const changeQuery = (query: string) => {
    commitState(
      { ...urlState, query: query.slice(0, 120), page: 1, recordId: null },
      "replace"
    );
  };

  /** 更新状态筛选并回到第一页。 */
  const changeStatus = (status: UsageStatusFilter) => {
    commitState({ ...urlState, status, page: 1, recordId: null }, "push");
  };

  /** 更新模型筛选并回到第一页。 */
  const changeModel = (model: UsageModelFilter) => {
    commitState({ ...urlState, model, page: 1, recordId: null }, "push");
  };

  /** 更新来源筛选并回到第一页。 */
  const changeSource = (source: UsageSourceFilter) => {
    commitState({ ...urlState, source, page: 1, recordId: null }, "push");
  };

  /** 清空使用记录筛选，但保留当前一级标签。 */
  const resetFilters = () => {
    commitState(
      {
        ...urlState,
        query: "",
        status: "all",
        model: "all",
        source: "all",
        page: 1,
        recordId: null,
      },
      "push"
    );
  };

  /** 打开当前用户记录详情并创建可返回的浏览历史项。 */
  const openRecord = (recordId: string) => {
    if (!generationUsage.some((record) => record.id === recordId)) return;
    detailOpenedByPushRef.current = true;
    commitState({ ...urlState, recordId }, "push");
  };

  /**
   * 关闭详情；页面内打开时返回上一历史项，直接 URL 访问时清理参数。
   */
  const closeRecord = () => {
    if (detailOpenedByPushRef.current) {
      detailOpenedByPushRef.current = false;
      window.history.back();
      return;
    }
    commitState({ ...urlState, recordId: null }, "replace");
  };

  return (
    <section>
      <PageHeading
        eyebrow="资金与权益"
        title="订单与用量"
        description="分别核对积分余额变化、法币支付和你自己的生成记录。"
      />
      <SegmentedTabs
        value={urlState.tab}
        items={[
          { id: "credits", label: "积分流水" },
          { id: "payments", label: "支付订单" },
          { id: "generations", label: "使用记录" },
        ]}
        onChange={changeTab}
      />

      {urlState.tab === "credits" && <CreditLedgerTable />}
      {urlState.tab === "payments" && <PaymentOrdersTable />}
      {urlState.tab === "generations" && (
        <UsageRecords
          page={page}
          pageCount={pageCount}
          pageRecords={pageRecords}
          model={urlState.model}
          query={urlState.query}
          source={urlState.source}
          status={urlState.status}
          total={filteredRecords.length}
          onModelChange={changeModel}
          onOpen={openRecord}
          onPageChange={(nextPage) =>
            commitState({ ...urlState, page: nextPage, recordId: null }, "push")
          }
          onQueryChange={changeQuery}
          onReset={resetFilters}
          onSourceChange={changeSource}
          onStatusChange={changeStatus}
        />
      )}

      {selectedRecord && urlState.tab === "generations" && (
        <UsageRecordInspector record={selectedRecord} onClose={closeRecord} />
      )}
    </section>
  );
}
