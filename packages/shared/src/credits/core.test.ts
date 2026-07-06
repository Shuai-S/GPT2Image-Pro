/**
 * 积分核心流程测试。
 *
 * 使用 DB-free mock 覆盖账户初始化并发路径，避免真实数据库参与单元测试。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type BalanceRow = {
  id: string;
  userId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  status: "active" | "frozen";
  createdAt: Date;
  updatedAt: Date;
};

const makeBalance = (userId: string, id = "balance-1"): BalanceRow => ({
  id,
  userId,
  balance: 0,
  totalEarned: 0,
  totalSpent: 0,
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

const state = vi.hoisted(() => ({
  selectResults: [] as BalanceRow[][],
  insertResults: [] as BalanceRow[][],
  insertValues: [] as unknown[],
  conflictTargets: [] as unknown[],
}));

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  db: dbMock,
}));

vi.mock("../system-settings", () => ({
  getRuntimeSettingNumber: vi.fn(async (_key: string, fallback: number) => fallback),
}));

/**
 * 重置并配置 Drizzle 链式 mock。
 *
 * @returns void
 * @sideEffects 重置 vi mock 与内存队列。
 * @failureMode 测试队列为空时返回空数组，模拟未命中。
 */
function resetDbMock() {
  vi.resetModules();
  state.selectResults = [];
  state.insertResults = [];
  state.insertValues = [];
  state.conflictTargets = [];

  dbMock.select.mockReset();
  dbMock.insert.mockReset();

  dbMock.select.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => state.selectResults.shift() ?? []),
      })),
    })),
  }));

  dbMock.insert.mockImplementation(() => ({
    values: vi.fn((values: unknown) => {
      state.insertValues.push(values);
      return {
        onConflictDoNothing: vi.fn((config: { target?: unknown }) => {
          state.conflictTargets.push(config.target);
          return {
            returning: vi.fn(async () => state.insertResults.shift() ?? []),
          };
        }),
      };
    }),
  }));
}

describe("ensureCreditsBalance", () => {
  beforeEach(() => {
    resetDbMock();
  });

  it("已有余额行时直接返回且不插入", async () => {
    const existing = makeBalance("user-1");
    state.selectResults = [[existing]];

    const { ensureCreditsBalance } = await import("./core");
    await expect(ensureCreditsBalance("user-1")).resolves.toBe(existing);

    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("余额行不存在时创建新账户", async () => {
    const inserted = makeBalance("user-1", "balance-new");
    state.selectResults = [[]];
    state.insertResults = [[inserted]];

    const { ensureCreditsBalance } = await import("./core");
    await expect(ensureCreditsBalance("user-1")).resolves.toBe(inserted);

    expect(state.insertValues).toHaveLength(1);
    expect(state.insertValues[0]).toMatchObject({
      userId: "user-1",
      balance: 0,
      totalEarned: 0,
      totalSpent: 0,
      status: "active",
    });
    expect(state.conflictTargets).toHaveLength(1);
  });

  it("并发首次创建冲突时重新读取已创建账户", async () => {
    const concurrent = makeBalance("user-1", "balance-concurrent");
    state.selectResults = [[], [concurrent]];
    state.insertResults = [[]];

    const { ensureCreditsBalance } = await import("./core");
    await expect(ensureCreditsBalance("user-1")).resolves.toBe(concurrent);

    expect(dbMock.select).toHaveBeenCalledTimes(2);
    expect(state.insertValues).toHaveLength(1);
  });

  it("插入冲突后仍读不到账户时显式失败", async () => {
    state.selectResults = [[], []];
    state.insertResults = [[]];

    const { ensureCreditsBalance } = await import("./core");
    await expect(ensureCreditsBalance("user-1")).rejects.toThrow(
      "创建积分账户失败"
    );
  });
});
