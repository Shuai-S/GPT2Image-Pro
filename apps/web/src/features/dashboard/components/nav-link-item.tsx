/**
 * Dashboard 导航项组件
 *
 * 职责：渲染一个侧边栏导航项及其子项，处理 active 样式、折叠态标题、未读角标。
 *
 * 使用方：DashboardSidebar。
 * 关键依赖：NavItem 配置、Next Link、lucide 图标、Tailwind 样式工具。
 */
"use client";

import type { NavItem } from "@repo/shared/config";
import { cn } from "@repo/ui/utils";
import Link from "next/link";

type NavLinkItemProps = {
  item: NavItem;
  collapsed: boolean;
  mobile: boolean;
  localizedHref: (href: string) => string;
  isNavItemActive: (href: string) => boolean;
  getNavTitle: (item: Pick<NavItem, "title" | "labelKey">) => string;
  getUnreadCount: (href: string) => number;
  onNavigate: () => void;
};

/**
 * 渲染 Dashboard 侧边栏中的单个导航项。
 *
 * @param props.item 导航项配置。
 * @param props.collapsed 是否处于桌面折叠态。
 * @param props.mobile 是否在移动端 Sheet 中渲染。
 * @param props.localizedHref href 本地化函数。
 * @param props.isNavItemActive active 判断函数。
 * @param props.getNavTitle 本地化标题函数。
 * @param props.getUnreadCount 未读角标查询函数。
 * @param props.onNavigate 导航点击后的副作用回调。
 * @returns 导航项及当前展开的子项。
 * @sideEffects 点击链接时调用 onNavigate，通常用于关闭移动端菜单。
 * @failureMode 缺少 icon 时只渲染文本；缺少 children 时跳过子菜单。
 */
export function NavLinkItem({
  item,
  collapsed,
  mobile,
  localizedHref,
  isNavItemActive,
  getNavTitle,
  getUnreadCount,
  onNavigate,
}: NavLinkItemProps) {
  const isActive = item.children
    ? item.children.some((child) => isNavItemActive(child.href))
    : isNavItemActive(item.href);
  const Icon = item.icon;
  const translatedTitle = getNavTitle(item);
  const unreadCount = getUnreadCount(item.href);
  const showUnread = unreadCount > 0;

  return (
    <div>
      <Link
        href={localizedHref(item.href)}
        title={collapsed ? translatedTitle : undefined}
        onClick={() => mobile && onNavigate()}
        className={cn(
          "flex items-center gap-3 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-accent text-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          collapsed && "justify-center px-0"
        )}
      >
        {Icon && (
          <span className="relative inline-flex shrink-0">
            <Icon className="h-4 w-4" />
            {showUnread && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-sidebar" />
            )}
          </span>
        )}
        {!collapsed && (
          <>
            <span className="flex-1">{translatedTitle}</span>
            {showUnread && (
              <span className="min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </>
        )}
      </Link>
      {!collapsed && item.children && isActive && (
        <div className="mt-1 space-y-0.5 pl-7">
          {item.children.map((child) => {
            const ChildIcon = child.icon;
            const childTitle = getNavTitle(child);
            const childActive = isNavItemActive(child.href);
            return (
              <Link
                key={child.href}
                href={localizedHref(child.href)}
                onClick={() => mobile && onNavigate()}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                  childActive
                    ? "bg-accent/70 text-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                {ChildIcon && <ChildIcon className="h-3.5 w-3.5" />}
                <span className="truncate">{childTitle}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
