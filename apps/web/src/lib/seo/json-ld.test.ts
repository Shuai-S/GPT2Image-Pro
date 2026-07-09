/**
 * JSON-LD 运行时站点地址测试。
 *
 * 确认结构化数据显式使用部署 URL，不回退到构建期 siteConfig 常量。
 */
import { describe, expect, it } from "vitest";
import {
  generateArticleSchema,
  generateBreadcrumbSchema,
  generateWebSiteSchema,
} from "./json-ld";

const RUNTIME_SITE_URL = "https://tenant.example";

describe("JSON-LD runtime site URL", () => {
  it("uses the runtime URL for site and search schemas", () => {
    const schema = generateWebSiteSchema("en", undefined, RUNTIME_SITE_URL);

    expect(schema.url).toBe(RUNTIME_SITE_URL);
    expect(schema.potentialAction.target.urlTemplate).toBe(
      `${RUNTIME_SITE_URL}/{locale}/blog?q={search_term_string}`
    );
  });

  it("resolves relative breadcrumb URLs against the runtime site", () => {
    const schema = generateBreadcrumbSchema(
      [{ name: "Blog", url: "/en/blog" }],
      RUNTIME_SITE_URL
    );

    expect(schema.itemListElement[0]?.item).toBe(`${RUNTIME_SITE_URL}/en/blog`);
  });

  it("uses the runtime URL for article and publisher resources", () => {
    const schema = generateArticleSchema({
      title: "Runtime metadata",
      description: "Runtime metadata test",
      slug: "runtime-metadata",
      locale: "en",
      publishedAt: "2026-07-10T00:00:00.000Z",
      baseUrl: RUNTIME_SITE_URL,
      branding: {
        name: "Tenant",
        description: "Tenant description",
        logoUrl: "/logo.png",
      },
    });

    expect(schema.url).toBe(`${RUNTIME_SITE_URL}/en/blog/runtime-metadata`);
    expect(schema.publisher.logo.url).toBe(`${RUNTIME_SITE_URL}/logo.png`);
  });
});
