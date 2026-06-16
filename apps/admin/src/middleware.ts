/**
 * 管理后台中间件
 *
 * 职责：
 * 1. 非 GET 请求的 Origin 头校验（CSRF 防护）
 * 2. 国际化路由处理
 *
 * 认证保护由各页面的 server component 检查处理。
 *
 * 使用方：apps/admin（管理后台应用）。
 * 依赖：next-intl/middleware、i18n/routing。
 */

import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/**
 * 获取允许的 Origin 列表
 *
 * 包含 ADMIN_AUTH_URL（管理后台地址）和本地开发地址。
 * 支持通过 ADMIN_TRUSTED_ORIGINS 环境变量追加额外来源（逗号分隔）。
 *
 * @returns 去重后的合法 Origin 集合
 */
function getAllowedOrigins(): Set<string> {
  const origins: string[] = [];

  // 管理后台主地址
  const adminUrl =
    process.env.ADMIN_AUTH_URL || "http://localhost:3001";
  origins.push(new URL(adminUrl).origin);

  // 本地开发地址
  origins.push("http://localhost:3001");

  // 额外信任来源（部署环境可通过此变量追加反代域名等）
  const extra = process.env.ADMIN_TRUSTED_ORIGINS || "";
  for (const raw of extra.split(",")) {
    const trimmed = raw.trim();
    if (trimmed) {
      try {
        origins.push(new URL(trimmed).origin);
      } catch {
        // 忽略无法解析的 URL
      }
    }
  }

  return new Set(origins);
}

// 国际化中间件
const intlMiddleware = createMiddleware(routing);

/**
 * 中间件入口
 *
 * 对非 GET/HEAD/OPTIONS 请求执行 Origin 校验：
 * - Origin 缺失 → 403（防止 webview/旧浏览器绕过）
 * - Origin 不在白名单 → 403
 * - 校验通过后继续到 intl 中间件
 *
 * GET/HEAD/OPTIONS 是安全方法，直接放行到 intl 中间件。
 */
export default function middleware(request: NextRequest) {
  const method = request.method.toUpperCase();

  // 安全方法直接放行，无需 CSRF 校验
  if (
    method === "GET" ||
    method === "HEAD" ||
    method === "OPTIONS"
  ) {
    return intlMiddleware(request);
  }

  // 非安全方法（POST/PUT/PATCH/DELETE 等）校验 Origin 头
  const origin = request.headers.get("origin");

  if (!origin) {
    // Origin 缺失：可能是旧浏览器、webview 或跨站攻击，一律拒绝
    return new NextResponse("Forbidden: missing Origin header", {
      status: 403,
    });
  }

  const allowed = getAllowedOrigins();
  if (!allowed.has(origin)) {
    // Origin 不在白名单：疑似跨站请求伪造
    return new NextResponse("Forbidden: origin not allowed", {
      status: 403,
    });
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
