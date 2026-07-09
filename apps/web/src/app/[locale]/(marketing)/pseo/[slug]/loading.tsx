/**
 * 程序化 SEO 详情页加载骨架屏
 *
 * Next.js App Router 在页面数据获取时自动显示此组件，
 * 提供即时视觉反馈，避免页面切换时的空白闪烁。
 */
export default function PseoSlugLoading() {
  return (
    <div className="container mx-auto py-12 px-4 md:px-6 max-w-4xl animate-pulse">
      {/* Hero 区骨架 */}
      <div className="space-y-4 mb-10">
        <div className="h-10 w-3/4 bg-muted rounded" />
        <div className="h-5 w-full bg-muted rounded" />
        <div className="h-5 w-5/6 bg-muted rounded" />
        <div className="flex gap-3">
          <div className="h-10 w-32 bg-muted rounded" />
          <div className="h-10 w-32 bg-muted rounded" />
        </div>
      </div>

      {/* 内容块骨架 */}
      <div className="space-y-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <div className="h-6 w-1/3 bg-muted rounded" />
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-4/5 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}