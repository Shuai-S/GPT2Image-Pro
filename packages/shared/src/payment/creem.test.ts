import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// creem.ts 仅从 system-settings 引入 getRuntimeSettingString，
// 而 system-settings 会拉起 @repo/database。被测纯逻辑不读取运行时设置，
// 故在此 mock 掉该依赖，使本文件保持 DB-free（CLAUDE.md 要求纯函数可在不 import
// @repo/database 下单测）。
vi.mock("../system-settings", () => ({
  getRuntimeSettingString: vi.fn(async () => ""),
}));

import {
  buildSubscriptionPeriodKey,
  computeSubscriptionCreditsToGrant,
  getCreemPeriodDays,
  isYearlyCreemPeriod,
  parseCreemWebhookEvent,
  verifyCreemWebhookSignature,
} from "./creem";

describe("buildSubscriptionPeriodKey", () => {
  it("拼接订阅 ID 与周期开始时间作为幂等键", () => {
    expect(buildSubscriptionPeriodKey("sub_1", "2026-01-01T00:00:00Z")).toBe(
      "sub_1:2026-01-01T00:00:00Z"
    );
  });
});

describe("getCreemPeriodDays", () => {
  it("按毫秒差四舍五入计算月付约 30 天", () => {
    expect(
      getCreemPeriodDays("2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z")
    ).toBe(30);
  });

  it("年付约 365 天", () => {
    expect(
      getCreemPeriodDays("2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z")
    ).toBe(365);
  });

  it("日期非法时返回 NaN", () => {
    expect(
      Number.isNaN(getCreemPeriodDays("not-a-date", "2026-01-01T00:00:00Z"))
    ).toBe(true);
    expect(
      Number.isNaN(getCreemPeriodDays("2026-01-01T00:00:00Z", "not-a-date"))
    ).toBe(true);
  });
});

describe("isYearlyCreemPeriod", () => {
  it("超过 60 天判为年付", () => {
    expect(isYearlyCreemPeriod(61)).toBe(true);
    expect(isYearlyCreemPeriod(365)).toBe(true);
  });

  it("60 天及以下判为月付（边界）", () => {
    expect(isYearlyCreemPeriod(60)).toBe(false);
    expect(isYearlyCreemPeriod(30)).toBe(false);
  });

  it("周期天数为 NaN 时按月付处理，避免误发 12 倍积分", () => {
    expect(isYearlyCreemPeriod(Number.NaN)).toBe(false);
  });
});

describe("computeSubscriptionCreditsToGrant", () => {
  it("月付发放月度积分", () => {
    expect(computeSubscriptionCreditsToGrant(1000, false)).toBe(1000);
  });

  it("年付发放 12 倍月度积分", () => {
    expect(computeSubscriptionCreditsToGrant(1000, true)).toBe(12000);
  });
});

describe("parseCreemWebhookEvent", () => {
  const validEvent = {
    id: "evt_1",
    eventType: "checkout.completed",
    object: { id: "ch_1", metadata: { userId: "u_1" } },
    created_at: 1700000000000,
  };

  it("接受结构合法的事件体并保留 object 未知字段", () => {
    const parsed = parseCreemWebhookEvent(JSON.stringify(validEvent));
    expect(parsed.eventType).toBe("checkout.completed");
    expect(parsed.id).toBe("evt_1");
    expect(
      (parsed.object as { metadata?: { userId?: string } }).metadata?.userId
    ).toBe("u_1");
  });

  it("拒绝非法 JSON", () => {
    expect(() => parseCreemWebhookEvent("{not json")).toThrow(
      /not valid JSON/
    );
  });

  it("拒绝未知 eventType", () => {
    expect(() =>
      parseCreemWebhookEvent(
        JSON.stringify({ ...validEvent, eventType: "subscription.unknown" })
      )
    ).toThrow(/Invalid webhook event shape/);
  });

  it("拒绝 object 非对象", () => {
    expect(() =>
      parseCreemWebhookEvent(
        JSON.stringify({ ...validEvent, object: "not-an-object" })
      )
    ).toThrow(/Invalid webhook event shape/);
  });

  it("拒绝缺失必填字段", () => {
    const { created_at: _omit, ...withoutCreatedAt } = validEvent;
    expect(() =>
      parseCreemWebhookEvent(JSON.stringify(withoutCreatedAt))
    ).toThrow(/Invalid webhook event shape/);
  });
});

describe("verifyCreemWebhookSignature", () => {
  // 用已知密钥+载荷计算 HMAC-SHA256，验证恒定时间比对在长度/内容上的行为。
  const secret = "whsec_test";
  const payload = '{"id":"evt_1"}';

  it("正确签名通过校验", () => {
    const signature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    expect(verifyCreemWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it("错误签名不通过", () => {
    expect(verifyCreemWebhookSignature(payload, "deadbeef", secret)).toBe(
      false
    );
  });
});
