/**
 * 用户订阅 upsert 服务的 DB-free 单元测试。
 *
 * 通过最小 Drizzle 链 mock 锁定 userId 冲突目标、允许更新的字段以及返回值，
 * 防止调用方重新引入先查后写竞态或覆盖既有记录身份字段。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface SqlFragmentMock {
  strings: string[];
  values: unknown[];
}

interface ConflictConfigMock {
  target: unknown;
  set: {
    currentPeriodStart: Date | null | SqlFragmentMock;
    currentPeriodEnd: Date | null | SqlFragmentMock;
    [key: string]: unknown;
  };
}

const subscriptionMock = vi.hoisted(() => ({
  userId: "subscription.user_id",
  subscriptionId: "subscription.subscription_id",
  currentPeriodStart: "subscription.current_period_start",
  currentPeriodEnd: "subscription.current_period_end",
}));

const sqlMock = vi.hoisted(() =>
  vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: [...strings],
    values,
  }))
);

const databaseMock = vi.hoisted(() => {
  const returning = vi.fn();
  const onConflictDoUpdate = vi.fn((_config: ConflictConfigMock) => ({
    returning,
  }));
  const values = vi.fn((_values: Record<string, unknown>) => ({
    onConflictDoUpdate,
  }));
  const insert = vi.fn(() => ({ values }));

  return { insert, onConflictDoUpdate, returning, values };
});

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "generated-subscription-id"),
}));

vi.mock("@repo/database", () => ({
  db: { insert: databaseMock.insert },
}));

vi.mock("@repo/database/schema", () => ({
  subscription: subscriptionMock,
}));

vi.mock("drizzle-orm", () => ({
  sql: sqlMock,
}));

import { upsertUserSubscription } from "./upsert-user-subscription";

describe("upsertUserSubscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T08:30:00.000Z"));
    databaseMock.insert.mockClear();
    databaseMock.values.mockClear();
    databaseMock.onConflictDoUpdate.mockClear();
    databaseMock.returning.mockReset();
    sqlMock.mockClear();
  });

  it("按 userId 冲突更新订阅字段并返回数据库记录", async () => {
    const currentPeriodStart = new Date("2026-07-01T00:00:00.000Z");
    const currentPeriodEnd = new Date("2026-08-01T00:00:00.000Z");
    const updatedAt = new Date("2026-07-10T08:30:00.000Z");
    const returnedRow = {
      id: "existing-subscription-id",
      userId: "user-1",
      subscriptionId: "provider-subscription-1",
      priceId: "price-pro",
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt,
    };
    databaseMock.returning.mockResolvedValueOnce([returnedRow]);

    const result = await upsertUserSubscription({
      userId: "user-1",
      subscriptionId: "provider-subscription-1",
      priceId: "price-pro",
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
    });

    expect(databaseMock.insert).toHaveBeenCalledWith(subscriptionMock);
    expect(databaseMock.values).toHaveBeenCalledWith({
      id: "generated-subscription-id",
      userId: "user-1",
      subscriptionId: "provider-subscription-1",
      priceId: "price-pro",
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      createdAt: updatedAt,
      updatedAt,
    });
    expect(databaseMock.onConflictDoUpdate).toHaveBeenCalledWith({
      target: subscriptionMock.userId,
      set: {
        subscriptionId: "provider-subscription-1",
        priceId: "price-pro",
        status: "active",
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        updatedAt,
      },
    });
    expect(result).toBe(returnedRow);
  });

  it("本地支付同 subscriptionId 冲突时保留首次写入的周期", async () => {
    const currentPeriodStart = new Date("2026-07-10T08:30:00.000Z");
    const currentPeriodEnd = new Date("2026-08-10T08:30:00.000Z");
    databaseMock.returning.mockResolvedValueOnce([
      {
        id: "existing-subscription-id",
        userId: "user-1",
        subscriptionId: "epay-order-1",
        priceId: "price-pro",
        status: "canceled",
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: true,
        createdAt: currentPeriodStart,
        updatedAt: currentPeriodStart,
      },
    ]);

    await upsertUserSubscription({
      userId: "user-1",
      subscriptionId: "epay-order-1",
      priceId: "price-pro",
      status: "canceled",
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: true,
      periodConflictPolicy: "preserve_same_subscription",
    });

    const insertedValues = databaseMock.values.mock.calls[0]?.[0];
    expect(insertedValues).not.toHaveProperty("periodConflictPolicy");
    const conflictConfig = databaseMock.onConflictDoUpdate.mock.calls[0]?.[0];
    expect(conflictConfig).toMatchObject({
      target: subscriptionMock.userId,
      set: {
        subscriptionId: "epay-order-1",
        priceId: "price-pro",
        status: "canceled",
        cancelAtPeriodEnd: true,
      },
    });
    expect(conflictConfig?.set.currentPeriodStart).toEqual({
      strings: [
        "CASE WHEN ",
        " = excluded.subscription_id THEN ",
        " ELSE excluded.current_period_start END",
      ],
      values: [
        subscriptionMock.subscriptionId,
        subscriptionMock.currentPeriodStart,
      ],
    });
    expect(conflictConfig?.set.currentPeriodEnd).toEqual({
      strings: [
        "CASE WHEN ",
        " = excluded.subscription_id THEN ",
        " ELSE excluded.current_period_end END",
      ],
      values: [
        subscriptionMock.subscriptionId,
        subscriptionMock.currentPeriodEnd,
      ],
    });
  });

  it("数据库未返回写入记录时显式失败", async () => {
    databaseMock.returning.mockResolvedValueOnce([]);

    await expect(
      upsertUserSubscription({
        userId: "user-1",
        subscriptionId: "provider-subscription-1",
        priceId: "price-pro",
        status: "active",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      })
    ).rejects.toThrow("Subscription upsert did not return a record");
  });
});
