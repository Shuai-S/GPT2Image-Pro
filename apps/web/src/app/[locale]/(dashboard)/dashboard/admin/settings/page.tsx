import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { getServerSession } from "@repo/shared/auth/server";
import { SystemSettingsPanel } from "@repo/shared/system-settings/components";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { ImageBackendPoolAdminPanel } from "@/features/image-backend-pool";

export default async function DashboardAdminSettingsPage() {
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  if ((session.user as { role?: string }).role !== "admin") {
    redirect(`/${locale}/dashboard`);
  }

  return (
    <Tabs defaultValue="system" className="w-full">
      <TabsList className="h-auto flex-wrap justify-start bg-transparent p-0">
        <TabsTrigger
          value="system"
          className="rounded-md border border-transparent px-3 py-2 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground/5 data-[state=active]:text-foreground data-[state=active]:shadow-none"
        >
          系统设置
        </TabsTrigger>
        <TabsTrigger
          value="image-backends"
          className="rounded-md border border-transparent px-3 py-2 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground/5 data-[state=active]:text-foreground data-[state=active]:shadow-none"
        >
          生图后端池
        </TabsTrigger>
      </TabsList>
      <TabsContent value="system" className="mt-6">
        <SystemSettingsPanel />
      </TabsContent>
      <TabsContent value="image-backends" className="mt-6">
        <ImageBackendPoolAdminPanel />
      </TabsContent>
    </Tabs>
  );
}
