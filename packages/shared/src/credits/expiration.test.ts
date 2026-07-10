/**
 * 积分过期有界汇总器测试。
 *
 * 覆盖空积压、多页累计、十万批次明细截断和非法分页结果；不导入数据库，
 * 确保财务批处理的内存边界可以在 Vitest 中稳定验证。
 */

import { describe, expect, it, vi } from "vitest";
import {
  assertExpiredCreditsBalances,
  CREDITS_EXPIRATION_DETAIL_LIMIT,
  CREDITS_EXPIRATION_PAGE_SIZE,
  drainExpiredCreditsPages,
  type ExpiredCreditsPageResult,
  summarizeExpiredCreditsByUser,
} from "./expiration";

/**
 * 创建一页确定性的过期批次结果。
 *
 * @param pageIndex 从零开始的页序号。
 * @param processedCount 本页处理行数。
 * @returns 可供汇总器消费的分页结果，无副作用且不会失败。
 */
function makePage(
  pageIndex: number,
  processedCount: number
): ExpiredCreditsPageResult {
  return {
    processedCount,
    totalExpired: processedCount * 0.01,
    balanceUpdates: Math.min(processedCount, 2),
    details: Array.from({ length: processedCount }, (_, rowIndex) => ({
      batchId: `batch-${pageIndex}-${rowIndex}`,
      userId: `user-${rowIndex % 2}`,
      expiredAmount: 0.01,
    })),
  };
}

describe("drainExpiredCreditsPages", () => {
  it("空积压只探测一次并返回全零汇总", async () => {
    const processPage = vi.fn(async () => makePage(0, 0));

    await expect(drainExpiredCreditsPages(processPage)).resolves.toEqual({
      processedCount: 0,
      totalExpired: 0,
      batchCount: 0,
      balanceUpdates: 0,
      details: [],
      detailsTruncated: false,
    });
    expect(processPage).toHaveBeenCalledTimes(1);
  });

  it("累计多页金额和余额更新次数并保留完整的小结果", async () => {
    const pages = [makePage(0, 2), makePage(1, 1), makePage(2, 0)];
    const processPage = vi.fn(async () => pages.shift() ?? makePage(3, 0));

    const result = await drainExpiredCreditsPages(processPage);

    expect(result).toMatchObject({
      processedCount: 3,
      totalExpired: 0.03,
      batchCount: 2,
      balanceUpdates: 3,
      detailsTruncated: false,
    });
    expect(result.details).toHaveLength(3);
    expect(processPage).toHaveBeenCalledTimes(3);
  });

  it("十万批次只保留固定上限明细且逐页释放结果", async () => {
    const pageCount = 100_000 / CREDITS_EXPIRATION_PAGE_SIZE;
    let currentPage = 0;
    const processPage = vi.fn(async () => {
      if (currentPage >= pageCount) return makePage(currentPage, 0);
      const page = makePage(currentPage, CREDITS_EXPIRATION_PAGE_SIZE);
      currentPage += 1;
      return page;
    });

    const result = await drainExpiredCreditsPages(processPage);

    expect(result.processedCount).toBe(100_000);
    expect(result.totalExpired).toBe(1_000);
    expect(result.batchCount).toBe(pageCount);
    expect(result.details).toHaveLength(CREDITS_EXPIRATION_DETAIL_LIMIT);
    expect(result.detailsTruncated).toBe(true);
    expect(processPage).toHaveBeenCalledTimes(pageCount + 1);
  });

  it("分页处理器返回负数计数时显式失败", async () => {
    await expect(
      drainExpiredCreditsPages(async () => ({
        processedCount: -1,
        totalExpired: 0,
        balanceUpdates: 0,
        details: [],
      }))
    ).rejects.toThrow("过期积分分页返回了非法计数");
  });
});

describe("summarizeExpiredCreditsByUser", () => {
  it("按用户聚合两位小数并返回确定顺序", () => {
    expect(
      summarizeExpiredCreditsByUser([
        { userId: "user-b", remaining: 1.01 },
        { userId: "user-a", remaining: 0.1 },
        { userId: "user-a", remaining: 0.2 },
      ])
    ).toEqual([
      { userId: "user-a", amount: 0.3 },
      { userId: "user-b", amount: 1.01 },
    ]);
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("拒绝非法剩余金额 %s", (remaining) => {
    expect(() =>
      summarizeExpiredCreditsByUser([{ userId: "user-a", remaining }])
    ).toThrow("过期积分批次包含非法剩余金额");
  });
});

describe("assertExpiredCreditsBalances", () => {
  const totals = [
    { userId: "user-a", amount: 3 },
    { userId: "user-b", amount: 5 },
  ];

  it("所有锁定余额足额时通过", () => {
    expect(() =>
      assertExpiredCreditsBalances(
        totals,
        new Map([
          ["user-a", 3],
          ["user-b", 6],
        ])
      )
    ).not.toThrow();
  });

  it("余额行缺失时失败，避免只写账本不扣余额", () => {
    expect(() =>
      assertExpiredCreditsBalances(totals, new Map([["user-a", 3]]))
    ).toThrow("用户 user-b 缺少积分余额行");
  });

  it("余额不足时失败，禁止用 GREATEST 静默抹平差额", () => {
    expect(() =>
      assertExpiredCreditsBalances(
        totals,
        new Map([
          ["user-a", 2.99],
          ["user-b", 5],
        ])
      )
    ).toThrow("用户 user-a 余额 2.99 小于待过期积分 3");
  });
});
