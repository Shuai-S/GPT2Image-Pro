import { getUserRoleById } from "@repo/shared/auth/role-server";
import { isAdminRole } from "@repo/shared/auth/roles";
import { getServerSession } from "@repo/shared/auth/server";
import { siteConfig } from "@repo/shared/config";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { getRuntimeSettingBoolean } from "@repo/shared/system-settings";
import type { Metadata } from "next";
import { SiteJsonLd, SoftwareAppJsonLd } from "@/components/seo/json-ld";
import { getRecentGenerationSlaStats } from "@/features/image-generation/sla";
import {
  CTASection,
  FAQSection,
  FeatureGrid,
  HeroSection,
  HowItWorks,
  SlaStatusSection,
  Testimonials,
  UseCasesSection,
} from "@/features/marketing/components";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 生成首页 Metadata
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
    ? `${branding.name} - AI 对话生图平台`
    : `${branding.name} - AI Chat-to-Image Generation Platform`;

  const description = isZh
    ? "通过自然对话将你的想法转化为精美视觉图片。由最先进的 AI 模型驱动，支持批量生成、画廊管理与灵活积分系统。"
    : branding.description;

  return {
    title,
    description,
    keywords: [
      "AI image generation",
      "chat to image",
      "text to image",
      "AI art",
      branding.name,
      "image generation API",
      "creative AI",
      ...(isZh ? ["AI图像生成", "对话生图", "文字转图片", "AI艺术"] : []),
    ],
    openGraph: {
      title,
      description,
      type: "website",
      url: `${siteConfig.url}/${locale}`,
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

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [slaEnabled, slaStats, session, branding] = await Promise.all([
    getRuntimeSettingBoolean("MARKETING_SLA_STATUS_ENABLED", true),
    getRecentGenerationSlaStats(1000),
    getServerSession(),
    getRuntimeBrandingConfig(),
  ]);
  const role = session?.user?.id
    ? await getUserRoleById(session.user.id)
    : "user";
  const canToggleSlaStatus = isAdminRole(role);

  return (
    <>
      {/* JSON-LD Structured Data */}
      <SiteJsonLd locale={locale as "en" | "zh"} branding={branding} />
      <SoftwareAppJsonLd locale={locale as "en" | "zh"} branding={branding} />

      {/* Page Sections */}
      <HeroSection />
      <FeatureGrid />
      <HowItWorks />
      <UseCasesSection />
      <Testimonials />
      {(slaEnabled || canToggleSlaStatus) && (
        <SlaStatusSection
          locale={locale}
          stats={slaStats}
          initiallyEnabled={slaEnabled}
          canToggleVisibility={canToggleSlaStatus}
        />
      )}
      <FAQSection />
      <CTASection />
    </>
  );
}
