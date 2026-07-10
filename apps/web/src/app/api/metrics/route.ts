/**
 * Prometheus 运维指标路由。
 *
 * 职责：用独立 Bearer 密钥保护只读队列/租约指标，密钥未配置时隐藏端点；鉴权
 * 通过后读取单次 PostgreSQL 聚合快照。不会暴露用户、任务、租约 owner 或错误正文。
 */

import { logError } from "@repo/shared/logger";
import { readOperationalMetrics } from "@/server/operational-metrics";
import {
  authorizeOperationalMetricsRequest,
  encodeOperationalMetrics,
} from "@/server/operational-metrics-core";

export const dynamic = "force-dynamic";

/**
 * 返回 Prometheus text format 指标。
 *
 * @param request 抓取请求，须携带 OBSERVABILITY_METRICS_TOKEN Bearer 密钥。
 * @returns 端点关闭时 404、鉴权失败时 401、数据库失败时 503，否则 200。
 * @sideEffects 鉴权通过后执行一次带 2 秒 statement_timeout 的只读聚合事务。
 */
export async function GET(request: Request): Promise<Response> {
  const authorization = authorizeOperationalMetricsRequest(
    request,
    process.env.OBSERVABILITY_METRICS_TOKEN
  );
  if (authorization === "disabled") {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
  if (authorization === "unauthorized") {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "WWW-Authenticate": "Bearer",
      },
    });
  }

  try {
    const body = encodeOperationalMetrics(await readOperationalMetrics());
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      },
    });
  } catch (error) {
    // 数据库驱动错误可能包含 SQL 或连接细节，只记录固定消息与错误类型。
    logError(new Error("Operational metrics query failed"), {
      source: "operational-metrics",
      causeType: error instanceof Error ? error.name : typeof error,
    });
    return new Response("Metrics unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}
