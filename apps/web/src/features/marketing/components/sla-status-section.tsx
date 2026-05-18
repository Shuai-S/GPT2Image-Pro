import type { GenerationSlaStats } from "@/features/image-generation/sla";

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

export function SlaStatusSection({
  locale,
  stats,
}: {
  locale: string;
  stats: GenerationSlaStats;
}) {
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);

  const items = [
    {
      label: copy("Completed", "成功生成"),
      value: formatNumber(stats.completed),
    },
    {
      label: copy("Platform / upstream errors", "平台或上游错误"),
      value: formatNumber(stats.platformErrors),
    },
    {
      label: copy("Moderation stops", "审核拦截或异常"),
      value: formatNumber(stats.moderationErrors),
    },
    {
      label: copy("User request errors", "用户请求错误"),
      value: formatNumber(stats.userRequestErrors),
    },
  ];

  return (
    <section className="border-y bg-muted/25">
      <div className="container py-10">
        <div className="grid gap-6 lg:grid-cols-[1.3fr_2fr] lg:items-center">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {copy(
                `Live sample: latest ${formatNumber(stats.sampleSize)} generations`,
                `实时样本：最近 ${formatNumber(stats.sampleSize)} 张生成记录`
              )}
            </p>
            <h2 className="mt-2 font-serif text-2xl font-medium tracking-tight">
              {copy("Generation SLA", "生图服务 SLA")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {copy(
                "Availability excludes moderation stops and invalid user requests, so platform reliability is visible separately from request quality.",
                "可用性统计剔除审核拦截和用户请求错误，单独展示平台侧可靠性。"
              )}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg border bg-background p-4">
              <p className="text-xs font-medium text-muted-foreground">
                {copy("SLA", "SLA")}
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {formatPercent(stats.successRate)}
              </p>
            </div>
            {items.map((item) => (
              <div key={item.label} className="rounded-lg border bg-background p-4">
                <p className="text-xs font-medium text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-2 text-2xl font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
