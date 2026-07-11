/**
 * 账户中心高保真原型开发路由。
 *
 * 使用方：设计评审与浏览器视觉回归。
 * 关键依赖：AccountPreview，本路由不读取真实账户或财务数据。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountPreview } from "@/features/non-creation-preview/account-preview";

export const metadata: Metadata = {
  title: "Account center prototype",
  robots: { follow: false, index: false },
};

/**
 * 渲染仅开发环境可见的账户中心交互原型。
 *
 * @param props.params 当前本地化路由参数。
 * @returns 只使用模拟数据的账户中心原型。
 * @failureMode 非开发环境直接返回 404。
 */
export default async function AccountPreviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { locale } = await params;
  return <AccountPreview locale={locale} />;
}
