/**
 * 支付订单管理页加载态。
 *
 * 使用方：Next.js 在 /dashboard/admin/payments 服务端数据加载期间自动渲染。
 * 关键依赖：Tailwind 工具类与 dashboard 内容容器。
 */

/**
 * 渲染支付订单管理页的骨架屏。
 *
 * @returns 与最终页面结构接近的加载占位。
 * @sideEffects 无。
 */
export default function AdminPaymentsLoading() {
  const metricSkeletonIds = [
    "orders",
    "success",
    "pending",
    "processing",
    "amount",
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-40 rounded-md bg-muted" />
        <div className="h-4 w-full max-w-2xl rounded-md bg-muted" />
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        {metricSkeletonIds.map((id) => (
          <div key={id} className="h-24 rounded-lg border bg-muted/30" />
        ))}
      </div>
      <div className="h-40 rounded-lg border bg-muted/30" />
      <div className="h-96 rounded-lg border bg-muted/30" />
    </div>
  );
}
