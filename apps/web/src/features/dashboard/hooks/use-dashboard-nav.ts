/**
 * Dashboard 导航数据 Hook
 *
 * 职责：把共享导航配置按当前用户角色、运营功能开关、当前路由状态过滤并组织成
 * 侧边栏可直接渲染的数据。
 *
 * 使用方：DashboardSidebar。
 * 关键依赖：@repo/shared/config 的 dashboardConfig、OperationFeatureFlags、Next 路由状态。
 */
"use client";

import type { AppUserRole } from "@repo/shared/auth/roles";
import type { NavGroup, NavItem } from "@repo/shared/config";
import { dashboardConfig } from "@repo/shared/config";
import type { OperationFeatureFlags } from "@repo/shared/system-settings";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";

type UseDashboardNavParams = {
  locale: string;
  role?: AppUserRole;
  operationFlags: OperationFeatureFlags;
};

/**
 * 判断导航项角色要求是否允许当前用户查看。
 *
 * @param item 导航项配置。
 * @param role 当前用户角色。
 * @returns 当前角色是否满足 roles 要求。
 * @sideEffects 无。
 * @failureMode 未登录或缺少角色时，只允许无 roles 限制的普通菜单。
 */
function canViewByRole(item: NavItem, role?: AppUserRole) {
  if (!item.roles?.length) return true;
  if (!role) return false;
  return item.roles.includes(role);
}

/**
 * 判断导航项绑定的运营开关是否开启。
 *
 * @param item 导航项配置。
 * @param operationFlags 当前运营功能开关快照。
 * @returns 未绑定 featureFlag 或对应开关为 true 时返回 true。
 * @sideEffects 无。
 * @failureMode 未知 featureFlag 会被 TypeScript 拦截；运行期按 false 处理。
 */
function canViewByFeatureFlag(
  item: NavItem,
  operationFlags: OperationFeatureFlags
) {
  return item.featureFlag ? operationFlags[item.featureFlag] === true : true;
}

/**
 * 递归过滤单个导航项。
 *
 * @param item 原始导航项。
 * @param role 当前用户角色。
 * @param operationFlags 当前运营功能开关快照。
 * @returns 可见导航项；不满足权限/开关或 children 全空时返回 null。
 * @sideEffects 无。
 * @failureMode 父级 children 被过滤后，href 自动指向第一个可见 child，避免入口落到关闭功能。
 */
function filterNavItem(
  item: NavItem,
  role: AppUserRole | undefined,
  operationFlags: OperationFeatureFlags
): NavItem | null {
  if (!canViewByRole(item, role) || !canViewByFeatureFlag(item, operationFlags)) {
    return null;
  }

  if (!item.children?.length) return item;

  const children = item.children
    .map((child) => filterNavItem(child, role, operationFlags))
    .filter((child): child is NavItem => Boolean(child));
  if (children.length === 0) return null;

  return {
    ...item,
    href: children[0]?.href ?? item.href,
    children,
  };
}

/**
 * 构建 Dashboard 侧边栏导航状态。
 *
 * @param params.locale 当前语言前缀。
 * @param params.role 当前用户角色。
 * @param params.operationFlags 当前运营功能开关快照。
 * @returns 已过滤菜单、href 本地化函数和 active 判断函数。
 * @sideEffects 读取 Next 当前 path/searchParams。
 * @failureMode 当前路径异常时只会导致 active 状态为 false，不影响菜单渲染。
 */
export function useDashboardNav({
  locale,
  role,
  operationFlags,
}: UseDashboardNavParams) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sidebarNav = useMemo<NavGroup[]>(() => {
    const baseGroups = dashboardConfig.sidebarNav
      .map((group) => ({
        ...group,
        items: group.items
          .map((item) => filterNavItem(item, role, operationFlags))
          .filter((item): item is NavItem => Boolean(item)),
      }))
      .filter((group) => group.items.length > 0);

    const adminItems = dashboardConfig.sidebarAdminNav
      .map((item) => filterNavItem(item, role, operationFlags))
      .filter((item): item is NavItem => Boolean(item));
    if (adminItems.length === 0) return baseGroups;

    return baseGroups.map((group, index) =>
      index === 0 ? { ...group, items: [...group.items, ...adminItems] } : group
    );
  }, [role, operationFlags]);

  /**
   * 为应用内 href 加上当前 locale 前缀。
   *
   * @param href 导航配置中的原始 href。
   * @returns 带 locale 的 href；外链或非绝对路径保持原样。
   * @sideEffects 无。
   * @failureMode locale 已由布局校验，异常值只影响生成链接前缀。
   */
  const localizedHref = (href: string) =>
    href.startsWith("/") ? `/${locale}${href}` : href;

  /**
   * 判断导航项是否匹配当前地址。
   *
   * @param href 导航目标地址，可包含 query 参数。
   * @returns 当前路径与查询参数是否命中该导航项。
   * @sideEffects 无。
   * @failureMode query 解析失败时 URLSearchParams 会按空值处理，返回 false。
   */
  const isNavItemActive = (href: string) => {
    const normalizedPath = pathname.replace(/^\/[a-z]{2}\//, "/");
    const [hrefPath, hrefQuery = ""] = href.split("?");
    if (!hrefQuery) {
      return (
        normalizedPath === hrefPath ||
        (hrefPath !== "/dashboard" && normalizedPath.startsWith(`${hrefPath}/`))
      );
    }
    if (normalizedPath !== hrefPath) return false;

    const currentParams = new URLSearchParams(searchParams.toString());
    const hrefParams = new URLSearchParams(hrefQuery);
    for (const [key, value] of hrefParams) {
      if (currentParams.get(key) !== value) return false;
    }
    return true;
  };

  return {
    sidebarNav,
    localizedHref,
    isNavItemActive,
  };
}
