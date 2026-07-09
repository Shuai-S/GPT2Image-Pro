import { Suspense } from "react";
import { AuthFormFallback } from "@/features/auth/components/auth-form-fallback";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";

/**
 * 重置密码页面
 * 路由: /reset-password
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthFormFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
