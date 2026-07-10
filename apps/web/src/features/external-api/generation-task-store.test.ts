/**
 * 普通 generation 任务 PostgreSQL 租约存储契约测试。
 *
 * 通过 Drizzle 适配层 mock 保持 DB-free，锁定 image/video 的 SKIP LOCKED 领取、过期
 * running 接管、fencing 终态和耗尽后仅对账语义；不测试数据库驱动本身。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => {
  const state = {
    executeRows: [] as Array<Record<string, unknown>>,
    returningRows: [] as Array<Record<string, unknown>>,
    lastSet: undefined as Record<string, unknown> | undefined,
    lastWhere: undefined as unknown,
  };
  const returning = vi.fn(async () => state.returningRows);
  const where = vi.fn((condition: unknown) => {
    state.lastWhere = condition;
    return { returning };
  });
  const set = vi.fn((values: Record<string, unknown>) => {
    state.lastSet = values;
    return { where };
  });
  const update = vi.fn(() => ({ set }));
  const execute = vi.fn(async (_query: unknown) => state.executeRows);
  const transaction = vi.fn(
    async (
      run: (tx: { execute: typeof execute; update: typeof update }) => unknown
    ) => await run({ execute, update })
  );
  return {
    state,
    returning,
    where,
    set,
    update,
    execute,
    transaction,
  };
});

const drizzleMocks = vi.hoisted(() => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({
    op: "inArray",
    left,
    right,
  })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: Array.from(strings).join("?"),
    values,
  })),
}));

vi.mock("@repo/database", () => ({
  db: {
    transaction: databaseMocks.transaction,
    update: databaseMocks.update,
  },
  externalAsyncTask: {
    id: "id",
    taskType: "taskType",
    status: "status",
    attemptCount: "attemptCount",
    maxAttempts: "maxAttempts",
    availableAt: "availableAt",
    leaseOwner: "leaseOwner",
    leaseToken: "leaseToken",
    leaseExpiresAt: "leaseExpiresAt",
    heartbeatAt: "heartbeatAt",
    callbackUrl: "callbackUrl",
    startedAt: "startedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: drizzleMocks.and,
  eq: drizzleMocks.eq,
  inArray: drizzleMocks.inArray,
  sql: drizzleMocks.sql,
}));

import {
  claimExhaustedGenerationTask,
  claimGenerationTask,
  deferExhaustedGenerationTask,
  deferGenerationTask,
  finalizeGenerationTask,
  heartbeatGenerationTask,
  releaseUnstartedGenerationTask,
} from "./external-async-task-store";

beforeEach(() => {
  databaseMocks.state.executeRows = [];
  databaseMocks.state.returningRows = [];
  databaseMocks.state.lastSet = undefined;
  databaseMocks.state.lastWhere = undefined;
  databaseMocks.returning.mockClear();
  databaseMocks.where.mockClear();
  databaseMocks.set.mockClear();
  databaseMocks.update.mockClear();
  databaseMocks.execute.mockClear();
  databaseMocks.transaction.mockClear();
  drizzleMocks.eq.mockClear();
  drizzleMocks.inArray.mockClear();
  drizzleMocks.and.mockClear();
  drizzleMocks.sql.mockClear();
});

describe("generation task lease store", () => {
  it("领取 image/video queued 或过期 running 并写入新 fencing token", async () => {
    const row = { id: "task-1", status: "running", taskType: "image" };
    databaseMocks.state.executeRows = [{ id: row.id }];
    databaseMocks.state.returningRows = [row];

    const claimed = await claimGenerationTask();

    expect(claimed).toMatchObject({ row });
    expect(claimed?.leaseToken).toEqual(expect.any(String));
    const selection = databaseMocks.execute.mock.calls[0]?.[0] as
      | { text?: string; values?: unknown[] }
      | undefined;
    expect(selection?.text).toContain("\"task_type\" IN ('image', 'video')");
    expect(selection?.text).toContain('"lease_expires_at" <= now()');
    expect(selection?.text).toContain('"lease_expires_at" IS NULL');
    expect(selection?.values).toContain(20 * 60 * 1000);
    expect(selection?.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(databaseMocks.state.lastSet).toMatchObject({
      status: "running",
      leaseToken: claimed?.leaseToken,
    });
  });

  it("续租、重排与终态都限定 image/video 和当前 fencing token", async () => {
    databaseMocks.state.returningRows = [{ id: "task-1" }];

    await expect(
      heartbeatGenerationTask("task-1", "lease-token-1")
    ).resolves.toBe(true);
    await expect(
      releaseUnstartedGenerationTask("task-1", "lease-token-1", 250)
    ).resolves.toBe(true);
    await expect(
      finalizeGenerationTask({
        id: "task-1",
        leaseToken: "lease-token-1",
        objectType: "image",
        resultPayload: { generationIds: ["gen-1"] },
      })
    ).resolves.toBe(true);

    expect(drizzleMocks.inArray).toHaveBeenCalledWith("taskType", [
      "image",
      "video",
    ]);
    expect(drizzleMocks.eq).toHaveBeenCalledWith("leaseToken", "lease-token-1");
    expect(databaseMocks.state.lastSet).toMatchObject({
      objectType: "image",
      status: "completed",
      resultPayload: { generationIds: ["gen-1"] },
      leaseToken: null,
    });

    databaseMocks.state.returningRows = [];
    await expect(
      finalizeGenerationTask({
        id: "task-1",
        leaseToken: "stale-token",
        objectType: "image",
        errorPayload: { error: { message: "late" } },
      })
    ).resolves.toBe(false);
  });

  it("未执行释放回退计数，实际执行后延后保留计数", async () => {
    databaseMocks.state.returningRows = [{ id: "task-1" }];

    await expect(
      releaseUnstartedGenerationTask("task-1", "lease-token-1", 250)
    ).resolves.toBe(true);
    expect(databaseMocks.state.lastSet).toHaveProperty("attemptCount");

    await expect(
      deferGenerationTask("task-1", "lease-token-2", 500)
    ).resolves.toBe(true);
    expect(databaseMocks.state.lastSet).not.toHaveProperty("attemptCount");
    expect(drizzleMocks.eq).toHaveBeenCalledWith("leaseToken", "lease-token-2");
  });

  it("耗尽任务只领取给对账 adapter，不直接发布失败终态", async () => {
    const exhausted = { id: "task-1", taskType: "video", status: "running" };
    databaseMocks.state.executeRows = [{ id: exhausted.id }];
    databaseMocks.state.returningRows = [exhausted];

    const claimed = await claimExhaustedGenerationTask();

    expect(claimed).toMatchObject({ row: exhausted });
    expect(claimed?.leaseToken).toEqual(expect.any(String));
    const selection = databaseMocks.execute.mock.calls[0]?.[0] as
      | { text?: string; values?: unknown[] }
      | undefined;
    expect(selection?.text).toContain('"attempt_count" >= "max_attempts"');
    expect(selection?.text).toContain('"lease_expires_at" IS NULL');
    expect(selection?.values).toContain(20 * 60 * 1000);
    expect(selection?.text).toContain("LIMIT 1");
    expect(databaseMocks.state.lastSet).toMatchObject({
      status: "running",
      leaseToken: claimed?.leaseToken,
    });
    expect(databaseMocks.state.lastSet).not.toHaveProperty("resultPayload");
    expect(databaseMocks.state.lastSet).not.toHaveProperty("errorPayload");
    expect(databaseMocks.state.lastSet).not.toHaveProperty("callbackStatus");
  });

  it("耗尽任务延后对账时保留 attemptCount 并限定当前 token", async () => {
    databaseMocks.state.returningRows = [{ id: "task-1" }];

    await expect(
      deferExhaustedGenerationTask("task-1", "lease-token-1", 2_500)
    ).resolves.toBe(true);

    expect(databaseMocks.state.lastSet).toMatchObject({
      status: "queued",
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    expect(databaseMocks.state.lastSet).not.toHaveProperty("attemptCount");
    expect(drizzleMocks.eq).toHaveBeenCalledWith("leaseToken", "lease-token-1");
  });
});
