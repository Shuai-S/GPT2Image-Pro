// 营销布局:组合全站 Header/Footer 与营销内容区，并提供可缓存的运行时配置快照。
// 不要在本布局或营销子页再次引入 fumadocs-ui/style.css。它会生成第二套
// Tailwind utilities;作为后加载样式表时会压过 md:flex/md:grid 等响应式类。
// Fumadocs 样式已在根布局先于应用样式加载一次。
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { getRuntimeOperationFeatureFlags } from "@repo/shared/system-settings";
import { NextIntlClientProvider } from "next-intl";
import { CurrentSessionProvider } from "@/features/auth/hooks/use-current-session";
import { Footer } from "@/features/marketing/components/footer";
import { Header } from "@/features/marketing/components/header";
import { loadMessageGroups } from "@/i18n/message-loader";

export const revalidate = 60;

export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const [branding, operationFlags, messages] = await Promise.all([
    getRuntimeBrandingConfig(),
    getRuntimeOperationFeatureFlags(),
    loadMessageGroups(locale, ["common", "marketing"]),
  ]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {/* 登录态由共享客户端 Provider 读取，避免 Cookie 让整组公开页面失去 ISR。 */}
      <CurrentSessionProvider>
        <div className="flex min-h-screen flex-col">
          <Header branding={branding} operationFlags={operationFlags} />
          <main className="flex-1">{children}</main>
          <Footer branding={branding} locale={locale} />
        </div>
      </CurrentSessionProvider>
    </NextIntlClientProvider>
  );
}
