/**
 * 博客正文页加载骨架屏
 *
 * Next.js App Router 在页面数据获取时自动显示此组件，
 * 提供即时视觉反馈，避免页面切换时的空白闪烁。
 */
export default function BlogSlugLoading() {
  return (
    <div className="container mx-auto py-12 px-4 md:px-6 max-w-3xl animate-pulse">
      {/* 文章标题骨架 */}
      <div className="space-y-4 mb-8">
        <div className="h-4 w-32 bg-muted rounded" />
        <div className="h-10 w-full bg-muted rounded" />
        <div className="h-10 w-3/4 bg-muted rounded" />
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-3 w-20 bg-muted rounded" />
          </div>
        </div>
      </div>

      {/* 文章正文骨架 */}
      <div className="space-y-4">
        <div className="h-64 w-full bg-muted rounded" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-5 w-1/2 bg-muted rounded" />
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-5/6 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}