/**
 * 法律条款正文页加载骨架屏
 *
 * Next.js App Router 在页面数据获取时自动显示此组件，
 * 提供即时视觉反馈，避免页面切换时的空白闪烁。
 */
export default function LegalSlugLoading() {
  return (
    <div className="container mx-auto py-12 px-4 md:px-6 max-w-3xl animate-pulse">
      {/* 标题骨架 */}
      <div className="space-y-4 mb-8">
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="h-10 w-2/3 bg-muted rounded" />
        <div className="h-4 w-40 bg-muted rounded" />
      </div>

      {/* 正文骨架 */}
      <div className="space-y-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-5 w-1/3 bg-muted rounded" />
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-4/5 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}