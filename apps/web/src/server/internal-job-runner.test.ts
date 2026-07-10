/**
 * 内部任务目录注册测试。
 *
 * 锁定 external_async_task retention 只能经既有 UOL operation 和数据库租约调度，
 * 防止后续改动把业务逻辑直接塞进定时器。
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingNumber: vi.fn(),
}));
vi.mock("@repo/shared/uol", () => ({ invokeOperation: vi.fn() }));
vi.mock("./internal-job-lease", () => ({
  executeInternalJobWithLease: vi.fn(),
}));
vi.mock("./uol-init", () => ({ ensureUolInitialized: vi.fn() }));

import { INTERNAL_JOBS } from "./internal-job-runner";

describe("INTERNAL_JOBS", () => {
  it("通过 UOL 和统一租约注册异步任务终态清理", () => {
    expect(
      INTERNAL_JOBS.find((job) => job.name === "external-async-task-retention")
    ).toEqual({
      name: "external-async-task-retention",
      operationName: "externalApi.runAsyncTaskRetention",
      intervalSettingKey:
        "INTERNAL_JOB_EXTERNAL_ASYNC_TASK_RETENTION_INTERVAL_MINUTES",
      defaultIntervalMinutes: 1440,
      initialDelayMs: 180_000,
    });
  });
});
