/**
 * 推荐计划页面加载骨架屏
 *
 * Next.js App Router 在页面数据获取时自动显示此组件，
 * 提供即时视觉反馈，避免页面切换时的空白闪烁。
 */
export default function ReferralLoading() {
  return (
    <div className="container mx-auto py-6 px-4 md:px-6 animate-pulse">
      {/* 标题与说明骨架 */}
      <div className="space-y-2 mb-6">
        <div className="h-8 w-56 bg-muted rounded" />
        <div className="h-4 w-80 bg-muted rounded" />
      </div>

      {/* 邀请链接卡片骨架 */}
      <div className="rounded-lg border p-6 space-y-4 mb-6">
        <div className="h-5 w-32 bg-muted rounded" />
        <div className="h-10 w-full bg-muted rounded" />
        <div className="flex gap-2">
          <div className="h-9 w-24 bg-muted rounded" />
          <div className="h-9 w-24 bg-muted rounded" />
        </div>
      </div>

      {/* 收益统计骨架 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border p-6 space-y-3">
            <div className="h-4 w-20 bg-muted rounded" />
            <div className="h-8 w-28 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}