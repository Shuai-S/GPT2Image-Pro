import { describe, expect, it } from "vitest";

import {
  buildCreditsExpireResponse,
  summarizeExpiredPendingGenerations,
} from "./scheduled-jobs-response";

describe("buildCreditsExpireResponse", () => {
  it("映射有界汇总并保留金额、页数与截断状态", () => {
    const response = buildCreditsExpireResponse({
      processedCount: 2,
      totalExpired: 15,
      batchCount: 1,
      balanceUpdates: 2,
      details: [
        { batchId: "b1", userId: "u1", expiredAmount: 10 },
        { batchId: "b2", userId: "u2", expiredAmount: 5 },
      ],
      detailsTruncated: false,
    });

    expect(response.success).toBe(true);
    expect(response.processed).toBe(2);
    expect(response.totalExpired).toBe(15);
    expect(response.batchCount).toBe(1);
    expect(response.balanceUpdates).toBe(2);
    expect(response.detailsTruncated).toBe(false);
    expect(response.details).toEqual([
      { batchId: "b1", userId: "u1", expiredAmount: 10 },
      { batchId: "b2", userId: "u2", expiredAmount: 5 },
    ]);
  });

  it("空汇总时 processed===0 且 details===[]", () => {
    const response = buildCreditsExpireResponse({
      processedCount: 0,
      totalExpired: 0,
      batchCount: 0,
      balanceUpdates: 0,
      details: [],
      detailsTruncated: false,
    });

    expect(response.processed).toBe(0);
    expect(response.details).toEqual([]);
  });

  it("丢弃结果对象上的额外字段，details 仅保留三字段", () => {
    // 模拟底层返回包含额外字段的结果，验证响应不透传它们
    const rawResult = {
      processedCount: 1,
      totalExpired: 7,
      batchCount: 1,
      balanceUpdates: 1,
      details: [
        {
          batchId: "b1",
          userId: "u1",
          expiredAmount: 7,
          secret: "leak",
        },
      ],
      detailsTruncated: true,
    };
    const response = buildCreditsExpireResponse(rawResult);

    const [detail] = response.details;
    expect(detail).toBeDefined();
    expect(Object.keys(detail ?? {}).sort()).toEqual([
      "batchId",
      "expiredAmount",
      "userId",
    ]);
  });
});

describe("summarizeExpiredPendingGenerations", () => {
  it("统计过期条数并累加退款积分", () => {
    const summary = summarizeExpiredPendingGenerations([
      { creditsRefunded: 6 },
      { creditsRefunded: 0 },
    ]);

    expect(summary.expired).toBe(2);
    expect(summary.creditsRefunded).toBe(6);
  });

  it("零行时 expired===0 且 creditsRefunded===0", () => {
    const summary = summarizeExpiredPendingGenerations([]);

    expect(summary.expired).toBe(0);
    expect(summary.creditsRefunded).toBe(0);
  });

  it("正确累加多条退款积分", () => {
    const summary = summarizeExpiredPendingGenerations([
      { creditsRefunded: 1.5 },
      { creditsRefunded: 2.25 },
      { creditsRefunded: 0.25 },
    ]);

    expect(summary.creditsRefunded).toBeCloseTo(4, 10);
  });
});
