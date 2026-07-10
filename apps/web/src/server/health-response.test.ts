/**
 * 健康检查响应契约测试。
 *
 * 覆盖 liveness/readiness 状态码、稳定正文与 no-store，避免负载均衡器误把数据库
 * 故障当作可接流量状态，或被 CDN 缓存旧健康结果。
 */

import { describe, expect, it } from "vitest";
import {
  buildLivenessResponse,
  buildReadinessResponse,
} from "./health-response";

describe("health responses", () => {
  it("liveness 在进程可响应时返回 200", async () => {
    const response = buildLivenessResponse();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      checks: { process: "up" },
    });
  });

  it("readiness 在数据库可用时返回 200", async () => {
    const response = buildReadinessResponse(true);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      checks: { database: "up" },
    });
  });

  it("readiness 在数据库故障时返回 503 且不泄露错误", async () => {
    const response = buildReadinessResponse(false);

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "unavailable",
      checks: { database: "down" },
    });
  });
});
