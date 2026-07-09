/**
 * Canvas 页面加载骨架屏
 *
 * Next.js App Router 在页面数据获取时自动显示此组件，
 * 提供即时视觉反馈，避免页面切换时的空白闪烁。
 */
export default function CanvasLoading() {
  return (
    <div className="container mx-auto py-6 animate-pulse">
      {/* 顶部标题与操作区骨架 */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-4 w-72 bg-muted rounded" />
        </div>
        <div className="h-10 w-32 bg-muted rounded" />
      </div>

      {/* 主画布区骨架 */}
      <div className="rounded-lg border p-6 space-y-4">
        <div className="h-[60vh] w-full bg-muted rounded" />
        <div className="flex gap-4">
          <div className="h-9 w-28 bg-muted rounded" />
          <div className="h-9 w-28 bg-muted rounded" />
          <div className="h-9 w-28 bg-muted rounded" />
        </div>
      </div>
    </div>
  );
}