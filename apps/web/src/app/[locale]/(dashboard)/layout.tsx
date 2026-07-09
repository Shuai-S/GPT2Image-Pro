// 直接从各模块导入(不经 barrel index.ts):barrel re-export 多个卡片组件,经它导入会把
// 这些组件及其依赖一并拖进每页必载的公共 bundle(tree-shaking 被 barrel 破坏)。

import { getUserRoleById } from "@repo/shared/auth/role-server";
import { getServerSession } from "@repo/shared/auth/server";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { getRuntimeOperationFeatureFlags } from "@repo/shared/system-settings";
import { NextIntlClientProvider } from "next-intl";
import {
  CurrentSessionProvider,
  type CurrentSession,
} from "@/features/auth/hooks/use-current-session";
import { DashboardMainWrapper } from "@/features/dashboard/components/main-wrapper";
import { DashboardSidebar } from "@/features/dashboard/components/sidebar";
import { SidebarProvider } from "@/features/dashboard/context";
import { CreateRuntimeProvider } from "@/features/image-generation/create-runtime-store";
import { loadMessageGroups } from "@/i18n/message-loader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // A-P0-2：把 getUserRoleById 并入 Promise.all（role 经 cache() 复用，
  // 与各 page 共享同一查询结果），去掉原先 Promise.all 之外的串行 await，
  // layout 内 DB 段由 2 段并行收敛为 1 段并行。
  const [serverSession, branding, operationFlags, messages] = await Promise.all(
    [
      getServerSession(),
      getRuntimeBrandingConfig(),
      getRuntimeOperationFeatureFlags(),
      loadMessageGroups(locale, ["common", "dashboard"]),
    ]
  );
  const role = serverSession?.user?.id
    ? await getUserRoleById(serverSession.user.id)
    : null;
  const initialSession: CurrentSession = serverSession?.user?.id
    ? {
        user: {
          id: serverSession.user.id,
          name: serverSession.user.name || "",
          email: serverSession.user.email || "",
          image: serverSession.user.image,
          role: role ?? "user",
        },
      }
    : null;

  return (
    <NextIntlClientProvider messages={messages}>
      <CurrentSessionProvider initialData={initialSession}>
        <SidebarProvider>
          <CreateRuntimeProvider>
            <div className="min-h-screen bg-muted">
              <DashboardSidebar
                branding={branding}
                operationFlags={operationFlags}
              />
              <DashboardMainWrapper>{children}</DashboardMainWrapper>
            </div>
          </CreateRuntimeProvider>
        </SidebarProvider>
      </CurrentSessionProvider>
    </NextIntlClientProvider>
  );
}
