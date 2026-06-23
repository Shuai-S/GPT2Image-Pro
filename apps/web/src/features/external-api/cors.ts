/**
 * 外部 API 跨域(CORS)落地:读取管理员开关,并把策略应用到路由响应与预检。
 *
 * 为什么放路由层而非 middleware:middleware 跑在 Edge 运行时,读不到 DB 里的管理员
 * 系统设置;外部 API 的路由处理器跑在 Node 运行时,可经 getRuntimeSettingBoolean
 * (带 10s 缓存)读取开关,使"是否允许跨域"真正可由管理员在后台控制。
 *
 * 用法(每个 /v1、/api/v1 路由):
 *   export const GET = corsRoute(handler);   // 或 POST
 *   export const OPTIONS = corsPreflight;
 *
 * 开启时:OPTIONS 预检返回 204 + 预检 CORS 头;其它方法在响应上追加 CORS 头
 * (* 开放、无凭据)。关闭时:预检返回 204 但不带 CORS 头、其它方法原样透传——
 * 浏览器跨域被拦截,服务端到服务端调用不受影响。
 */

import { getRuntimeSettingBoolean } from "@repo/shared/system-settings";
import type { NextRequest } from "next/server";

import { buildOpenCorsHeaders } from "./cors-headers";

// 管理员开关:是否对外部 API(/v1、/api/v1)开放跨域。默认开启(配合"跨域开放"目标);
// 后台可关。键已在 system-settings/definitions.ts 注册,故 SettingKey 类型已包含它。
const CORS_ENABLED_SETTING_KEY = "EXTERNAL_API_CORS_ENABLED";

async function isExternalApiCorsEnabled(): Promise<boolean> {
  return getRuntimeSettingBoolean(CORS_ENABLED_SETTING_KEY, true);
}

/**
 * Next App Router 路由处理器签名。第二参数 context 形态随动态段而异;这里用 never
 * 承接,使任意 params 形态的处理器都能作为泛型实参传入(never 可赋给任意类型),
 * 运行时由 Next 原样传入、本包装器原样透传。corsRoute 返回原处理器的精确类型 H,
 * 因此 Next 对各路由导出的类型校验不受影响。
 */
type RouteHandler = (
  request: NextRequest,
  context: never
) => Response | Promise<Response>;

function applyCorsHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(buildOpenCorsHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * 用 CORS 包裹单个路由处理器,保持其精确类型(满足 Next 路由类型校验)。
 * 开关关闭时透传原响应,不加任何 CORS 头。
 */
export function corsRoute<H extends RouteHandler>(handler: H): H {
  const wrapped = async (request: NextRequest, context: never) => {
    const response = await handler(request, context);
    if (!(await isExternalApiCorsEnabled())) return response;
    return applyCorsHeaders(response);
  };
  return wrapped as H;
}

/**
 * 共享的 OPTIONS 预检处理器:开启时 204 + 预检 CORS 头(回显请求头);关闭时 204 无 CORS 头。
 * 忽略路由的动态段 context(预检不需要),故可被所有外部 API 路由复用。
 */
export async function corsPreflight(request: Request): Promise<Response> {
  if (!(await isExternalApiCorsEnabled())) {
    return new Response(null, { status: 204 });
  }
  const headers = buildOpenCorsHeaders({
    preflight: true,
    requestedHeaders: request.headers.get("access-control-request-headers"),
  });
  return new Response(null, { status: 204, headers });
}
