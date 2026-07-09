/**
 * 运行时站点地址解析测试。
 *
 * 覆盖通用镜像的部署地址优先级、规范化与不可信 URL 拒绝逻辑。
 */
import { describe, expect, it } from "vitest";
import { resolveRuntimeSiteUrl } from "./site-runtime";

describe("resolveRuntimeSiteUrl", () => {
  it("prefers and normalizes the runtime configured URL", () => {
    expect(
      resolveRuntimeSiteUrl({
        configuredUrl: " https://tenant.example/app/?preview=1#top ",
        authUrl: "https://auth.example",
        fallbackUrl: "https://fallback.example",
      })
    ).toBe("https://tenant.example/app");
  });

  it("falls back to the runtime auth URL when configuration is unsafe", () => {
    expect(
      resolveRuntimeSiteUrl({
        configuredUrl: "javascript:alert(1)",
        environmentUrl: "file:///tmp/app",
        authUrl: "https://runtime.example/",
        fallbackUrl: "https://fallback.example",
      })
    ).toBe("https://runtime.example");
  });

  it("rejects credentials embedded in a public URL", () => {
    expect(
      resolveRuntimeSiteUrl({
        configuredUrl: "https://user:secret@example.com",
        authUrl: "not-a-url",
        fallbackUrl: "https://fallback.example/",
      })
    ).toBe("https://fallback.example");
  });
});
