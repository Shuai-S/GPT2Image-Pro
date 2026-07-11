// 文件职责：集中校验并同步管理工具子原型的 URL 查询状态。
// 使用方：后端池与系统设置原型；仅调用 History API，不触发页面导航或网络请求。

import {
  apiBackends,
  type BackendView,
  backendResources,
  backendTabs,
  settingCategories,
} from "./admin-tools-mock-data";

export type BackendTool = "sub2api" | "register";

export type BackendUrlState = {
  view: BackendView;
  objectId: string;
  tool: BackendTool;
};

type HistoryMode = "push" | "replace";

/**
 * 校验 URL 中的后端池本地标签。
 *
 * @param value 尚未信任的查询参数。
 * @returns 参数是否属于已实现的后端池标签。
 */
function isBackendView(value: string | null): value is BackendView {
  return value !== null && backendTabs.some((tab) => tab.id === value);
}

/**
 * 校验 URL 中的接入工具标签。
 *
 * @param value 尚未信任的查询参数。
 * @returns 参数是否属于接入工具的两个本地标签。
 */
function isBackendTool(value: string | null): value is BackendTool {
  return value === "sub2api" || value === "register";
}

/**
 * 返回后端池标签的默认检查对象，工具标签没有资源检查器。
 *
 * @param view 当前后端池标签。
 * @returns 该标签首个虚构资源标识，或空字符串。
 */
export function getDefaultBackendObjectId(view: BackendView): string {
  if (view === "api") {
    return apiBackends[0]?.id ?? "";
  }
  if (view === "tools") {
    return "";
  }
  return backendResources[view][0]?.id ?? "";
}

/**
 * 将 URL 对象标识收窄到当前标签已有的虚构资源，否则回退首项。
 *
 * @param view 当前后端池标签。
 * @param candidate URL 中的候选资源标识。
 * @returns 可安全选中的资源标识。
 */
function resolveBackendObjectId(
  view: BackendView,
  candidate: string | null
): string {
  if (view === "api") {
    return apiBackends.some((backend) => backend.id === candidate)
      ? (candidate ?? "")
      : getDefaultBackendObjectId(view);
  }
  if (view === "tools") {
    return "";
  }
  return backendResources[view].some((resource) => resource.id === candidate)
    ? (candidate ?? "")
    : getDefaultBackendObjectId(view);
}

/**
 * 从浏览器 URL 读取后端标签、检查对象和接入工具状态。
 *
 * @returns 经过白名单校验的后端池 URL 状态。
 */
export function readBackendUrlState(): BackendUrlState {
  const params = new URL(window.location.href).searchParams;
  const viewParam = params.get("backendTab");
  const view = isBackendView(viewParam) ? viewParam : "api";
  const toolParam = params.get("backendTool");
  return {
    view,
    objectId: resolveBackendObjectId(view, params.get("backendObject")),
    tool: isBackendTool(toolParam) ? toolParam : "sub2api",
  };
}

/**
 * 将后端工具状态写入当前 URL，不触发导航或真实数据读取。
 *
 * @param state 需要持久化的本地标签和对象状态。
 * @param mode 新建历史记录或替换当前记录。
 * @sideEffects 仅调用浏览器 History API。
 */
export function writeBackendUrlState(
  state: BackendUrlState,
  mode: HistoryMode
) {
  const url = new URL(window.location.href);
  url.searchParams.set("backendTab", state.view);
  if (state.objectId) {
    url.searchParams.set("backendObject", state.objectId);
  } else {
    url.searchParams.delete("backendObject");
  }
  if (state.view === "tools") {
    url.searchParams.set("backendTool", state.tool);
  } else {
    url.searchParams.delete("backendTool");
  }
  if (mode === "push") {
    window.history.pushState({}, "", url);
  } else {
    window.history.replaceState({}, "", url);
  }
}

/**
 * 校验 URL 中的系统设置分类。
 *
 * @param value 尚未信任的查询参数。
 * @returns 参数是否属于已实现的设置分类。
 */
function isSettingCategoryId(value: string | null): value is string {
  return (
    value !== null &&
    settingCategories.some((category) => category.id === value)
  );
}

/**
 * 从浏览器 URL 读取并校验系统设置分类。
 *
 * @returns 可安全显示的分类标识。
 */
export function readSettingCategoryId(): string {
  const value = new URL(window.location.href).searchParams.get(
    "settingsCategory"
  );
  return isSettingCategoryId(value) ? value : (settingCategories[0]?.id ?? "");
}

/**
 * 将设置分类写入当前 URL，使刷新、返回和分享保留编辑位置。
 *
 * @param categoryId 已通过分类白名单校验的标识。
 * @param mode 新建历史记录或替换当前记录。
 * @sideEffects 仅调用浏览器 History API。
 */
export function writeSettingCategoryId(categoryId: string, mode: HistoryMode) {
  const url = new URL(window.location.href);
  url.searchParams.set("settingsCategory", categoryId);
  if (mode === "push") {
    window.history.pushState({}, "", url);
  } else {
    window.history.replaceState({}, "", url);
  }
}
