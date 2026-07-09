import { Providers } from "@repo/shared/components/providers";
import { getRuntimeSiteUrl } from "@repo/shared/config/site-runtime";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Toaster } from "sonner";
import { Analytics } from "@/features/analytics";
// 深路径直引(不经 marketing barrel):barrel 同时 re-export Header/PricingSection,
// 它们 import framer-motion(~62KB gzip)。经 barrel 引入会把 framer 引擎拖进每个
// 非营销路由(dashboard/auth 共 21 个)的首屏。直引 cookie-consent 即可避免。
import { CookieConsent } from "@/features/marketing/components/cookie-consent";
import { loadMessageGroup } from "@/i18n/message-loader";
import { routing } from "@/i18n/routing";

// 公开路由会读取品牌、运营开关和注册配置；统一短周期 ISR，避免镜像构建值永久冻结。
// Dashboard 子树显式 force-dynamic，不会被本设置静态化。
export const revalidate = 60;

/**
 * 生成静态参数
 * 为每个支持的语言生成静态页面
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * 生成 hreflang metadata
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const baseUrl = await getRuntimeSiteUrl();

  return {
    alternates: {
      canonical: `${baseUrl}/${locale}`,
      languages: {
        en: `${baseUrl}/en`,
        zh: `${baseUrl}/zh`,
        "x-default": `${baseUrl}/en`,
      },
    },
  };
}

/**
 * Locale 布局
 *
 * 功能:
 * - 验证语言参数有效性
 * - 提供国际化上下文 (NextIntlClientProvider)
 * - 包装 Providers (主题等)
 * - 全局组件 (CookieConsent, Toaster)
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // 获取语言参数
  const { locale } = await params;

  // 验证语言是否有效
  if (!routing.locales.includes(locale as "en" | "zh")) {
    notFound();
  }

  // next-intl 默认从请求头读取 locale，会把整棵公开路由树标记为动态渲染。
  // 路径参数已是语言真相，写入请求缓存后即可让营销、法律与博客页面静态化。
  setRequestLocale(locale);

  // 只在根布局向客户端注入跨路由都要用到的公共消息：语言切换、Cookie 设置、
  // 站点头部基础文案等。营销/Auth/Dashboard/Docs 分组分别在各自 layout 增量注入，
  // 避免每次页面切换都把整份 messages 目录序列化到 RSC payload。
  const messages = await loadMessageGroup(locale, "common");

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <Providers>
        {children}
        <CookieConsent />
        <Toaster richColors position="top-right" />
        <Analytics />
      </Providers>
    </NextIntlClientProvider>
  );
}
