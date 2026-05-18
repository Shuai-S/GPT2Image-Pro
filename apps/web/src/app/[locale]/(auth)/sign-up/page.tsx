import { SignUpForm } from "@/features/auth/components/sign-up-form";

function isGoogleAuthEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * 注册页面
 * 路由: /sign-up
 */
export default function SignUpPage() {
  return <SignUpForm googleAuthEnabled={isGoogleAuthEnabled()} />;
}
