import { SignInForm } from "@/features/auth/components/sign-in-form";

function isGoogleAuthEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * 登录页面
 * 路由: /sign-in
 */
export default function SignInPage() {
  return <SignInForm googleAuthEnabled={isGoogleAuthEnabled()} />;
}
