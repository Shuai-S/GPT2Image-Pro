import { SignUpForm } from "@/features/auth/components/sign-up-form";
import { isSelfUseModeEnabled } from "@repo/shared/auth/self-use-mode";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { redirect } from "next/navigation";

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

  const branding = await getRuntimeBrandingConfig();

  return (
    <SignUpForm googleAuthEnabled={isGoogleAuthEnabled()} branding={branding} />
  );
}
