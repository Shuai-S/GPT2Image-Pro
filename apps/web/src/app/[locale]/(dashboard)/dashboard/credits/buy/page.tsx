import type { Metadata } from "next";
import { Suspense } from "react";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";

import { BuyCreditPackagesView } from "./buy-credits-view";

/**
 * 生成购买积分页面 metadata。
 *
 * @returns 带管理员应用名称的页面描述。
 * @sideEffects 读取 system_settings 表。
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getRuntimeBrandingConfig();

  return {
    title: "Buy Credits",
    description: `Purchase credit packages for ${branding.name}`,
  };
}

/**
 * 购买积分页面
 *
 * 展示积分套餐供用户选择并购买
 */
export default function BuyCreditsPage() {
  return (
    <Suspense fallback={null}>
      <BuyCreditPackagesView />
    </Suspense>
  );
}
