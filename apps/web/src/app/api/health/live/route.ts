/**
 * 进程 liveness 路由。
 *
 * 职责：只证明 Next.js 进程能响应，不访问数据库或第三方服务，供容器运行时判断
 * 是否需要重启进程。readiness 由相邻 /api/health/ready 独立承担。
 */

import { buildLivenessResponse } from "@/server/health-response";

export const dynamic = "force-dynamic";

/** 返回无依赖的 HTTP 200 存活响应。 */
export function GET(): Response {
  return buildLivenessResponse();
}
