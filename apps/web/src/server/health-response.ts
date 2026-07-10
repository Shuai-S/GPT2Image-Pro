/**
 * 健康检查响应构造器。
 *
 * 职责：把 liveness/readiness 探测结果编码为稳定、禁缓存的 JSON Response。
 * 使用方：/api/health/live 与 /api/health/ready 路由；保持 DB-free 便于单测。
 * 关键依赖：Web Response API，无数据库或可选观测服务依赖。
 */

const HEALTH_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
} as const;

/**
 * 构造进程存活响应。
 *
 * @returns HTTP 200 与 status=ok；无副作用且不会失败。
 */
export function buildLivenessResponse(): Response {
  return Response.json(
    { status: "ok", checks: { process: "up" } },
    { status: 200, headers: HEALTH_HEADERS }
  );
}

/**
 * 构造数据库 readiness 响应。
 *
 * @param databaseReady 数据库短探测是否成功。
 * @returns ready 时 HTTP 200，否则 HTTP 503；不包含连接串或内部错误细节。
 */
export function buildReadinessResponse(databaseReady: boolean): Response {
  return Response.json(
    {
      status: databaseReady ? "ok" : "unavailable",
      checks: { database: databaseReady ? "up" : "down" },
    },
    {
      status: databaseReady ? 200 : 503,
      headers: HEALTH_HEADERS,
    }
  );
}
