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
  normalizeOrderAmountToCnyCents,
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

  it("normalizes order amounts to CNY cents by currency", () => {
    expect(normalizeOrderAmountToCnyCents(1000, "CNY", 7.2)).toBe(1000);
    expect(normalizeOrderAmountToCnyCents(1000, "cny", 7.2)).toBe(1000);
    expect(normalizeOrderAmountToCnyCents(100, "USD", 7.2)).toBe(720);
    expect(normalizeOrderAmountToCnyCents(101, "usd", 7.2)).toBe(727);
    expect(normalizeOrderAmountToCnyCents(1000, "EUR", 7.2)).toBeNull();
    expect(normalizeOrderAmountToCnyCents(0, "USD", 7.2)).toBeNull();
    expect(normalizeOrderAmountToCnyCents(-100, "CNY", 7.2)).toBeNull();
    expect(normalizeOrderAmountToCnyCents(1000, "USD", 0)).toBeNull();
    expect(
      normalizeOrderAmountToCnyCents(1000, "USD", Number.NaN)
    ).toBeNull();
  });

  it("rewards 10 percent of CNY payment as credits by CNY cents", () => {
    const orderCnyCents = normalizeOrderAmountToCnyCents(1000, "CNY", 7.2);
    const commissionCnyCents = calculateReferralCommissionCents(
      orderCnyCents ?? 0,
      1000
    );

    expect(orderCnyCents).toBe(1000);
    expect(commissionCnyCents).toBe(100);
    expect(centsToCredits(commissionCnyCents)).toBe(100);
  });
});
