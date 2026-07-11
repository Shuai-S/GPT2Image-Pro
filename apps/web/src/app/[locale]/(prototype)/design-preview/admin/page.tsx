/**
 * 管理控制台高保真原型开发路由。
 *
 * 使用方：设计评审与浏览器视觉回归。
 * 关键依赖：AdminPreview，本路由不读取真实管理或平台数据。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminPreview } from "@/features/non-creation-preview/admin-preview";

export const metadata: Metadata = {
  title: "Admin console prototype",
  robots: { follow: false, index: false },
};

/**
 * 渲染仅开发环境可见的管理控制台交互原型。
 *
 * @param props.params 当前本地化路由参数。
 * @returns 只使用模拟数据的桌面管理原型。
 * @failureMode 非开发环境直接返回 404。
 */
export default async function AdminPreviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { locale } = await params;
  return <AdminPreview locale={locale} />;
}
