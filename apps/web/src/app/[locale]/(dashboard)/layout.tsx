// 直接从各模块导入(不经 barrel index.ts):barrel re-export 多个卡片组件,经它导入会把
// 这些组件及其依赖一并拖进每页必载的公共 bundle(tree-shaking 被 barrel 破坏)。
import { DashboardMainWrapper } from "@/features/dashboard/components/main-wrapper";
import { DashboardSidebar } from "@/features/dashboard/components/sidebar";
import { SidebarProvider } from "@/features/dashboard/context";
import { CreateRuntimeProvider } from "@/features/image-generation/create-runtime-store";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { getServerSession } from "@repo/shared/auth/server";
import type { CurrentSession } from "@/features/auth/hooks/use-current-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const serverSession = await getServerSession();
  const initialSession: CurrentSession = serverSession?.user?.id
    ? {
        user: {
          id: serverSession.user.id,
          name: serverSession.user.name || "",
          email: serverSession.user.email || "",
          image: serverSession.user.image,
          role: await getUserRoleById(serverSession.user.id),
        },
      }
    : null;

  return (
    <SidebarProvider>
      <CreateRuntimeProvider>
        <div className="min-h-screen bg-muted">
          <DashboardSidebar initialSession={initialSession} />
          <DashboardMainWrapper>{children}</DashboardMainWrapper>
        </div>
      </CreateRuntimeProvider>
    </SidebarProvider>
  );
}
