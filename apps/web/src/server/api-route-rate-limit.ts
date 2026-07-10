/**
 * 绕过 Next Proxy 的大正文 API 路由限流适配器。
 *
 * 职责：在路由读取 multipart 正文前复用统一 IP 提取与限流策略。使用方是因避免
 * Proxy 克隆大正文而从 matcher 排除的 chat/edit 路由；限流失败直接返回标准响应，
 * 成功时返回 null 继续业务处理。
 */

import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  type RateLimitType,
} from "@repo/shared/rate-limit";
import type { NextRequest } from "next/server";

/**
 * 对单个 API 请求执行路由内限流。
 *
 * @param request 尚未消费正文的 Next 请求。
 * @param type 复用 shared 配置的限流桶类型。
 * @returns 超限时标准 429 响应；放行时返回 null。
 * @sideEffects 读取可信代理 IP，并访问 Redis 或进程内降级限流器。
 */
export async function enforceApiRouteRateLimit(
  request: NextRequest,
  type: RateLimitType
): Promise<Response | null> {
  const result = await checkRateLimit(getClientIp(request), type);
  return result.success ? null : createRateLimitResponse(result);
}
