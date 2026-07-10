/**
 * Prometheus 运维指标路由测试。
 *
 * mock 数据库快照读取器以保持 DB-free，覆盖关闭、错误密钥、成功抓取与数据库故障；
 * 重点验证鉴权失败时绝不触发数据库查询。
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const metricsMocks = vi.hoisted(() => ({
  read: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@repo/shared/logger", () => ({ logError: metricsMocks.logError }));

vi.mock("@/server/operational-metrics", () => ({
  readOperationalMetrics: metricsMocks.read,
}));

import { GET } from "./route";

const originalToken = process.env.OBSERVABILITY_METRICS_TOKEN;

/** 构造携带可选 Bearer 密钥的抓取请求。 */
function metricsRequest(token?: string): Request {
  return new Request("https://example.com/api/metrics", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

beforeEach(() => {
  metricsMocks.read.mockReset();
  metricsMocks.logError.mockReset();
  process.env.OBSERVABILITY_METRICS_TOKEN = "metrics-secret";
});

afterAll(() => {
  if (originalToken === undefined) {
    delete process.env.OBSERVABILITY_METRICS_TOKEN;
  } else {
    process.env.OBSERVABILITY_METRICS_TOKEN = originalToken;
  }
});

describe("GET /api/metrics", () => {
  it("未配置密钥时隐藏端点且不查询数据库", async () => {
    delete process.env.OBSERVABILITY_METRICS_TOKEN;

    const response = await GET(metricsRequest("metrics-secret"));

    expect(response.status).toBe(404);
    expect(metricsMocks.read).not.toHaveBeenCalled();
  });

  it("错误密钥返回 401 且不查询数据库", async () => {
    const response = await GET(metricsRequest("wrong-secret"));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(metricsMocks.read).not.toHaveBeenCalled();
  });

  it("正确密钥返回禁缓存的 Prometheus 文本", async () => {
    metricsMocks.read.mockResolvedValue([
      { metric: "job_status", status: "running", value: 1 },
    ]);

    const response = await GET(metricsRequest("metrics-secret"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toContain(
      'gpt2image_internal_job_leases{status="running"} 1'
    );
    expect(metricsMocks.read).toHaveBeenCalledOnce();
  });

  it("数据库故障返回 503 且不泄露错误", async () => {
    metricsMocks.read.mockRejectedValue(
      new Error("postgresql://secret@db/internal query failed")
    );

    const response = await GET(metricsRequest("metrics-secret"));

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("Metrics unavailable");
    expect(metricsMocks.logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Operational metrics query failed" }),
      { source: "operational-metrics", causeType: "Error" }
    );
    expect(JSON.stringify(metricsMocks.logError.mock.calls)).not.toContain(
      "postgresql://secret"
    );
  });
});
