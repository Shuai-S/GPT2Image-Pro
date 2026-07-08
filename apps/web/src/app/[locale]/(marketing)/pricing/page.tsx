/**
 * 职责:提供营销侧独立定价页，汇总订阅套餐、额外积分包与公开模型定价。
 * 使用方:Header/Footer 导航、账单入口与 SEO 页面。关键依赖:运行时支付配置、
 * 套餐能力矩阵、积分包配置、图片基础计价与模型公开定价规则。
 */
import { siteConfig } from "@repo/shared/config";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { getRuntimePaymentConfig } from "@repo/shared/config/payment-runtime";
import { CREDIT_CONFIG_DEFAULTS } from "@repo/shared/credits/config";
import { getRuntimeCreditPackages } from "@repo/shared/credits/packages";
import { getPlanCapabilityMatrix } from "@repo/shared/subscription/services/plan-capabilities";
import { getRuntimeSettingNumber } from "@repo/shared/system-settings";
import type { Metadata } from "next";
import { getRuntimeImageEditMaxReferenceImages } from "@/features/image-generation/edit-reference-limits";
import {
  getRuntimeImageBaseCreditPricing,
  getRuntimeModerationCreditPricing,
  getRuntimePublicModelPricingRules,
} from "@/features/image-generation/pricing-settings";
import { PricingSection } from "@/features/marketing/components";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 生成定价页 Metadata。
 *
 * @param params 当前 locale 路由参数。
 * @returns 面向搜索引擎与社交分享的页面元数据。
 * @sideEffects 读取运行时品牌配置；失败会交由 Next.js 错误边界处理。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";
  const branding = await getRuntimeBrandingConfig();
  const title = isZh
    ? `${branding.name} 定价 - 订阅、积分包与模型价格`
    : `${branding.name} Pricing - Plans, Credits, and Model Rates`;
  const description = isZh
    ? "查看订阅套餐、额外积分包和公开模型定价规则，按需选择适合你的 AI 图像生成额度。"
    : "Compare subscription plans, extra credit packages, and public model pricing rules for AI image generation.";

  return {
    title,
    description,
    keywords: [
      "AI image pricing",
      "image generation pricing",
      "credits packages",
      "model pricing",
      branding.name,
      ...(isZh ? ["AI 图像定价", "订阅套餐", "积分包", "模型定价"] : []),
    ],
    openGraph: {
      title,
      description,
      type: "website",
      url: `${siteConfig.url}/${locale}/pricing`,
      siteName: branding.name,
      images: [
        {
          url: branding.ogImageUrl,
          width: 1200,
          height: 630,
          alt: branding.name,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [branding.ogImageUrl],
    },
  };
}

/**
 * 独立定价页。
 *
 * @returns 包含订阅包、积分包、模型定价和计费规则的服务端页面。
 * @sideEffects 读取运行时配置与系统设置，不修改数据库状态。
 */
export default async function PricingPage() {
  const [
    runtimePaymentConfig,
    capabilityMatrix,
    creditPackages,
    creditPackageExpiryDays,
    imageBasePricing,
    moderationPricing,
    modelPricingRules,
    maxEditImages,
  ] = await Promise.all([
    getRuntimePaymentConfig(),
    getPlanCapabilityMatrix(),
    getRuntimeCreditPackages(),
    getRuntimeSettingNumber(
      "CREDITS_EXPIRY_DAYS",
      CREDIT_CONFIG_DEFAULTS.creditsExpiryDays,
      { nonNegative: true }
    ),
    getRuntimeImageBaseCreditPricing(),
    getRuntimeModerationCreditPricing(),
    getRuntimePublicModelPricingRules(),
    getRuntimeImageEditMaxReferenceImages(),
  ]);

  return (
    <PricingSection
      payment={runtimePaymentConfig}
      capabilityMatrix={capabilityMatrix}
      creditPackages={creditPackages}
      creditPackageExpiryDays={creditPackageExpiryDays}
      imageBasePricing={imageBasePricing}
      moderationPricing={moderationPricing}
      modelPricingRules={modelPricingRules}
      maxEditImages={maxEditImages}
    />
  );
}
