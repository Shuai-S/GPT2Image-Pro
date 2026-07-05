"use client";

import type { NavItem } from "@repo/shared/config";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@repo/ui/components/navigation-menu";
import { cn } from "@repo/ui/utils";
import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/routing";

/**
 * 营销页桌面导航菜单。
 *
 * 使用方: Header 顶部导航。关键依赖: next-intl 文案、共享导航配置、
 * Framer Motion 悬浮动画，以及 @repo/ui 的 NavigationMenu 基础结构。
 */

/**
 * 营销主导航属性。
 *
 * @property mainNavItems 已按运营开关过滤的主导航项。
 */
type NavMenuProps = {
  mainNavItems: NavItem[];
};

/**
 * 导航菜单组件
 *
 * @param mainNavItems 服务端按运营开关过滤后的主导航项。
 * @returns 桌面端营销导航菜单。
 * @sideEffects 点击锚点链接时可能在当前页面平滑滚动。
 */
export function NavMenu({ mainNavItems }: NavMenuProps) {
  const pathname = usePathname();
  const t = useTranslations("Navigation");
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const navTitleMap: Record<string, string> = {
    Features: t("features"),
    Docs: t("docs"),
    Pricing: t("pricing"),
    Blog: t("blog"),
  };

  const isActive = (href: string) => {
    if (href.startsWith("/#")) return false;
    const cleanPath = pathname.replace(/^\/[a-z]{2}/, "") || "/";
    return cleanPath === href || cleanPath.startsWith(`${href}/`);
  };

  /**
   * 处理页内锚点导航。
   *
   * @param e 点击事件。
   * @param href 导航目标。
   * @returns 无返回值。
   * @sideEffects 当前位于首页且目标为页内锚点时阻止默认跳转并平滑滚动。
   * @failureMode 目标元素不存在时保持当前位置不变。
   */
  const handleClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string
  ) => {
    if (href.startsWith("/#")) {
      const anchor = href.substring(2);
      const isHomePage = pathname === "/" || pathname.match(/^\/[a-z]{2}$/);
      if (isHomePage) {
        e.preventDefault();
        const element = document.getElementById(anchor);
        if (element) {
          element.scrollIntoView({ behavior: "smooth" });
        }
      }
    }
  };

  return (
    <NavigationMenu viewport={false} onMouseLeave={() => setHoveredItem(null)}>
      <NavigationMenuList className="gap-0">
        <NavigationMenuItem>
          <NavigationMenuLink asChild>
            <Link
              href="/dashboard/create"
              onMouseEnter={() => setHoveredItem("products")}
              className="relative inline-flex h-9 items-center justify-center px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {hoveredItem === "products" && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 -z-10 rounded-md bg-muted"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              {t("products")}
            </Link>
          </NavigationMenuLink>
        </NavigationMenuItem>

        {/* 普通导航链接 */}
        {mainNavItems.map((item) => {
          const active = isActive(item.href);
          return (
            <NavigationMenuItem key={item.href}>
              <NavigationMenuLink asChild>
                <Link
                  href={item.href}
                  onClick={(e) => handleClick(e, item.href)}
                  onMouseEnter={() => setHoveredItem(item.href)}
                  className={cn(
                    "relative inline-flex h-9 items-center justify-center px-4 py-2 text-sm font-medium transition-colors",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {hoveredItem === item.href && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 -z-10 rounded-md bg-muted"
                      transition={{
                        type: "spring",
                        bounce: 0.2,
                        duration: 0.6,
                      }}
                    />
                  )}
                  {active && !hoveredItem && (
                    <motion.span className="absolute inset-0 -z-10 rounded-md bg-muted/50" />
                  )}
                  {navTitleMap[item.title] || item.title}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          );
        })}
      </NavigationMenuList>
    </NavigationMenu>
  );
}
