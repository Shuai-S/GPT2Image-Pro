/**
 * Dashboard 侧边栏组件
 *
 * 职责：组合品牌 Logo、导航列表、用户菜单以及桌面/移动端容器。
 *
 * 使用方：Dashboard layout。
 * 关键依赖：useDashboardNav、useUnreadBadges、NavLinkItem、UserMenu。
 */
"use client";

import type { NavItem } from "@repo/shared/config";
import type { BrandingConfig } from "@repo/shared/config/branding";
import type { OperationFeatureFlags } from "@repo/shared/system-settings";
import { Sheet, SheetContent, SheetTitle } from "@repo/ui/components/sheet";
import { cn } from "@repo/ui/utils";
import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCurrentSession } from "@/features/auth/hooks/use-current-session";
import { NavLinkItem } from "@/features/dashboard/components/nav-link-item";
import { UserMenu } from "@/features/dashboard/components/user-menu";
import { useSidebar } from "@/features/dashboard/context";
import { useDashboardNav } from "@/features/dashboard/hooks/use-dashboard-nav";
import { useUnreadBadges } from "@/features/dashboard/hooks/use-unread-badges";

/**
 * Dashboard 侧边栏组件
 *
 * 功能:
 * - 导航菜单 (从配置读取)
 * - 用户信息弹出菜单
 * - 主题切换
 * - 设置入口
 * - 登出功能
 * - 支持折叠/展开
 *
 * @param branding - 管理员配置的应用名称与 Logo。
 * @returns Dashboard 侧边栏。
 * @sideEffects 读取会话、套餐、未读消息并执行登出/路由跳转。
 */
type DashboardSidebarProps = {
  branding: BrandingConfig;
  operationFlags: OperationFeatureFlags;
};

export function DashboardSidebar({
  branding,
  operationFlags,
}: DashboardSidebarProps) {
  const locale = useLocale();
  const { isCollapsed, isMobileOpen, setMobileOpen, toggleSidebar } =
    useSidebar();
  const t = useTranslations("Dashboard");

  // 获取当前用户会话
  const { data: session } = useCurrentSession();
  const user = session?.user;
  const { sidebarNav, localizedHref, isNavItemActive } = useDashboardNav({
    locale,
    role: user?.role,
    operationFlags,
  });
  const { getUnreadCount } = useUnreadBadges(user?.id);

  /**
   * 根据稳定翻译 key 获取导航显示标题。
   *
   * @param item 导航项或导航分组。
   * @returns 本地化标题；缺少 labelKey 时回退静态 title。
   * @sideEffects 无。
   * @failureMode 未配置 labelKey 的旧配置继续显示 title，避免迁移中断。
   */
  const getNavTitle = (item: Pick<NavItem, "title" | "labelKey">): string => {
    return item.labelKey ? t(item.labelKey) : item.title;
  };

  /**
   * 渲染侧边栏内容（桌面和移动端共用）
   * mobile 参数控制是否为移动端模式（始终展开，点击关闭）
   */
  const renderSidebarContent = (mobile: boolean) => {
    const collapsed = mobile ? false : isCollapsed;

    return (
      <>
        {/* Logo */}
        <div className="flex h-14 items-center px-4">
          <Link
            href={`/${locale}`}
            className="flex items-center gap-2"
            onClick={(e) => {
              if (mobile) {
                setMobileOpen(false);
              } else if (collapsed) {
                e.preventDefault();
                toggleSidebar();
              }
            }}
          >
            <Image
              src={branding.logoUrl}
              alt={branding.name}
              width={24}
              height={24}
              className="h-6 w-6 shrink-0 object-contain"
              unoptimized
            />
            <span
              className={cn(
                "font-serif text-lg font-medium tracking-tight transition-opacity",
                collapsed && "opacity-0"
              )}
            >
              {branding.name}
            </span>
          </Link>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {sidebarNav.map((group) => (
            <div key={group.title}>
              {/* Group Label - 折叠时隐藏 */}
              {!collapsed && (
                <p className="mb-1.5 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {getNavTitle(group)}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLinkItem
                    key={item.href}
                    item={item}
                    collapsed={collapsed}
                    mobile={mobile}
                    localizedHref={localizedHref}
                    isNavItemActive={isNavItemActive}
                    getNavTitle={getNavTitle}
                    getUnreadCount={getUnreadCount}
                    onNavigate={() => setMobileOpen(false)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <UserMenu user={user} collapsed={collapsed} locale={locale} />
      </>
    );
  };

  return (
    <>
      {/* 桌面端侧边栏 */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 hidden h-screen flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 md:flex",
          isCollapsed ? "w-16" : "w-64"
        )}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* 移动端 Sheet 侧边栏 */}
      <Sheet open={isMobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-64 bg-sidebar p-0 md:hidden [&>button:last-child]:hidden"
        >
          <SheetTitle className="sr-only">{t("nav.dashboard")}</SheetTitle>
          <div className="flex h-full flex-col">
            {renderSidebarContent(true)}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
