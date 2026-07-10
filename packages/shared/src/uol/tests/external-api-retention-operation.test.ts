/**
 * 外部异步任务终态保留 UOL 注册契约测试。
 *
 * 验证新功能先以传输无关 operation 暴露，并准确声明 cron 权限、破坏性和维护写入；
 * 不调用 Web 绑定或数据库。
 */

import { describe, expect, it } from "vitest";

import "../operations/external-api";
import { getOperation } from "../registry";

describe("externalApi.runAsyncTaskRetention", () => {
  it("注册 cron-only 的破坏性维护 operation", () => {
    const operation = getOperation("externalApi.runAsyncTaskRetention");
    expect(operation).toMatchObject({
      domain: "external-api",
      access: { kind: "cron" },
      readOnly: false,
      destructive: true,
      idempotency: { kind: "natural" },
      sideEffects: ["storage", "queue", "audit"],
      hasMaintenanceWrite: true,
    });
    expect(operation?.input.safeParse({}).success).toBe(true);
  });
});
