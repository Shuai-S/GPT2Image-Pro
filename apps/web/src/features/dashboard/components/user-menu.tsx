/**
 * Dashboard 用户菜单组件
 *
 * 职责：渲染侧边栏底部的用户信息、积分余额、套餐徽章、主题切换、设置入口和登出入口。
 *
 * 使用方：DashboardSidebar。
 * 关键依赖：Better Auth 客户端登出、用户套餐 action、CreditBalanceBadge、ModeToggle。
 */
"use client";

import { signOut } from "@repo/shared/auth/client";
import { ModeToggle } from "@repo/shared/components/mode-toggle";
import { CreditBalanceBadge } from "@repo/shared/credits/components";
import { getMyPlanAction } from "@repo/shared/subscription/actions/get-user-plan";
import {
  PlanBadge,
  type PlanType,
} from "@repo/shared/subscription/components/plan-badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@repo/ui/components/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { Separator } from "@repo/ui/components/separator";
import { cn } from "@repo/ui/utils";
import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import type { CurrentSession } from "@/features/auth/hooks/use-current-session";

type DashboardUser = NonNullable<NonNullable<CurrentSession>["user"]>;

type UserMenuProps = {
  user?: DashboardUser;
  collapsed: boolean;
  locale: string;
};

/**
 * 获取用户名首字母作为头像回退。
 *
 * @param name 用户显示名称。
 * @returns 最多两个大写首字母。
 * @sideEffects 无。
 * @failureMode 空名称返回空字符串，AvatarFallback 仍会稳定渲染。
 */
function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * 渲染 Dashboard 侧边栏底部用户菜单。
 *
 * @param props.user 当前用户；未加载时展示骨架屏。
 * @param props.collapsed 是否处于桌面折叠态。
 * @param props.locale 当前语言前缀。
 * @returns 用户菜单或加载骨架。
 * @sideEffects 用户登录后读取套餐；点击设置会导航；点击登出会清理会话并跳首页。
 * @failureMode 套餐读取失败时按 free 展示，登出失败由 auth 客户端处理。
 */
export function UserMenu({ user, collapsed, locale }: UserMenuProps) {
  const router = useRouter();
  const t = useTranslations("Dashboard");
  const [open, setOpen] = useState(false);
  const { execute: fetchPlan, result: planResult } = useAction(getMyPlanAction);
  const userPlan = (planResult.data?.plan as PlanType) || "free";

  useEffect(() => {
    if (user?.id) {
      fetchPlan();
    }
  }, [user?.id, fetchPlan]);

  /**
   * 处理登出。
   *
   * @returns Promise<void>。
   * @sideEffects 调用 Better Auth signOut，成功后跳转首页。
   */
  const handleSignOut = async () => {
    setOpen(false);
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/");
        },
      },
    });
  };

  /**
   * 处理设置入口点击。
   *
   * @returns 无返回值。
   * @sideEffects 关闭 Popover 并跳转设置页。
   */
  const handleSettingsClick = () => {
    setOpen(false);
    router.push(`/${locale}/dashboard/settings`);
  };

  return (
    <div
      className="border-t border-sidebar-border p-3"
      key={user?.id || "session-loading"}
    >
      {user ? (
        <Popover key={user.id} open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-sidebar-accent/50 transition-colors",
                collapsed && "justify-center px-0"
              )}
            >
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarImage
                  key={user.image || user.id}
                  src={user.image || undefined}
                  alt={user.name}
                />
                <AvatarFallback className="bg-foreground text-background text-xs">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="mb-1 flex items-center">
                      <CreditBalanceBadge key={user.id} />
                    </div>
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              )}
            </button>
          </PopoverTrigger>

          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-64 p-0"
          >
            <div className="flex items-center gap-3 p-4">
              <Avatar className="h-10 w-10">
                <AvatarImage
                  key={user.image || user.id}
                  src={user.image || undefined}
                  alt={user.name}
                />
                <AvatarFallback className="bg-foreground text-background">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 truncate">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{user.name}</p>
                  <PlanBadge plan={userPlan} size="xs" />
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-center p-3">
              <ModeToggle variant="inline" />
            </div>

            <Separator />

            <div className="p-2">
              <button
                type="button"
                onClick={handleSettingsClick}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
              >
                <Settings className="h-4 w-4" />
                {t("sidebar.settings")}
              </button>

              <button
                type="button"
                onClick={handleSignOut}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
              >
                <LogOut className="h-4 w-4" />
                {t("sidebar.logout")}
              </button>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <div
          className={cn(
            "flex items-center gap-3 rounded-md px-2 py-1.5",
            collapsed && "justify-center px-0"
          )}
        >
          <div className="h-8 w-8 animate-pulse rounded-full bg-sidebar-accent shrink-0" />
          {!collapsed && (
            <div className="flex-1 space-y-1">
              <div className="h-4 w-20 animate-pulse rounded bg-sidebar-accent" />
              <div className="h-3 w-32 animate-pulse rounded bg-sidebar-accent" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
