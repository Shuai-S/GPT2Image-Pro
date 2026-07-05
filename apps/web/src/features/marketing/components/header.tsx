"use client";

import { ModeToggle } from "@repo/shared/components";
import type { BrandingConfig } from "@repo/shared/config/branding";
import { mainNav } from "@repo/shared/config/nav";
import type { OperationFeatureFlags } from "@repo/shared/system-settings";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@repo/ui/components/avatar";
import { Button } from "@repo/ui/components/button";
import { Sheet, SheetContent, SheetTitle } from "@repo/ui/components/sheet";
import { Menu } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useCurrentSession } from "@/features/auth/hooks/use-current-session";
import { Link } from "@/i18n/routing";

import { NavMenu } from "./nav-menu";

interface HeaderProps {
  branding: BrandingConfig;
  operationFlags: OperationFeatureFlags;
}

/**
 * Marketing 页面顶部导航栏
 *
 * @param branding - 管理员配置的应用名称与 Logo。
 * @returns 顶部导航栏。
 * @sideEffects 读取当前会话 hook，用于显示登录态入口。
 *
 * 布局: [Logo + Nav 靠左] -------- [Actions 靠右]
 */
export function Header({ branding, operationFlags }: HeaderProps) {
  // 获取当前用户会话状态
  const { data: session, isPending } = useCurrentSession();
  const user = session?.user;
  const t = useTranslations("Header");
  const tNav = useTranslations("Navigation");
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleMainNav = mainNav.filter(
    (item) => item.href !== "/blog" || operationFlags.blog
  );

  /**
   * 获取用户名首字母作为头像回退
   */
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  /**
   * 导航项标题翻译映射
   */
  const navTitleMap: Record<string, string> = {
    Features: tNav("features"),
    Docs: tNav("docs"),
    Pricing: tNav("pricing"),
    Blog: tNav("blog"),
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        {/* 左侧 - Logo + 导航菜单 */}
        <div className="flex items-center gap-8">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Image
              src={branding.logoUrl}
              alt={branding.name}
              width={28}
              height={28}
              className="h-7 w-7 shrink-0 object-contain"
              unoptimized
            />
            <span className="font-serif text-xl font-medium tracking-tight">
              {branding.name}
            </span>
          </Link>

          {/* 导航菜单 (桌面端) */}
          <div className="hidden md:flex">
            <NavMenu mainNavItems={visibleMainNav} />
          </div>
        </div>

        {/* 右侧 - 操作区域 */}
        <div className="flex items-center gap-2">
          {/* 语言切换 */}
          <LanguageSwitcher />

          {/* 主题切换 */}
          <ModeToggle />

          {isPending ? (
            // 加载状态 - 显示骨架
            <div className="hidden h-9 w-24 animate-pulse rounded-md bg-muted md:block" />
          ) : user ? (
            // 已登录 - 显示 Dashboard 按钮和头像
            <>
              <Button
                asChild
                variant="ghost"
                className="hidden text-muted-foreground md:inline-flex"
              >
                <Link href="/dashboard">{t("dashboard")}</Link>
              </Button>
              <Link href="/dashboard" className="hidden md:block">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.image || undefined} alt={user.name} />
                  <AvatarFallback className="bg-foreground text-xs text-background">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
              </Link>
            </>
          ) : (
            // 未登录 - 显示登录和注册按钮（桌面端）
            <>
              <Button
                asChild
                variant="ghost"
                className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
              >
                <Link href="/sign-in">{t("login")}</Link>
              </Button>
              <Button asChild className="hidden md:inline-flex">
                <Link href="/sign-up">{t("getStarted")}</Link>
              </Button>
            </>
          )}

          {/* 移动端汉堡按钮 */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* 移动端导航 Sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="right" className="w-72 p-0">
          <SheetTitle className="sr-only">{tNav("menu")}</SheetTitle>
          <div className="flex h-full flex-col">
            {/* 导航链接 */}
            <nav className="flex-1 overflow-y-auto px-4 pt-12">
              <div className="space-y-1">
                <Link
                  href="/dashboard/create"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
                >
                  {tNav("products")}
                </Link>
                {visibleMainNav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
                  >
                    {navTitleMap[item.title] || item.title}
                  </Link>
                ))}
              </div>
            </nav>

            {/* 底部操作按钮 */}
            <div className="border-t border-border p-4 space-y-2">
              {user ? (
                <Button asChild className="w-full">
                  <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                    {t("dashboard")}
                  </Link>
                </Button>
              ) : (
                <>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/sign-in" onClick={() => setMobileOpen(false)}>
                      {t("login")}
                    </Link>
                  </Button>
                  <Button asChild className="w-full">
                    <Link href="/sign-up" onClick={() => setMobileOpen(false)}>
                      {t("getStarted")}
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
