/**
 * 推荐管理（admin）页面加载骨架屏
 *
 * Next.js App Router 在页面数据获取时自动显示此组件，
 * 提供即时视觉反馈，避免页面切换时的空白闪烁。
 */
const adminReferralSkeletonIds = ["stat-1", "stat-2", "stat-3", "row-1", "row-2", "row-3"];

export default function AdminReferralLoading() {
  return (
    <div className="container mx-auto py-6 px-4 md:px-6 animate-pulse">
      {/* 标题骨架 */}
      <div className="space-y-2 mb-6">
        <div className="h-8 w-56 bg-muted rounded" />
        <div className="h-4 w-80 bg-muted rounded" />
      </div>

      {/* 统计卡片骨架 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 mb-6">
        {adminReferralSkeletonIds.slice(0, 3).map((id) => (
          <div key={id} className="rounded-lg border p-6 space-y-3">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-8 w-32 bg-muted rounded" />
          </div>
        ))}
      </div>

      {/* 列表骨架 */}
      <div className="rounded-lg border space-y-3 p-6">
        {adminReferralSkeletonIds.slice(3).map((id) => (
          <div key={id} className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-muted" />
            <div className="space-y-2 flex-1">
              <div className="h-4 w-1/3 bg-muted rounded" />
              <div className="h-3 w-1/4 bg-muted rounded" />
            </div>
            <div className="h-8 w-20 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}