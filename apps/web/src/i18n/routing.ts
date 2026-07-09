import { createNavigation } from "next-intl/navigation";
import { defineRouting } from "next-intl/routing";

/**
 * 国际化路由配置
 *
 * 定义支持的语言和默认语言
 */
export const routing = defineRouting({
  // 支持的语言列表
  locales: ["en", "zh"],
  // 默认语言
  defaultLocale: "en",
  // 所有公开 URL 都显式携带语言前缀，无需再写 NEXT_LOCALE Cookie。
  // 关闭 Cookie 与请求头探测后，同一 URL 可被 CDN 在匿名用户之间安全复用。
  localeCookie: false,
  localeDetection: false,
});

/**
 * 导出国际化导航组件和钩子
 *
 * 使用这些替代 next/link 和 next/navigation
 * 以确保正确处理语言前缀
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
