import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { NextIntlClientProvider } from "next-intl";
import { AuthFooter } from "@/features/auth/components/auth-footer";
import { loadMessageGroups } from "@/i18n/message-loader";

/**
 * Auth 路由组布局
 * 用于登录、注册等认证页面
 * 包含简洁的头部和底部
 */
export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [branding, messages] = await Promise.all([
    getRuntimeBrandingConfig(),
    loadMessageGroups(locale, ["common", "auth"]),
  ]);

  return (
    <NextIntlClientProvider messages={messages}>
      <div className="flex min-h-screen flex-col bg-background">
        {/* 主内容区域 */}
        <main className="flex flex-1 items-center justify-center px-4 py-12">
          {children}
        </main>

        {/* 底部版权和法律链接 */}
        <AuthFooter branding={branding} />
      </div>
    </NextIntlClientProvider>
  );
}
