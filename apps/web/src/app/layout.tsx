import type { Metadata } from "next";

import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { siteConfig } from "@repo/shared/config";

import "@repo/ui/globals.css";

/**
 * 生成全站默认 metadata。
 *
 * @returns 使用管理员品牌配置生成的页面标题、描述与分享信息。
 * @sideEffects 读取 system_settings 表；异常交由 Next.js metadata 流程处理。
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getRuntimeBrandingConfig();

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
    manifest: "/site.webmanifest",
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
