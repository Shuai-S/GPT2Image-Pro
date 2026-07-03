import { NextResponse } from "next/server";

import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";

/**
 * 运行时品牌图标路由。
 *
 * 使用方：浏览器标签页 favicon、apple-touch-icon 等 metadata 链接。
 * 关键依赖：管理员系统设置中的 NEXT_PUBLIC_APP_LOGO_URL。
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 根据当前品牌配置跳转到 Logo 地址。
 *
 * @param request - 当前 HTTP 请求，用于把站内相对路径解析为绝对 URL。
 * @returns 指向管理员配置 Logo 地址的临时跳转响应。
 * @sideEffects 读取 system_settings 表；不写入数据。
 * @throws DB 访问异常会由 Next.js route handler 映射为错误响应。
 */
export async function GET(request: Request) {
  const branding = await getRuntimeBrandingConfig();
  const iconUrl = new URL(branding.logoUrl, request.url);
  const response = NextResponse.redirect(iconUrl, 307);

  response.headers.set("Cache-Control", "no-store, max-age=0");

  return response;
}
