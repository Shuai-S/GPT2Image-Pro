import { describe, expect, it } from "vitest";

import {
  MAX_VERIFY_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  decodeCodeValue,
  encodeCodeValue,
  evaluateVerificationAttempt,
  getResendCooldownRemainingSeconds,
} from "./registration-verification-core";

// 守护审计 C-M24（A10 暴力破解防护）与 S-H6（发码冷却）的核心状态机。
// 这些纯逻辑此前与 DB 交织无法 DB-free 测，回归会静默重开暴破/轰炸口子。

describe("encodeCodeValue / decodeCodeValue", () => {
  it("encode 与 decode 互逆", () => {
    expect(encodeCodeValue("123456", 3)).toBe("123456|3");
    expect(decodeCodeValue("123456|3")).toEqual({ code: "123456", attempts: 3 });
  });

  it("老数据（无分隔符）回退 attempts=0", () => {
    expect(decodeCodeValue("123456")).toEqual({ code: "123456", attempts: 0 });
  });

  it("非法 attempts（NaN）回退 attempts=0，避免验证码永不作废", () => {
    expect(decodeCodeValue("123456|NaN")).toEqual({
      code: "123456",
      attempts: 0,
    });
  });
});

describe("evaluateVerificationAttempt", () => {
  const future = () => new Date(Date.now() + 60_000);
  const past = () => new Date(Date.now() - 60_000);
  const now = () => new Date();

  it("精确匹配时成功并删除（消费验证码）", () => {
    const decision = evaluateVerificationAttempt(
      { value: encodeCodeValue("123456", 0), expiresAt: future() },
      "123456",
      now()
    );
    expect(decision).toEqual({
      outcome: "valid",
      shouldDelete: true,
      nextValue: null,
    });
  });

  it("过期记录判 expired 并删除", () => {
    const decision = evaluateVerificationAttempt(
      { value: encodeCodeValue("123456", 0), expiresAt: past() },
      "123456",
      now()
    );
    expect(decision).toEqual({
      outcome: "expired",
      shouldDelete: true,
      nextValue: null,
    });
  });

  it("已达上限判 locked 并删除（即便码正确也不放行）", () => {
    const decision = evaluateVerificationAttempt(
      {
        value: encodeCodeValue("123456", MAX_VERIFY_ATTEMPTS),
        expiresAt: future(),
      },
      "123456",
      now()
    );
    expect(decision).toEqual({
      outcome: "locked",
      shouldDelete: true,
      nextValue: null,
    });
  });

  it("未达上限的错误码：计数自增并写回新 value", () => {
    const decision = evaluateVerificationAttempt(
      { value: encodeCodeValue("123456", 1), expiresAt: future() },
      "000000",
      now()
    );
    expect(decision).toEqual({
      outcome: "invalid",
      shouldDelete: false,
      nextValue: encodeCodeValue("123456", 2),
    });
  });

  it("错误码使尝试达到上限时直接删除（锁死下一次）", () => {
    const decision = evaluateVerificationAttempt(
      {
        value: encodeCodeValue("123456", MAX_VERIFY_ATTEMPTS - 1),
        expiresAt: future(),
      },
      "000000",
      now()
    );
    expect(decision).toEqual({
      outcome: "invalid",
      shouldDelete: true,
      nextValue: null,
    });
  });
});

describe("getResendCooldownRemainingSeconds", () => {
  it("无上一封记录视为可发送", () => {
    expect(getResendCooldownRemainingSeconds(null, new Date())).toBe(0);
    expect(getResendCooldownRemainingSeconds(undefined, new Date())).toBe(0);
  });

  it("冷却期内返回剩余秒数（向上取整）", () => {
    const now = new Date(10 * 60 * 1000);
    const lastSentAt = new Date(now.getTime() - 10_500);
    // 已过 10.5s，剩余 60-10.5=49.5s -> 向上取整 50
    expect(getResendCooldownRemainingSeconds(lastSentAt, now)).toBe(50);
  });

  it("超过冷却期返回 0（可再次发送）", () => {
    const now = new Date(10 * 60 * 1000);
    const lastSentAt = new Date(
      now.getTime() - (RESEND_COOLDOWN_SECONDS + 1) * 1000
    );
    expect(getResendCooldownRemainingSeconds(lastSentAt, now)).toBe(0);
  });

  it("恰好到达冷却边界返回 0", () => {
    const now = new Date(10 * 60 * 1000);
    const lastSentAt = new Date(now.getTime() - RESEND_COOLDOWN_SECONDS * 1000);
    expect(getResendCooldownRemainingSeconds(lastSentAt, now)).toBe(0);
  });
});
