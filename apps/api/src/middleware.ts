import { type NextRequest, NextResponse } from "next/server";

/**
 * API 应用中间件
 *
 * 职责：
 * 1. 对 /api/v1/* 和 /v1/* 路由实施 CORS 访问控制
 * 2. 处理 OPTIONS 预检请求
 *
 * 允许来源由 NEXT_PUBLIC_APP_URL 环境变量控制，
 * 禁止使用 Access-Control-Allow-Origin: * 以防止跨站滥用。
 */

// 允许的请求来源，从环境变量读取，默认为生产域名
const ALLOWED_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL || "https://app.gpt2image.pro";

// 允许的 HTTP 方法
const ALLOWED_METHODS = "GET, POST, OPTIONS";

// 允许的请求头
const ALLOWED_HEADERS = "Authorization, Content-Type";

/**
 * 判断请求路径是否为需要 CORS 保护的 API 路由
 */
function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/v1/") || pathname.startsWith("/v1/");
}

/**
 * 为响应附加 CORS 头部
 *
 * @param response - 待附加头部的响应对象
 * @param origin - 请求来源，仅在匹配白名单时回显
 */
function setCorsHeaders(
  response: NextResponse,
  origin: string | null,
): NextResponse {
  // 仅当请求来源与白名单匹配时才回显 Origin，拒绝通配符
  if (origin === ALLOWED_ORIGIN) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  response.headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

/**
 * 判断请求路径是否为 cron job 路由（/api/jobs/*）
 */
function isCronJobRoute(pathname: string): boolean {
  return pathname.startsWith("/api/jobs/");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get("origin");

  // 纵深防御：cron job 端点的 GET 请求也须携带 Authorization 头，
  // 防止未认证访问泄露元数据。各路由处理器内部有独立的 CRON_SECRET
  // 校验，此处仅作为额外的防护层拦截无凭据请求。
  if (
    isCronJobRoute(pathname) &&
    request.method === "GET" &&
    !request.headers.get("authorization")
  ) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  // 非 API 路由直接透传
  if (!isApiRoute(pathname)) {
    return NextResponse.next();
  }

  // OPTIONS 预检请求：返回 204 No Content 并附加 CORS 头部
  if (request.method === "OPTIONS") {
    const preflightResponse = new NextResponse(null, { status: 204 });
    return setCorsHeaders(preflightResponse, origin);
  }

  // 常规请求：透传并附加 CORS 头部
  const response = NextResponse.next();
  return setCorsHeaders(response, origin);
}

export const config = {
  matcher: ["/api/:path*", "/v1/:path*"],
};
