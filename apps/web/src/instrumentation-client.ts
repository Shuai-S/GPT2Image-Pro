/**
 * Next.js 客户端 instrumentation 入口。
 *
 * 职责：初始化可选 Sentry 客户端，并把 App Router 导航起点交给 Sentry。DSN 未配置
 * 时共享 monitoring 初始化器直接返回，保持可选服务优雅降级。
 */

import { initSentryClient } from "@repo/shared/monitoring";
import * as Sentry from "@sentry/nextjs";

initSentryClient();

/** App Router 客户端导航追踪钩子，由 Next.js 自动调用。 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
