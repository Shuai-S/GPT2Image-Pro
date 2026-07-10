/**
 * 外部异步任务终态保留 PostgreSQL 存储契约测试。
 *
 * 通过 Drizzle execute mock 锁定有界 SKIP LOCKED 读取与删除二次谓词；不测试驱动
 * 本身，也不连接数据库。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => {
  const state = { executeResults: [] as unknown[] };
  const execute = vi.fn(
    async (_query: unknown) => state.executeResults.shift() ?? []
  );
  const transaction = vi.fn(
    async (run: (tx: { execute: typeof execute }) => unknown) =>
      await run({ execute })
  );
  return { state, execute, transaction };
});

const drizzleMocks = vi.hoisted(() => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: Array.from(strings).join("?"),
    values,
  })),
}));

vi.mock("@repo/database", () => ({
  db: { transaction: databaseMocks.transaction },
  externalAsyncTask: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  sql: drizzleMocks.sql,
}));

import {
  deleteExternalAsyncTaskTerminalBatch,
  listExternalAsyncTaskTerminalRetentionCandidates,
} from "./external-async-task-store";

beforeEach(() => {
  databaseMocks.state.executeResults = [];
  databaseMocks.execute.mockClear();
  databaseMocks.transaction.mockClear();
  drizzleMocks.sql.mockClear();
});

describe("external async task retention store", () => {
  it("只读取到期终态和已结束 callback，并使用固定 LIMIT 与 SKIP LOCKED", async () => {
    databaseMocks.state.executeResults = [
      [
        {
          id: "task-1",
          taskType: "image",
          userId: "user-1",
          requestPayload: null,
        },
      ],
    ];
    const cutoff = new Date("2026-06-10T12:00:00.000Z");

    await expect(
      listExternalAsyncTaskTerminalRetentionCandidates({
        cutoff,
        batchSize: 50,
      })
    ).resolves.toHaveLength(1);

    const query = databaseMocks.execute.mock.calls[0]?.[0] as
      | { text?: string; values?: unknown[] }
      | undefined;
    expect(query?.text).toContain("\"status\" IN ('completed', 'failed')");
    expect(query?.text).toContain(
      "\"callback_status\" IN ('none', 'sent', 'permanent_failed')"
    );
    expect(query?.text).not.toContain("'waiting'");
    expect(query?.text).not.toContain("'sending'");
    expect(query?.text).not.toContain("'retry'");
    expect(query?.text).toContain('"completed_at" <= ?');
    expect(query?.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(query?.text).toContain("LIMIT ?");
    expect(query?.values).toEqual([cutoff, 50]);
  });

  it("删除前重新锁定并在 DELETE 重复全部资格谓词", async () => {
    databaseMocks.state.executeResults = [
      [{ id: "task-1" }, { id: "task-2" }],
      [{ id: "task-1" }, { id: "task-2" }],
    ];
    const cutoff = new Date("2026-06-10T12:00:00.000Z");

    await expect(
      deleteExternalAsyncTaskTerminalBatch({
        candidateIds: ["task-1", "task-2"],
        cutoff,
        batchSize: 50,
      })
    ).resolves.toBe(2);

    const selection = databaseMocks.execute.mock.calls[0]?.[0] as {
      text?: string;
    };
    const deletion = databaseMocks.execute.mock.calls[1]?.[0] as {
      text?: string;
    };
    expect(selection.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(selection.text).toContain("LIMIT ?");
    expect(deletion.text).toContain('DELETE FROM "external_async_task"');
    for (const query of [selection.text, deletion.text]) {
      expect(query).toContain("\"status\" IN ('completed', 'failed')");
      expect(query).toContain(
        "\"callback_status\" IN ('none', 'sent', 'permanent_failed')"
      );
      expect(query).toContain('"completed_at" IS NOT NULL');
      expect(query).toContain('"completed_at" <= ?');
    }
  });
});
