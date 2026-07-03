"use client";

import { CookieSettingsDialog } from "@repo/shared/components";
import type { BrandingConfig } from "@repo/shared/config/branding";
import Link from "next/link";
import { useTranslations } from "next-intl";

interface AuthFooterProps {
  branding: BrandingConfig;
}

/**
 * Auth 页面底部组件
 *
 * 包含版权信息和法律链接
 * Cookie Settings 链接会打开设置对话框
 *
 * @param branding - 管理员配置的应用名称。
 * @returns Auth 路由组底部版权与法律链接。
 * @sideEffects 打开 Cookie 设置弹窗。
 */
export function AuthFooter({ branding }: AuthFooterProps) {
  const t = useTranslations("Auth.footer");

  return (
    <footer className="border-t bg-background py-6">
      <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 sm:flex-row">
        <p className="text-sm text-muted-foreground">
          {t("copyright", {
            year: new Date().getFullYear(),
            name: branding.name,
          })}
        </p>
        <nav className="flex gap-6">
          <Link
            href="/legal/privacy"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("privacy")}
          </Link>
          <Link
            href="/legal/terms"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("terms")}
          </Link>
          <CookieSettingsDialog>
            <button
              type="button"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("cookies")}
            </button>
          </CookieSettingsDialog>
        </nav>
      </div>
    </footer>
  );
}
