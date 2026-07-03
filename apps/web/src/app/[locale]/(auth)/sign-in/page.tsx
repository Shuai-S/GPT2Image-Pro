import { SignInForm } from "@/features/auth/components/sign-in-form";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";

function isGoogleAuthEnabled() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
}

/**
 * 登录页面
 * 路由: /sign-in
 */
export default async function SignInPage() {
  const branding = await getRuntimeBrandingConfig();

  return (
    <SignInForm googleAuthEnabled={isGoogleAuthEnabled()} branding={branding} />
  );
}
