import { getRuntimeSiteUrl } from "@repo/shared/config/site-runtime";
import type { MetadataRoute } from "next";

/** 公开爬虫规则与运行时域名保持最多 60 秒延迟。 */
export const revalidate = 60;

/**
 * 动态生成 robots.txt
 *
 * 允许所有搜索引擎爬虫访问
 * 指向 sitemap.xml
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const siteUrl = await getRuntimeSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard/",
          "/sign-in",
          "/sign-up",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
