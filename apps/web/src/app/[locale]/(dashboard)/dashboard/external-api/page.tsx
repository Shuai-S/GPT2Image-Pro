import { getServerSession } from "@repo/shared/auth/server";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { isOperationFeatureEnabled } from "@repo/shared/system-settings";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { ExternalApiKeySection } from "@/features/settings/components";

/**
 * 生成外部 API 页面 metadata。
 *
 * @returns 带管理员应用名称的页面标题与描述。
 * @sideEffects 读取 system_settings 表。
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getRuntimeBrandingConfig();

  return {
    title: `External API | ${branding.name}`,
    description: `Create and manage ${branding.name} external API keys`,
  };
}

export default async function ExternalApiPage() {
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }
  if (!(await isOperationFeatureEnabled("externalApi"))) {
    redirect(`/${locale}/dashboard`);
  }

  const [t, branding] = await Promise.all([
    getTranslations("Settings.externalApi"),
    getRuntimeBrandingConfig(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-medium">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("description", { brandName: branding.name })}
        </p>
      </div>
      <ExternalApiKeySection brandName={branding.name} />
    </div>
  );
}
