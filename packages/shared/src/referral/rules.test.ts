/**
 * 邀请返佣纯规则测试
 *
 * 使用方：Vitest。覆盖 DB-free 的邀请码、金额上限和转积分换算规则。
 */

import { describe, expect, it } from "vitest";

import {
  calculateReferralCommissionCents,
  centsToCredits,
  isValidReferralCode,
  normalizeOrderAmountToUsdCents,
  normalizeReferralCode,
} from "./rules";

describe("referral rules", () => {
  it("normalizes and validates referral codes", () => {
    expect(normalizeReferralCode(" ab-c_12 ")).toBe("AB-C_12");
    expect(isValidReferralCode("ABCD")).toBe(true);
    expect(isValidReferralCode("AB-C_12")).toBe(true);
    expect(isValidReferralCode("abc")).toBe(false);
    expect(isValidReferralCode("ABC!")).toBe(false);
  });

  it("calculates commission by bps with floor rounding", () => {
    expect(calculateReferralCommissionCents(999, 1000)).toBe(99);
    expect(calculateReferralCommissionCents(1000, 1250)).toBe(125);
    expect(calculateReferralCommissionCents(1000, 0)).toBe(0);
    expect(calculateReferralCommissionCents(-1, 1000)).toBe(0);
  });

  it("applies per-invitee commission cap", () => {
    expect(calculateReferralCommissionCents(10_000, 2000, 1500, 1800)).toBe(
      300
    );
    expect(calculateReferralCommissionCents(10_000, 2000, 1800, 1800)).toBe(0);
    expect(calculateReferralCommissionCents(10_000, 2000, 0, 0)).toBe(2000);
  });

  it("converts cents to credits with two decimal places", () => {
    expect(centsToCredits(123)).toBe(123);
    expect(centsToCredits(123.456)).toBe(123.46);
  });

  it("normalizes order amounts to USD cents by currency", () => {
    expect(normalizeOrderAmountToUsdCents(1000, "USD", 7.2)).toBe(1000);
    expect(normalizeOrderAmountToUsdCents(1000, "usd", 7.2)).toBe(1000);
    expect(normalizeOrderAmountToUsdCents(720, "CNY", 7.2)).toBe(100);
    expect(normalizeOrderAmountToUsdCents(721, "cny", 7.2)).toBe(100);
    expect(normalizeOrderAmountToUsdCents(1000, "EUR", 7.2)).toBeNull();
    expect(normalizeOrderAmountToUsdCents(0, "USD", 7.2)).toBeNull();
    expect(normalizeOrderAmountToUsdCents(-100, "CNY", 7.2)).toBeNull();
    expect(normalizeOrderAmountToUsdCents(1000, "CNY", 0)).toBeNull();
    expect(
      normalizeOrderAmountToUsdCents(1000, "CNY", Number.NaN)
    ).toBeNull();
  });
});
