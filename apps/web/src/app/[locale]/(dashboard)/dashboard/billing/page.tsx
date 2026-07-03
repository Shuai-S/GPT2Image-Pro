import type { Metadata } from "next";
import { getServerSession } from "@repo/shared/auth/server";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { CreditUsageSection } from "@repo/shared/credits/components";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getAppTimeZone } from "@repo/shared/time-zone/server";

import { BillingSection } from "@/features/settings/components/billing-section";

/**
 * 生成账单页面 metadata。
 *
 * @returns 带管理员应用名称的页面标题。
 * @sideEffects 读取 system_settings 表。
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getRuntimeBrandingConfig();

  return {
    title: `Billing & Usage | ${branding.name}`,
    description: "Manage subscriptions, billing history, and credit usage",
  };
}

export default async function BillingPage() {
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const [t, tTabs, timeZone] = await Promise.all([
    getTranslations("Settings.billing"),
    getTranslations("Settings.billing.tabs"),
    getAppTimeZone(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-medium">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <Tabs defaultValue="billing" className="w-full">
        <TabsList className="mb-6 h-auto gap-1 bg-muted/60 p-1">
          <TabsTrigger value="billing" className="px-4 py-2">
            {tTabs("billing")}
          </TabsTrigger>
          <TabsTrigger value="usage" className="px-4 py-2">
            {tTabs("usage")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="billing" className="mt-0">
          <BillingSection timeZone={timeZone} />
        </TabsContent>
        <TabsContent value="usage" className="mt-0">
          <CreditUsageSection timeZone={timeZone} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
