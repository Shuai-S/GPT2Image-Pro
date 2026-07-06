import { db } from "@repo/database";
import { ticket, user } from "@repo/database/schema";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { isAdminRole } from "@repo/shared/auth/roles";
import { getServerSession } from "@repo/shared/auth/server";
import { formatDateInTimeZone } from "@repo/shared/time-zone";
import { getAppTimeZone } from "@repo/shared/time-zone/server";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { desc, eq, sql } from "drizzle-orm";
import { Plus, Ticket } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

const userUnreadTicketSql =
  sql<boolean>`${ticket.lastAdminActivityAt} > ${ticket.userLastSeenAt}`.mapWith(
    Boolean
  );
const adminUnreadTicketSql =
  sql<boolean>`${ticket.lastUserActivityAt} is not null and (${ticket.adminLastSeenAt} is null or ${ticket.lastUserActivityAt} > ${ticket.adminLastSeenAt})`.mapWith(
    Boolean
  );

/**
 * 用户工单列表页面
 *
 * 展示用户提交的所有支持工单
 */
export default async function SupportPage() {
  // 获取当前用户会话
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const [t, role, timeZone] = await Promise.all([
    getTranslations("Support"),
    getUserRoleById(session.user.id),
    getAppTimeZone(),
  ]);
  const isAdmin = isAdminRole(role);
  const unreadSql = isAdmin ? adminUnreadTicketSql : userUnreadTicketSql;

  const tickets = isAdmin
    ? await db
        .select({
          id: ticket.id,
          userId: ticket.userId,
          subject: ticket.subject,
          category: ticket.category,
          priority: ticket.priority,
          status: ticket.status,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
          user: {
            name: user.name,
            email: user.email,
          },
          unread: unreadSql,
        })
        .from(ticket)
        .leftJoin(user, eq(ticket.userId, user.id))
        .orderBy(desc(ticket.createdAt))
    : await db
        .select({
          id: ticket.id,
          userId: ticket.userId,
          subject: ticket.subject,
          category: ticket.category,
          priority: ticket.priority,
          status: ticket.status,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
          user: {
            name: user.name,
            email: user.email,
          },
          unread: unreadSql,
        })
        .from(ticket)
        .leftJoin(user, eq(ticket.userId, user.id))
        .where(eq(ticket.userId, session.user.id))
        .orderBy(desc(ticket.createdAt));

  /**
   * 获取状态徽章样式
   */
  const getStatusBadge = (status: string) => {
    const colorMap: Record<string, string> = {
      open: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      in_progress:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      resolved:
        "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      closed: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
    };
    return (
      <Badge
        className={colorMap[status] || colorMap.closed}
        variant="secondary"
      >
        {t(`statuses.${status}` as Parameters<typeof t>[0])}
      </Badge>
    );
  };

  /**
   * 获取优先级徽章样式
   */
  const getPriorityBadge = (priority: string) => {
    const colorMap: Record<string, string> = {
      low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      medium:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    };
    return (
      <Badge
        className={colorMap[priority] || colorMap.medium}
        variant="secondary"
      >
        {t(`priorities.${priority}` as Parameters<typeof t>[0])}
      </Badge>
    );
  };

  /**
   * 获取类别标签
   */
  const getCategoryLabel = (category: string) => {
    return t(`categories.${category}` as Parameters<typeof t>[0]);
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t("title")}</h2>
          <p className="text-muted-foreground">
            {isAdmin ? t("adminSubtitle") : t("subtitle")}
          </p>
        </div>
        <Link href={`/${locale}/dashboard/support/new`}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {t("newTicket")}
          </Button>
        </Link>
      </div>

      {/* 工单列表 */}
      {tickets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Ticket className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">{t("noTickets")}</h3>
            <p className="text-muted-foreground mb-4">
              {t("noTicketsDescription")}
            </p>
            <Link href={`/${locale}/dashboard/support/new`}>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                {t("createFirst")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {tickets.map((tkt) => (
            <Link key={tkt.id} href={`/${locale}/dashboard/support/${tkt.id}`}>
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2 text-base">
                        {tkt.unread && (
                          <span className="h-2 w-2 rounded-full bg-red-500" />
                        )}
                        <span>{tkt.subject}</span>
                        {tkt.unread && (
                          <Badge
                            className="bg-red-500 text-white"
                            variant="secondary"
                          >
                            新动态
                          </Badge>
                        )}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {getCategoryLabel(tkt.category)} ·{" "}
                        {formatDateInTimeZone(
                          tkt.createdAt,
                          locale,
                          {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                          },
                          timeZone
                        )}
                        {isAdmin && tkt.user?.email
                          ? ` · ${tkt.user.name || t("unknownUser")} (${tkt.user.email})`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {getPriorityBadge(tkt.priority)}
                      {getStatusBadge(tkt.status)}
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
