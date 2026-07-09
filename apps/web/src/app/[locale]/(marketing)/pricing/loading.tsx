/**
 * 定价页加载骨架屏
 *
 * Next.js App Router 在页面数据获取时自动显示此组件，
 * 提供即时视觉反馈，避免页面切换时的空白闪烁。
 */
const pricingTierSkeletonIds = ["tier-1", "tier-2", "tier-3"];

export default function PricingLoading() {
  return (
    <div className="container mx-auto py-12 px-4 md:px-6 animate-pulse">
      {/* 标题区骨架 */}
      <div className="text-center space-y-4 mb-12">
        <div className="h-10 w-64 mx-auto bg-muted rounded" />
        <div className="h-5 w-96 mx-auto bg-muted rounded" />
      </div>

      {/* 套餐卡片骨架 */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3 max-w-5xl mx-auto">
        {pricingTierSkeletonIds.map((id) => (
          <div key={id} className="rounded-lg border p-8 space-y-6">
            <div className="space-y-3">
              <div className="h-6 w-24 bg-muted rounded" />
              <div className="h-10 w-28 bg-muted rounded" />
              <div className="h-4 w-40 bg-muted rounded" />
            </div>
            <div className="h-10 w-full bg-muted rounded" />
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-4 w-full bg-muted rounded" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}