/**
 * 注册页服务端入口。
 *
 * 职责：读取自用模式、品牌配置与公开注册邮箱后缀，并把运行时快照传给客户端表单。
 * 使用方：Next.js App Router 的 /sign-up 路由。
 * 关键依赖：@repo/shared 的自用模式、品牌配置和系统设置读取器。
 */
import { isSelfUseModeEnabled } from "@repo/shared/auth/self-use-mode";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { getRuntimeRegistrationEmailDomains } from "@repo/shared/system-settings";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthFormFallback } from "@/features/auth/components/auth-form-fallback";
import { SignUpForm } from "@/features/auth/components/sign-up-form";

function isGoogleAuthEnabled() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
}

/**
 * 注册页面
 * 路由: /sign-up
 */
export default async function SignUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (await isSelfUseModeEnabled()) {
    const { locale } = await params;
    redirect(`/${locale}/sign-in`);
  }

  const [branding, registrationEmailDomains] = await Promise.all([
    getRuntimeBrandingConfig(),
    getRuntimeRegistrationEmailDomains(),
  ]);

  return (
    <Suspense fallback={<AuthFormFallback />}>
      <SignUpForm
        googleAuthEnabled={isGoogleAuthEnabled()}
        branding={branding}
        registrationEmailDomains={registrationEmailDomains}
      />
    </Suspense>
  );
}
