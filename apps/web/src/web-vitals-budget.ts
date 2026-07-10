/**
 * 客户端 Web Vitals 路由分组与性能预算。
 *
 * 职责：把包含 locale 的真实 pathname 收敛为低基数、无用户标识的页面组，并统一
 * LCP、INP、CLS 阈值。instrumentation-client 和 DB-free 单元测试共同使用本模块。
 */

export type WebVitalName = "LCP" | "INP" | "CLS";
export type WebVitalRouteGroup =
  | "public"
  | "docs"
  | "dashboard"
  | "create"
  | "canvas"
  | "admin";

type WebVitalBudgets = Record<WebVitalName, number>;

export const WEB_VITAL_BUDGETS = {
  public: { LCP: 3_000, INP: 200, CLS: 0.1 },
  docs: { LCP: 3_000, INP: 200, CLS: 0.1 },
  dashboard: { LCP: 3_500, INP: 250, CLS: 0.1 },
  create: { LCP: 3_500, INP: 250, CLS: 0.1 },
  canvas: { LCP: 3_500, INP: 250, CLS: 0.1 },
  admin: { LCP: 3_500, INP: 250, CLS: 0.1 },
} as const satisfies Record<WebVitalRouteGroup, WebVitalBudgets>;

/**
 * 把 pathname 映射为固定页面组，避免把 slug、用户 ID 或 query 写入观测标签。
 *
 * @param pathname 浏览器 location.pathname；可包含任意 locale 前缀。
 * @returns 公开页、Docs、通用 Dashboard、创作页、画布或管理页分组。
 * @sideEffects 无。
 */
export function classifyWebVitalRoute(pathname: string): WebVitalRouteGroup {
  const segments = pathname
    .toLowerCase()
    .split("/")
    .filter(Boolean);
  const dashboardIndex = segments.indexOf("dashboard");
  if (dashboardIndex >= 0) {
    const section = segments[dashboardIndex + 1];
    if (section === "create") return "create";
    if (section === "canvas") return "canvas";
    if (section === "admin") return "admin";
    return "dashboard";
  }
  return segments.includes("docs") ? "docs" : "public";
}

/**
 * 判断一次真实用户指标是否有效并超过当前页面组预算。
 *
 * @param pathname 浏览器页面路径，不读取 query 或 hash。
 * @param name LCP、INP 或 CLS。
 * @param value web-vitals 提供的数值；耗时单位毫秒，CLS 为无量纲分数。
 * @returns 低基数页面组、阈值、有效性与超限结果；非法数值按超限处理但不应上报。
 * @sideEffects 无。
 */
export function evaluateWebVitalBudget(
  pathname: string,
  name: WebVitalName,
  value: number
): {
  routeGroup: WebVitalRouteGroup;
  budget: number;
  valid: boolean;
  exceeded: boolean;
} {
  const routeGroup = classifyWebVitalRoute(pathname);
  const budget = WEB_VITAL_BUDGETS[routeGroup][name];
  const valid = Number.isFinite(value) && value >= 0;
  return {
    routeGroup,
    budget,
    valid,
    exceeded: !valid || value > budget,
  };
}
