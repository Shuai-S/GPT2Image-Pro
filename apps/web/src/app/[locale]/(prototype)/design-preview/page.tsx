// 视觉重构高保真原型的开发环境路由。生产构建统一返回 404，避免暴露模拟入口。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignPreview } from "@/features/design-preview/design-preview";
import type { PreviewView } from "@/features/design-preview/mock-data";

export const metadata: Metadata = {
  title: "Visual redesign prototype",
  robots: { follow: false, index: false },
};

const previewViews = new Set<PreviewView>([
  "home",
  "create-empty",
  "create-results",
  "gallery",
  "canvas",
]);

/**
 * 校验 URL 中的原型视图参数，非法值回退首页。
 *
 * @param value 未信任的 query 参数。
 * @returns 合法预览视图。
 */
function parsePreviewView(value: string | string[] | undefined): PreviewView {
  const normalized = Array.isArray(value) ? value[0] : value;
  return normalized && previewViews.has(normalized as PreviewView)
    ? (normalized as PreviewView)
    : "home";
}

/**
 * 渲染仅开发环境可见的视觉重构交互原型。
 *
 * @param props.searchParams 原型视图 query 参数。
 * @returns 无鉴权、无真实业务调用的模拟界面。
 * @failureMode 非开发环境直接返回 404。
 */
export default async function DesignPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const params = await searchParams;
  return <DesignPreview initialView={parsePreviewView(params.view)} />;
}
