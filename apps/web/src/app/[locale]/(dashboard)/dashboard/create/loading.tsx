/**
 * 创作页加载骨架，保持与双栏创作区和参数区一致的视觉占位。
 */
const RECENT_SKELETON_KEYS = [
  "recent-1",
  "recent-2",
  "recent-3",
  "recent-4",
  "recent-5",
  "recent-6",
] as const;

export default function CreateLoading() {
  return (
    <div className="mx-auto w-full max-w-[1680px] animate-pulse px-0 py-2 md:py-4">
      <div className="mb-8 max-w-3xl space-y-2">
        <div className="h-9 w-40 rounded bg-muted" />
        <div className="h-4 w-72 rounded bg-muted" />
      </div>

      <div className="mb-10 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="h-10 w-48 rounded-md bg-muted" />
          <div className="h-32 w-full rounded-md bg-muted" />
          <div className="h-20 w-full rounded-md bg-muted" />
        </div>
        <div className="space-y-4 rounded-lg border border-border bg-background p-4 shadow-sm">
          <div className="h-10 w-full rounded bg-muted" />
          <div className="h-12 w-full rounded bg-muted" />
          <div className="h-12 w-full rounded bg-muted" />
          <div className="h-28 w-full rounded bg-muted" />
          <div className="h-10 w-full rounded bg-muted" />
        </div>
      </div>

      <div className="space-y-4">
        <div className="h-6 w-24 rounded bg-muted" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {RECENT_SKELETON_KEYS.map((key) => (
            <div key={key} className="aspect-square rounded-md bg-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}
