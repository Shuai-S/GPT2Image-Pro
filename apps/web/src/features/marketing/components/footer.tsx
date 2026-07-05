/**
 * Marketing 页脚组件。
 *
 * 职责：渲染公开站点底部导航、品牌说明、联系入口与版权信息。
 * 使用方：marketing layout，覆盖首页、定价、博客与法律页。
 * 关键依赖：系统设置中的 CONTACT_EMAIL 控制“联系我们”邮箱。
 */

import { footerNav } from "@repo/shared/config";
import type { BrandingConfig } from "@repo/shared/config/branding";
import { getRuntimeContactEmail } from "@repo/shared/config/contact-runtime";
import Link from "next/link";
import { getLocale } from "next-intl/server";

const footerTitleMap = {
  product: {
    Pricing: "定价",
    Docs: "文档",
    "Contact Us": "联系我们",
  },
  legal: {
    "Terms of Service": "服务条款",
    "Privacy Policy": "隐私政策",
    "Cookie Policy": "Cookie 政策",
  },
} as const;

interface FooterProps {
  branding: BrandingConfig;
}

/**
 * 按当前语言返回页脚导航标题。
 *
 * @param title - 静态导航标题。
 * @param group - 页脚导航分组。
 * @param isZh - 当前语言是否为中文。
 * @returns 当前语言下的导航标题。
 * @sideEffects 无。
 */
function getFooterLinkTitle(
  title: string,
  group: keyof typeof footerTitleMap,
  isZh: boolean
) {
  if (!isZh) return title;
  return (
    footerTitleMap[group][
      title as keyof (typeof footerTitleMap)[typeof group]
    ] || title
  );
}

/**
 * 生成页脚链接地址，联系入口使用后台系统设置邮箱。
 *
 * @param link - 静态页脚导航项。
 * @param contactEmail - 已规范化的公开联系邮箱。
 * @returns 可直接交给 Next Link 的 href。
 * @sideEffects 无。
 */
function getFooterLinkHref(
  link: (typeof footerNav.product)[number],
  contactEmail: string
) {
  if (link.title !== "Contact Us") return link.href;
  return `mailto:${contactEmail}`;
}

/**
 * Marketing 页面底部
 *
 * 功能:
 * - 品牌信息 + 产品描述
 * - 产品、法律链接
 * - 版权信息
 *
 * @param branding - 管理员配置的应用名称和描述。
 * @returns Marketing 页面底部。
 * @sideEffects 读取当前 locale 和运行时系统设置中的联系邮箱。
 */
export async function Footer({ branding }: FooterProps) {
  const [locale, contactEmail] = await Promise.all([
    getLocale(),
    getRuntimeContactEmail(),
  ]);
  const isZh = locale === "zh";

  return (
    <footer className="border-t bg-background">
      <div className="container py-16">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
          {/* 品牌区 */}
          <div>
            <Link href="/" className="mb-4 inline-block">
              <span className="font-serif text-xl font-medium">
                {branding.name}
              </span>
            </Link>
            <p className="text-sm text-muted-foreground">
              {branding.description}
            </p>
          </div>

          {/* 链接区 */}
          <div className="grid grid-cols-2 gap-8">
            {/* 产品 */}
            <div>
              <h3 className="mb-4 text-sm font-semibold">
                {isZh ? "产品" : "Product"}
              </h3>
              <ul className="space-y-3">
                {footerNav.product.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={getFooterLinkHref(link, contactEmail)}
                      {...(link.external
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {getFooterLinkTitle(link.title, "product", isZh)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* 法律 */}
            <div>
              <h3 className="mb-4 text-sm font-semibold">
                {isZh ? "法律" : "Legal"}
              </h3>
              <ul className="space-y-3">
                {footerNav.legal.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {getFooterLinkTitle(link.title, "legal", isZh)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* 底部栏 */}
        <div className="mt-12 border-t pt-8">
          <p className="text-sm text-muted-foreground">
            {isZh
              ? `© ${new Date().getFullYear()} ${branding.name}。保留所有权利。`
              : `© ${new Date().getFullYear()} ${branding.name}. All rights reserved.`}
          </p>
        </div>
      </div>
    </footer>
  );
}
