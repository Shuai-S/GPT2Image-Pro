import type { MetadataRoute } from "next";

import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";

/**
 * Web App Manifest 动态配置。
 *
 * 使用方：浏览器、PWA 安装入口和支持 manifest 的系统 UI。
 * 关键依赖：管理员系统设置中的品牌名称与 Logo 地址。
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 生成运行时 manifest。
 *
 * @returns 使用管理员品牌配置的 Web App Manifest。
 * @sideEffects 读取 system_settings 表；底层带短 TTL 缓存。
 * @throws DB 访问异常会由 Next.js metadata route 处理为错误响应。
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getRuntimeBrandingConfig();

  return {
    name: branding.name,
    short_name: branding.name,
    description: branding.description,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1a1a1a",
    icons: [
      {
        src: branding.logoUrl,
        sizes: "192x192",
        purpose: "any",
      },
      {
        src: branding.logoUrl,
        sizes: "512x512",
        purpose: "any",
      },
    ],
  };
}
