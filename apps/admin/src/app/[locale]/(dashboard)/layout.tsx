import { checkAdmin } from "@repo/shared/auth/admin";
import { db } from "@repo/database";
import { ticket } from "@repo/database/schema";
import { sql } from "drizzle-orm";

import { AdminSidebar } from "@/features/admin/components/admin-sidebar";

async function getAdminUnreadTicketCount() {
  const rows = await db
    .select({
      count:
        sql<number>`count(*) filter (where ${ticket.lastUserActivityAt} is not null and (${ticket.adminLastSeenAt} is null or ${ticket.lastUserActivityAt} > ${ticket.adminLastSeenAt}))`.mapWith(
          Number
        ),
    })
    .from(ticket);

  return rows[0]?.count ?? 0;
}

/**
 * Dashboard 布局组件 (Admin 站)
 *
 * 功能:
 * - RBAC 权限检查 (只有 admin 角色可访问)
 * - Admin 专用侧边栏
 * - 路径为 /dashboard 而非 /admin（独立站点）
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 权限检查 - 非管理员会被重定向
  await checkAdmin();
  const unreadTicketCount = await getAdminUnreadTicketCount();

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar initialUnreadTicketCount={unreadTicketCount} />
      <div className="pl-64">
        {/* Admin 顶栏 */}
        <header className="sticky top-0 z-30 flex h-14 items-center border-b bg-background/80 px-6 backdrop-blur">
          <h1 className="text-lg font-serif font-semibold">Admin Panel</h1>
        </header>
        {/* 主内容区域 */}
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
