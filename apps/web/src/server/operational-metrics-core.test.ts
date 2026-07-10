/**
 * 运维指标核心契约测试。
 *
 * 覆盖端点关闭、Bearer 鉴权、固定指标编码与标签转义，保持 DB-free，避免测试依赖
 * PostgreSQL。数据库聚合 SQL 由迁移 CI 的真实 PostgreSQL schema smoke 覆盖。
 */

import { describe, expect, it } from "vitest";
import {
  authorizeOperationalMetricsRequest,
  encodeOperationalMetrics,
} from "./operational-metrics-core";

describe("operational metrics authorization", () => {
  it("密钥未配置时关闭端点", () => {
    const request = new Request("https://example.com/api/metrics", {
      headers: { Authorization: "Bearer supplied" },
    });

    expect(authorizeOperationalMetricsRequest(request, undefined)).toBe(
      "disabled"
    );
  });

  it("拒绝缺失或错误 Bearer 密钥", () => {
    const missing = new Request("https://example.com/api/metrics");
    const wrong = new Request("https://example.com/api/metrics", {
      headers: { Authorization: "Bearer wrong" },
    });

    expect(authorizeOperationalMetricsRequest(missing, "secret")).toBe(
      "unauthorized"
    );
    expect(authorizeOperationalMetricsRequest(wrong, "secret")).toBe(
      "unauthorized"
    );
  });

  it("接受大小写不敏感且空白合法的 Bearer 密钥", () => {
    const request = new Request("https://example.com/api/metrics", {
      headers: { Authorization: "bearer   secret-value  " },
    });

    expect(authorizeOperationalMetricsRequest(request, "secret-value")).toBe(
      "authorized"
    );
  });
});

describe("operational metrics encoding", () => {
  it("输出固定 HELP/TYPE、状态标签与非负计数", () => {
    const body = encodeOperationalMetrics([
      { metric: "job_status", status: "running", value: 2 },
      { metric: "job_expired", value: 1 },
      {
        metric: "task_status",
        taskType: "editable_file",
        status: "queued",
        value: 3,
      },
      { metric: "task_lease_expired", value: 0 },
      { metric: "callback_status", status: "retry", value: 4 },
      { metric: "callback_lease_expired", value: 1 },
      {
        metric: "slot_state",
        scope: "global",
        state: "leased",
        value: 5,
      },
    ]);

    expect(body).toContain("# TYPE gpt2image_internal_job_leases gauge");
    expect(body).toContain('gpt2image_internal_job_leases{status="running"} 2');
    expect(body).toContain("gpt2image_internal_job_expired_leases 1");
    expect(body).toContain(
      'gpt2image_external_async_tasks{task_type="editable_file",status="queued"} 3'
    );
    expect(body).toContain(
      'gpt2image_external_async_callbacks{status="retry"} 4'
    );
    expect(body).toContain(
      'gpt2image_image_generation_concurrency_slots{scope="global",state="leased"} 5'
    );
    expect(body.endsWith("\n")).toBe(true);
  });
});
