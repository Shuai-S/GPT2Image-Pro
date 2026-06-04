"use client";

/**
 * 图表卡懒加载包装器。
 *
 * 职责:把 `ImagePricingChartCard`(内部依赖 recharts,约 107KB gzip)改为
 * `next/dynamic`(ssr:false)按需加载,使控制台首页的初始 bundle 不含 recharts——
 * 图表在客户端挂载后再异步拉取,首屏更轻。占位用等高骨架避免布局跳动。
 *
 * 使用方:服务端的控制台首页(`dashboard/page.tsx`)。Server Component 不能直接用
 * `dynamic({ ssr: false })`,故经此 'use client' 包装器中转。
 */

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { ImagePricingChartCard } from "./image-pricing-chart-card";

const LazyImagePricingChartCard = dynamic(
  () =>
    import("./image-pricing-chart-card").then((m) => ({
      default: m.ImagePricingChartCard,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-border bg-background p-6">
        <div className="mb-4 h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-[260px] w-full animate-pulse rounded bg-muted" />
      </div>
    ),
  }
);

export function ImagePricingChartCardLazy(
  props: ComponentProps<typeof ImagePricingChartCard>
) {
  return <LazyImagePricingChartCard {...props} />;
}
