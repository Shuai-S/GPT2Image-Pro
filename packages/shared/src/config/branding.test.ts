import { describe, expect, it } from "vitest";

import { normalizeBrandAssetUrl, resolveBrandingConfig } from "./branding";

/**
 * 品牌配置纯函数单测。
 *
 * 覆盖管理员输入规范化逻辑；不访问 DB，避免把 system-settings 的数据库依赖带入测试。
 */
describe("branding config", () => {
  it("accepts same-origin asset paths", () => {
    expect(normalizeBrandAssetUrl("/brand/logo.png", "/fallback.png")).toBe(
      "/brand/logo.png"
    );
  });

  it("accepts http and https URLs", () => {
    expect(
      normalizeBrandAssetUrl(
        "https://cdn.example.test/logo.png",
        "/fallback.png"
      )
    ).toBe("https://cdn.example.test/logo.png");
  });

  it("rejects protocol-relative and non-http URLs", () => {
    expect(
      normalizeBrandAssetUrl("//evil.test/logo.png", "/fallback.png")
    ).toBe("/fallback.png");
    expect(normalizeBrandAssetUrl("javascript:alert(1)", "/fallback.png")).toBe(
      "/fallback.png"
    );
  });

  it("falls back when text fields are blank", () => {
    const branding = resolveBrandingConfig({
      name: " ",
      description: "",
      logoUrl: "ftp://cdn.example.test/logo.png",
      ogImageUrl: undefined,
    });

    expect(branding.name).toBe("GPT2IMAGE");
    expect(branding.description).toContain("AI-powered");
    expect(branding.logoUrl).toBe("/assets/icon.png");
    expect(branding.ogImageUrl).toBe("/og-image.png");
  });

  it("limits text fields used by layout and metadata", () => {
    const branding = resolveBrandingConfig({
      name: "A".repeat(80),
      description: "B".repeat(260),
    });

    expect(branding.name).toHaveLength(60);
    expect(branding.description).toHaveLength(240);
  });
});
