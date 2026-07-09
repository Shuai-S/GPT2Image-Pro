// 全站根布局:负责加载全局样式、品牌 metadata 与 html/body 外壳。
// Fumadocs 会生成第二套 Tailwind utilities。必须先于应用样式加载,否则从
// 文档页客户端跳转到控制台/定价页后,后加载的 .hidden 会压过 md:flex 等响应式类。
//
// 缓存边界:本布局不再全局声明 force-dynamic/revalidate=0,让动态性下沉到
// 真正需要的子路由(营销首页、定价页、dashboard/admin 等)各自声明。
// generateMetadata 读取 getRuntimeBrandingConfig(底层走 system-settings 缓存,
// 见 C-P0-3),legal/blog/pseo 等无 per-request 依赖的页面可走 ISR/静态,
// admin 子路由因 getServerSession(读 Cookie)会自动判定为 dynamic,不会被误静态化。
// 越权防护:dashboard/(dashboard)/admin 子树由其 layout 的 getServerSession 兜底,
// 普通用户/未登录访问必跳转,不会因根布局去掉 force-dynamic 而静态化泄露。
import "fumadocs-ui/style.css";

import { siteConfig } from "@repo/shared/config";

import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import type { Metadata } from "next";

import "@repo/ui/globals.css";

/**
 * 为 favicon 链接生成随 Logo 地址变化的版本号。
 *
 * @param value - 管理员配置的 Logo 地址。
 * @returns 短 hash，用于让浏览器在 Logo 变更后重新请求标签页图标。
 * @sideEffects 无。
 */
function hashIconVersion(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 生成全站默认 metadata。
 *
 * @returns 使用管理员品牌配置生成的页面标题、描述与分享信息。
 * @sideEffects 读取 system_settings 表；异常交由 Next.js metadata 流程处理。
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getRuntimeBrandingConfig();
  const iconHref = `/favicon.ico?v=${hashIconVersion(branding.logoUrl)}`;

  return {
    title: {
      default: branding.name,
      template: `%s | ${branding.name}`,
    },
    description: branding.description,
    keywords: [...siteConfig.keywords],
    authors: [{ name: siteConfig.author.name, url: siteConfig.author.url }],
    creator: siteConfig.author.name,
    metadataBase: new URL(siteConfig.url),
    openGraph: {
      type: "website",
      locale: "en_US",
      url: siteConfig.url,
      title: branding.name,
      description: branding.description,
      siteName: branding.name,
      images: [
        {
          url: branding.ogImageUrl,
          width: 1200,
          height: 630,
          alt: branding.name,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: branding.name,
      description: branding.description,
      images: [branding.ogImageUrl],
      creator: "@gpt2image",
    },
    icons: {
      icon: [
        {
          url: iconHref,
          sizes: "any",
        },
      ],
      shortcut: [iconHref],
      apple: [
        {
          url: iconHref,
        },
      ],
    },
    manifest: "/manifest.webmanifest",
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
