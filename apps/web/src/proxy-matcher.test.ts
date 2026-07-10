/**
 * Next Proxy matcher 的大正文旁路测试。
 *
 * 使用 Next 官方 matcher 测试工具锁定外部 v1、兼容 multipart 路由不进入正文克隆层，
 * 同时确保普通 API、页面和小型直传授权仍经过现有 Proxy 安全逻辑。
 */

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({ default: vi.fn(() => vi.fn()) }));
vi.mock("@repo/shared/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  createRateLimitResponse: vi.fn(),
  getClientIp: vi.fn(),
  getRateLimitHeaders: vi.fn(),
}));
vi.mock("@/i18n/routing", () => ({
  routing: { defaultLocale: "en", locales: ["en", "zh"] },
}));

import { config } from "./proxy";

/** 判断给定路径是否会进入 Proxy。 */
function matchesProxy(pathname: string): boolean {
  return unstable_doesMiddlewareMatch({
    config,
    nextConfig: {},
    url: `https://example.com${pathname}`,
  });
}

describe("proxy matcher", () => {
  it.each([
    "/v1/images/edits",
    "/api/v1/images/edits",
    "/api/images/chat",
    "/api/images/edit",
    "/api/editable-file/generate",
  ])("大正文路径 %s 不进入 Proxy 克隆", (pathname) => {
    expect(matchesProxy(pathname)).toBe(false);
  });

  it.each([
    "/api/upload/presigned",
    "/api/images/generate",
    "/api/session/current",
    "/en/dashboard",
  ])("普通路径 %s 继续进入 Proxy", (pathname) => {
    expect(matchesProxy(pathname)).toBe(true);
  });
});
