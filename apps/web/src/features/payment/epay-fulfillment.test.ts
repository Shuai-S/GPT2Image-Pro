/**
 * Epay 履约金额门闩（isExpectedEpayAmount）回归测试。
 *
 * isExpectedEpayAmount 把订单期望金额与网关回传金额都换算为分，要求实付不低于
 * 期望且不超出期望 10 分（容忍上游四舍五入/手续费的轻微多付）。它是阻止
 * 低价/篡改金额套取高价套餐的反欺诈门闩，容忍区间或比较方向被误改会静默放行。
 *
 * 该模块顶层 import 了大量 DB 耦合依赖；被测纯函数与之无关，故 mock
 * @repo/database / @repo/database/schema 使模块在 DB-free vitest 下加载即可。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({ db: {} }));
vi.mock("@repo/database/schema", () => ({
  creditsBatch: {},
  subscription: {},
  epayOrder: {},
}));

import type { EpayVerifyResult } from "@repo/shared/payment/epay";

import {
  isExpectedEpayAmount,
  isMatchingPaymentProvider,
  isSubscriptionOwnedByFulfillmentUser,
  resolveExpectedLocalPaymentAmount,
} from "./epay-fulfillment";

function verifyInfoWithMoney(money: string): EpayVerifyResult {
  return {
    verifyStatus: true,
    type: "alipay",
    tradeNo: "G1",
    outTradeNo: "T1",
    name: "credits",
    money,
    tradeStatus: "TRADE_SUCCESS",
    raw: {},
  };
}

describe("isExpectedEpayAmount", () => {
  it("accepts an exact match", () => {
    expect(isExpectedEpayAmount(verifyInfoWithMoney("10.00"), 10)).toBe(true);
  });

  it("accepts overpayment within the 10-cent tolerance", () => {
    expect(isExpectedEpayAmount(verifyInfoWithMoney("10.10"), 10)).toBe(true);
    expect(isExpectedEpayAmount(verifyInfoWithMoney("10.01"), 10)).toBe(true);
  });

  it("rejects underpayment", () => {
    expect(isExpectedEpayAmount(verifyInfoWithMoney("9.99"), 10)).toBe(false);
  });

  it("rejects overpayment beyond the tolerance", () => {
    expect(isExpectedEpayAmount(verifyInfoWithMoney("10.11"), 10)).toBe(false);
  });

  it("rejects when the paid amount fails to parse", () => {
    expect(isExpectedEpayAmount(verifyInfoWithMoney("abc"), 10)).toBe(false);
    expect(isExpectedEpayAmount(verifyInfoWithMoney(""), 10)).toBe(false);
  });

  it("rejects when the expected amount fails to parse", () => {
    expect(isExpectedEpayAmount(verifyInfoWithMoney("10.00"), Number.NaN)).toBe(
      false
    );
  });
});

describe("isMatchingPaymentProvider", () => {
  it("accepts epay callbacks only for epay orders", () => {
    expect(
      isMatchingPaymentProvider({
        source: "epay-webhook",
        metadata: {
          type: "credit_purchase",
          userId: "user-1",
          outTradeNo: "T1",
          provider: "epay",
        },
      })
    ).toBe(true);
  });

  it("rejects cross-provider callback replay against an alipay order", () => {
    expect(
      isMatchingPaymentProvider({
        source: "epay-webhook",
        metadata: {
          type: "credit_purchase",
          userId: "user-1",
          outTradeNo: "T1",
          provider: "alipay",
        },
      })
    ).toBe(false);
  });
});

describe("resolveExpectedLocalPaymentAmount", () => {
  it("uses the immutable order amount snapshot when present", () => {
    expect(
      resolveExpectedLocalPaymentAmount({
        metadata: {
          type: "credit_purchase",
          userId: "user-1",
          outTradeNo: "T1",
          expectedAmount: 20,
        },
        fallbackAmount: 999,
      })
    ).toBe(20);
  });

  it("falls back to current runtime pricing only for legacy orders", () => {
    expect(
      resolveExpectedLocalPaymentAmount({
        metadata: {
          type: "credit_purchase",
          userId: "user-1",
          outTradeNo: "T1",
        },
        fallbackAmount: 30,
      })
    ).toBe(30);
  });
});

describe("isSubscriptionOwnedByFulfillmentUser", () => {
  it("allows first fulfillment and same-user replay", () => {
    expect(isSubscriptionOwnedByFulfillmentUser(undefined, "user-1")).toBe(
      true
    );
    expect(isSubscriptionOwnedByFulfillmentUser("user-1", "user-1")).toBe(true);
  });

  it("rejects replaying one subscription ID for another user", () => {
    expect(isSubscriptionOwnedByFulfillmentUser("user-1", "user-2")).toBe(
      false
    );
  });
});
