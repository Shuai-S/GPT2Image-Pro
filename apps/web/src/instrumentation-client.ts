/**
 * Next.js 客户端 instrumentation 入口。
 *
 * 职责：初始化可选 Sentry 客户端，把 App Router 导航起点交给 Sentry，并用
 * web-vitals 上报真实用户 LCP/INP/CLS 与页面组预算。DSN 未配置时不安装 observer。
 */

import {
  initSentryClient,
  isSentryEnabled,
} from "@repo/shared/monitoring";
import * as Sentry from "@sentry/nextjs";
import { type MetricType, onCLS, onINP, onLCP } from "web-vitals";
import {
  evaluateWebVitalBudget,
  type WebVitalName,
} from "./web-vitals-budget";

initSentryClient();

/** 判断 web-vitals 指标是否属于本轮强制预算。 */
function isBudgetedMetric(name: MetricType["name"]): name is WebVitalName {
  return name === "LCP" || name === "INP" || name === "CLS";
}

/**
 * 把一次真实用户指标写入 Sentry distribution，超限时额外发出低频 warning。
 *
 * @param metric web-vitals 计算出的单页最终指标。
 * @sideEffects 向已配置 Sentry 发送低基数指标；非法数值或未配置时不发送。
 */
function reportWebVital(metric: MetricType): void {
  if (!isSentryEnabled() || !isBudgetedMetric(metric.name)) return;
  const result = evaluateWebVitalBudget(
    window.location.pathname,
    metric.name,
    metric.value
  );
  if (!result.valid) return;

  Sentry.metrics.distribution(
    `web_vital.${metric.name.toLowerCase()}`,
    metric.value,
    {
      unit: metric.name === "CLS" ? "ratio" : "millisecond",
      attributes: {
        route_group: result.routeGroup,
        rating: metric.rating,
        navigation_type: metric.navigationType,
        budget: result.budget,
        budget_exceeded: result.exceeded,
      },
    }
  );
  if (result.exceeded) {
    Sentry.captureMessage(`Web vital budget exceeded: ${metric.name}`, {
      level: "warning",
      tags: {
        "web_vital.name": metric.name,
        "web_vital.route_group": result.routeGroup,
      },
      extra: {
        value: metric.value,
        budget: result.budget,
        rating: metric.rating,
        navigationType: metric.navigationType,
      },
    });
  }
}

/** 安装一次官方 Web Vitals observer；浏览器会在指标稳定时调用 reportWebVital。 */
function registerWebVitals(): void {
  if (!isSentryEnabled() || typeof window === "undefined") return;
  onLCP(reportWebVital);
  onINP(reportWebVital);
  onCLS(reportWebVital);
}

registerWebVitals();

/** App Router 客户端导航追踪钩子，由 Next.js 自动调用。 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
