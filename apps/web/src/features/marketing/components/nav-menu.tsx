"use client";

import { mainNav, productsNav } from "@repo/shared/config";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@repo/ui/components/navigation-menu";
import { cn } from "@repo/ui/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/routing";

/**
 * 营销页桌面导航菜单。
 *
 * 使用方: Header 顶部导航。关键依赖: next-intl 文案、共享导航配置、
 * Framer Motion 悬浮动画，以及 @repo/ui 的 NavigationMenu 基础结构。
 */

/**
 * Products 下拉菜单翻译映射 key
 * 用 i18n key 映射标题和描述
 */
const productsTitleMap: Record<string, string> = {
  "Core features": "productsMenu.core.title",
  Platform: "productsMenu.platform.title",
  "Chat to Image": "productsMenu.core.chatToImage",
  Gallery: "productsMenu.core.gallery",
  "Batch Generation": "productsMenu.core.batch",
  "GPT Image 2": "productsMenu.platform.api",
  "Multi-model Support": "productsMenu.platform.multiModel",
  "Credits System": "productsMenu.platform.credits",
};

const productsDescMap: Record<string, string> = {
  "Chat to Image": "productsMenu.core.chatToImageDesc",
  Gallery: "productsMenu.core.galleryDesc",
  "Batch Generation": "productsMenu.core.batchDesc",
  "GPT Image 2": "productsMenu.platform.apiDesc",
  "Multi-model Support": "productsMenu.platform.multiModelDesc",
  "Credits System": "productsMenu.platform.creditsDesc",
};

const PRODUCTS_MENU_MAX_WIDTH = 640;
const PRODUCTS_MENU_VIEWPORT_GUTTER = 24;

interface ProductsMenuPosition {
  left: number;
  top: number;
  width: number;
}

/**
 * 导航菜单组件
 *
 * 包含 Products 下拉菜单和普通导航链接
 */
export function NavMenu() {
  const pathname = usePathname();
  const t = useTranslations("Navigation");
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [productsOpen, setProductsOpen] = useState(false);
  const [productsMenuPosition, setProductsMenuPosition] =
    useState<ProductsMenuPosition | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productsTriggerRef = useRef<HTMLButtonElement | null>(null);

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
   * 按触发按钮中心定位下拉层，并用视口边距兜底。
   *
   * 返回: 无。副作用: 更新固定定位坐标。失败模式: 触发按钮尚未挂载时跳过，
   * 下次 hover/open 或 resize 会重新计算。
   */
  const updateProductsMenuPosition = useCallback(() => {
    const triggerElement = productsTriggerRef.current;
    if (!triggerElement) {
      return;
    }

    const triggerRect = triggerElement.getBoundingClientRect();
    const availableWidth = Math.max(
      0,
      window.innerWidth - PRODUCTS_MENU_VIEWPORT_GUTTER * 2
    );
    const menuWidth = Math.min(PRODUCTS_MENU_MAX_WIDTH, availableWidth);
    const centeredLeft =
      triggerRect.left + triggerRect.width / 2 - menuWidth / 2;
    const maxLeft = Math.max(
      PRODUCTS_MENU_VIEWPORT_GUTTER,
      window.innerWidth - menuWidth - PRODUCTS_MENU_VIEWPORT_GUTTER
    );

    setProductsMenuPosition({
      left: Math.min(
        Math.max(centeredLeft, PRODUCTS_MENU_VIEWPORT_GUTTER),
        maxLeft
      ),
      top: triggerRect.bottom,
      width: menuWidth,
    });
  }, []);

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

  const handleProductsEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    updateProductsMenuPosition();
    setProductsOpen(true);
  };

  const handleProductsLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setProductsOpen(false);
    }, 150);
  };

  useEffect(() => {
    if (!productsOpen) {
      return;
    }

    updateProductsMenuPosition();
    window.addEventListener("resize", updateProductsMenuPosition);
    window.addEventListener("scroll", updateProductsMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateProductsMenuPosition);
      window.removeEventListener("scroll", updateProductsMenuPosition, true);
    };
  }, [productsOpen, updateProductsMenuPosition]);

  return (
    <NavigationMenu viewport={false} onMouseLeave={() => setHoveredItem(null)}>
      <NavigationMenuList className="gap-0">
        {/* Products 下拉菜单 */}
        <NavigationMenuItem
          className="relative"
          onMouseEnter={handleProductsEnter}
          onMouseLeave={handleProductsLeave}
        >
          <button
            type="button"
            ref={productsTriggerRef}
            className={cn(
              "relative inline-flex h-9 items-center justify-center gap-1 px-4 py-2 text-sm font-medium transition-colors",
              productsOpen
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onMouseEnter={() => setHoveredItem("products")}
          >
            {hoveredItem === "products" && (
              <motion.span
                layoutId="nav-pill"
                className="absolute inset-0 -z-10 rounded-md bg-muted"
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              />
            )}
            {t("products")}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-200",
                productsOpen && "rotate-180"
              )}
            />
          </button>

          {/* Dropdown panel */}
          <AnimatePresence>
            {productsOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15 }}
                className="fixed z-50 pt-2"
                style={{
                  left: productsMenuPosition?.left ?? 0,
                  top: productsMenuPosition?.top ?? 0,
                  visibility: productsMenuPosition ? "visible" : "hidden",
                  width: productsMenuPosition?.width ?? PRODUCTS_MENU_MAX_WIDTH,
                }}
                onMouseEnter={handleProductsEnter}
                onMouseLeave={handleProductsLeave}
              >
                <div className="w-full rounded-xl border bg-popover p-4 shadow-lg">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {productsNav.map((group) => (
                      <div key={group.title}>
                        <h4 className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {t(productsTitleMap[group.title] || group.title)}
                        </h4>
                        <div className="space-y-1">
                          {group.items.map((item) => {
                            const Icon = item.icon;
                            return (
                              <Link
                                key={item.title}
                                href={item.href}
                                onClick={() => setProductsOpen(false)}
                                className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted"
                              >
                                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                                <div>
                                  <div className="text-sm font-medium">
                                    {t(
                                      productsTitleMap[item.title] || item.title
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {t(
                                      productsDescMap[item.title] || item.title
                                    )}
                                  </div>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </NavigationMenuItem>

        {/* 普通导航链接 */}
        {mainNav.map((item) => {
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
