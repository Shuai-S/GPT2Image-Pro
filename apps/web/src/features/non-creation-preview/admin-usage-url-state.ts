// 管理使用记录原型的 URL 白名单状态，供页面编排与筛选控件共享。

import { copy } from "./admin-usage-format";
import {
  type AdminUsageStatus,
  adminUsageModels,
  adminUsageRecords,
} from "./admin-usage-mock-data";

const STATUS_FILTERS = ["all", "completed", "pending", "failed"] as const;

/** 使用记录页面可持久化到 URL 的筛选条件。 */
export type UsageFilters = {
  user: string;
  status: AdminUsageStatus | "all";
  model: (typeof adminUsageModels)[number] | "all";
  prompt: string;
  start: string;
  end: string;
};

/** 使用记录页面完整的 URL 视图状态。 */
export type UsageUrlState = {
  filters: UsageFilters;
  page: number;
  selectedId: string | null;
};

/** 无筛选条件时使用的稳定初始值。 */
export const defaultFilters: UsageFilters = {
  user: "",
  status: "all",
  model: "all",
  prompt: "",
  start: "",
  end: "",
};

/**
 * 校验状态查询参数。
 *
 * @param value 未信任的 URL 字符串。
 * @returns 白名单状态或 all。
 */
export function parseStatus(value: string | null): UsageFilters["status"] {
  return value !== null && STATUS_FILTERS.some((item) => item === value)
    ? (value as UsageFilters["status"])
    : "all";
}

/**
 * 校验模型查询参数。
 *
 * @param value 未信任的 URL 字符串。
 * @returns 白名单模型或 all。
 */
export function parseModel(value: string | null): UsageFilters["model"] {
  return value !== null && adminUsageModels.some((item) => item === value)
    ? (value as UsageFilters["model"])
    : "all";
}

/**
 * 清理日期查询参数，只保留 ISO 日期格式。
 *
 * @param value 未信任的 URL 字符串。
 * @returns 合法 `YYYY-MM-DD` 或空字符串。
 */
function parseDateFilter(value: string | null) {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : "";
}

/**
 * 从当前 URL 读取并白名单化筛选、页码和检查器对象。
 *
 * @returns 可安全写入本地 state 的使用记录视图状态。
 */
export function readUsageUrlState(): UsageUrlState {
  if (typeof window === "undefined") {
    return { filters: defaultFilters, page: 1, selectedId: null };
  }
  const params = new URL(window.location.href).searchParams;
  const rawPage = Number.parseInt(params.get("usagePage") ?? "1", 10);
  const selectedParam = params.get("usageRecord");
  return {
    filters: {
      user: (params.get("usageUser") ?? "").trim().slice(0, 80),
      status: parseStatus(params.get("usageStatus")),
      model: parseModel(params.get("usageModel")),
      prompt: (params.get("usagePrompt") ?? "").trim().slice(0, 160),
      start: parseDateFilter(params.get("usageStart")),
      end: parseDateFilter(params.get("usageEnd")),
    },
    page:
      Number.isFinite(rawPage) && rawPage >= 1 && rawPage <= 999 ? rawPage : 1,
    selectedId:
      selectedParam &&
      adminUsageRecords.some((record) => record.id === selectedParam)
        ? selectedParam
        : null,
  };
}

/**
 * 将筛选、页码和选中记录编码进白名单 URL。
 *
 * @param state 当前完整视图状态。
 * @param mode 新增或替换浏览历史。
 * @sideEffects 调用 History API，不发起导航和网络请求。
 */
export function writeUsageUrlState(
  state: UsageUrlState,
  mode: "push" | "replace"
) {
  const url = new URL(window.location.href);
  const entries: Array<[string, string, string]> = [
    ["usageUser", state.filters.user, ""],
    ["usageStatus", state.filters.status, "all"],
    ["usageModel", state.filters.model, "all"],
    ["usagePrompt", state.filters.prompt, ""],
    ["usageStart", state.filters.start, ""],
    ["usageEnd", state.filters.end, ""],
    ["usagePage", String(state.page), "1"],
    ["usageRecord", state.selectedId ?? "", ""],
  ];
  for (const [key, value, defaultValue] of entries) {
    if (value === defaultValue) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  if (mode === "push") window.history.pushState({}, "", url);
  else window.history.replaceState({}, "", url);
}

/**
 * 校验开始与结束日期的先后关系。
 *
 * @param filters 待应用的筛选值。
 * @param locale 当前语言。
 * @returns null 表示可用，否则返回错误文本。
 */
export function validateDateRange(filters: UsageFilters, locale: string) {
  if (!filters.start || !filters.end) return null;
  return filters.start <= filters.end
    ? null
    : copy(
        locale,
        "The start date cannot be after the end date.",
        "开始日期不能晚于结束日期。"
      );
}
