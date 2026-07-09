/**
 * 认证表单 Suspense 占位。
 *
 * 使用方：读取 URL 查询参数的注册与重置密码表单。固定主要尺寸，避免客户端接管时布局跳动。
 */

/**
 * 渲染与认证表单尺寸接近的加载骨架。
 *
 * @returns 无交互、无文本的可访问隐藏占位。
 * @sideEffects 无。
 */
export function AuthFormFallback() {
  return (
    <div
      className="w-full max-w-md space-y-6"
      aria-hidden="true"
      data-testid="auth-form-fallback"
    >
      <div className="flex flex-col items-center space-y-4">
        <div className="h-12 w-12 animate-pulse rounded-lg bg-muted" />
        <div className="h-7 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-64 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-4">
        <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}
