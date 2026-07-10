/**
 * 大正文 API 路由内限流测试。
 *
 * mock shared 限流器，验证 IP/桶透传、放行和标准阻断响应；不访问 Redis。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const rateLimitMocks = vi.hoisted(() => ({
  check: vi.fn(),
  getClientIp: vi.fn(),
  createResponse: vi.fn(),
}));

vi.mock("@repo/shared/rate-limit", () => ({
  checkRateLimit: rateLimitMocks.check,
  getClientIp: rateLimitMocks.getClientIp,
  createRateLimitResponse: rateLimitMocks.createResponse,
}));

import { enforceApiRouteRateLimit } from "./api-route-rate-limit";

beforeEach(() => {
  rateLimitMocks.check.mockReset();
  rateLimitMocks.getClientIp.mockReset().mockReturnValue("203.0.113.10");
  rateLimitMocks.createResponse.mockReset();
});

describe("enforceApiRouteRateLimit", () => {
  it("成功时返回 null 并复用 ai 桶", async () => {
    rateLimitMocks.check.mockResolvedValue({ success: true });
    const request = new NextRequest("https://example.com/api/images/edit");

    await expect(enforceApiRouteRateLimit(request, "ai")).resolves.toBeNull();
    expect(rateLimitMocks.check).toHaveBeenCalledWith("203.0.113.10", "ai");
  });

  it("超限时返回 shared 构造的标准响应", async () => {
    const result = { success: false, limit: 20, remaining: 0, reset: 123 };
    const blocked = NextResponse.json({ error: "rate limited" }, { status: 429 });
    rateLimitMocks.check.mockResolvedValue(result);
    rateLimitMocks.createResponse.mockReturnValue(blocked);

    await expect(
      enforceApiRouteRateLimit(
        new NextRequest("https://example.com/api/images/chat"),
        "ai"
      )
    ).resolves.toBe(blocked);
    expect(rateLimitMocks.createResponse).toHaveBeenCalledWith(result);
  });
});
