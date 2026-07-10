/**
 * 外部异步任务终态保留纯策略测试。
 *
 * 覆盖设置安全默认、硬上限、截止时间，以及任务/callback/完成时间联合资格；不访问
 * 数据库、对象存储或运行时设置。
 */

import { describe, expect, it } from "vitest";

import {
  createExternalAsyncTaskRetentionCutoff,
  DEFAULT_EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE,
  DEFAULT_EXTERNAL_ASYNC_TASK_RETENTION_DAYS,
  isExternalAsyncTaskRetentionEligible,
  MAX_EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE,
  MAX_EXTERNAL_ASYNC_TASK_RETENTION_DAYS,
  normalizeExternalAsyncTaskRetentionConfig,
} from "./external-async-task-retention-core";

describe("external async task retention policy", () => {
  it("对无效设置使用安全默认并对超大值施加硬上限", () => {
    expect(
      normalizeExternalAsyncTaskRetentionConfig({
        retentionDays: Number.NaN,
        batchSize: 0,
      })
    ).toEqual({
      retentionDays: DEFAULT_EXTERNAL_ASYNC_TASK_RETENTION_DAYS,
      batchSize: DEFAULT_EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE,
    });
    expect(
      normalizeExternalAsyncTaskRetentionConfig({
        retentionDays: 100_000,
        batchSize: 100_000,
      })
    ).toEqual({
      retentionDays: MAX_EXTERNAL_ASYNC_TASK_RETENTION_DAYS,
      batchSize: MAX_EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE,
    });
  });

  it("使用稳定当前时间计算整天截止点并拒绝越界输入", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    expect(createExternalAsyncTaskRetentionCutoff(now, 30).toISOString()).toBe(
      "2026-06-10T12:00:00.000Z"
    );
    expect(() => createExternalAsyncTaskRetentionCutoff(now, 0)).toThrow(
      RangeError
    );
  });

  it("仅接受到期终态且 callback 已结束的任务", () => {
    const cutoff = new Date("2026-06-10T12:00:00.000Z");
    const eligible = {
      status: "completed",
      callbackStatus: "sent",
      completedAt: new Date(cutoff),
      cutoff,
    };
    expect(isExternalAsyncTaskRetentionEligible(eligible)).toBe(true);
    expect(
      isExternalAsyncTaskRetentionEligible({
        ...eligible,
        status: "queued",
      })
    ).toBe(false);
    expect(
      isExternalAsyncTaskRetentionEligible({
        ...eligible,
        status: "running",
      })
    ).toBe(false);
    for (const callbackStatus of ["waiting", "sending", "retry"]) {
      expect(
        isExternalAsyncTaskRetentionEligible({
          ...eligible,
          callbackStatus,
        })
      ).toBe(false);
    }
    expect(
      isExternalAsyncTaskRetentionEligible({
        ...eligible,
        completedAt: null,
      })
    ).toBe(false);
    expect(
      isExternalAsyncTaskRetentionEligible({
        ...eligible,
        completedAt: new Date("2026-06-10T12:00:00.001Z"),
      })
    ).toBe(false);
  });
});
