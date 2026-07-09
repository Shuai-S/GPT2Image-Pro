import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { getRuntimeOperationFeatureFlags } from "@repo/shared/system-settings";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { Header } from "@/features/marketing/components";
import { loadMessageGroups } from "@/i18n/message-loader";
import { docsSource } from "@/lib/source";

/**
 * 文档布局
 *
 * 使用 Fumadocs UI 的 DocsLayout 组件
 * 提供侧边栏导航和文档结构
 * 同时保留网站顶部导航栏
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // 获取页面树（不需要 locale，因为 i18n 由 Next.js 路由处理）
  const tree = docsSource.pageTree;
  const [branding, operationFlags, messages] = await Promise.all([
    getRuntimeBrandingConfig(),
    getRuntimeOperationFeatureFlags(),
    loadMessageGroups(locale, ["common", "marketing", "docs"]),
  ]);

  return (
    // RootProvider 仅在文档区挂载(全局 Providers 已不再挂载它),提供 fumadocs 的
    // 搜索/page-tree 等上下文;fumadocs 样式在根布局先于应用样式加载,避免路由切换后
    // 第二套 Tailwind utilities 覆盖本站响应式类。
    <NextIntlClientProvider messages={messages}>
      <RootProvider>
        {/* 网站顶部导航栏 - 放在 DocsLayout 外部确保显示 */}
        <Header branding={branding} operationFlags={operationFlags} />

        {/* Fumadocs 文档布局 */}
        <DocsLayout
          tree={tree}
          nav={{
            enabled: false, // 禁用 Fumadocs 自带的顶部导航
          }}
          sidebar={{
            defaultOpenLevel: 1,
          }}
        >
          {children}
        </DocsLayout>
      </RootProvider>
    </NextIntlClientProvider>
  );
}
