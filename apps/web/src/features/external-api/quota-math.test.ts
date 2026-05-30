import { describe, expect, it } from "vitest";

import {
  ExternalApiKeyQuotaExceededError,
  getExternalApiKeyQuotaRemaining,
  isExternalApiKeyQuotaExceededError,
  normalizeExternalApiKeyCreditLimit,
  roundQuotaCredits,
} from "./quota-math";

describe("normalizeExternalApiKeyCreditLimit", () => {
  it("treats empty / null / undefined as unlimited (null)", () => {
    expect(normalizeExternalApiKeyCreditLimit("")).toBeNull();
    expect(normalizeExternalApiKeyCreditLimit(null)).toBeNull();
    expect(normalizeExternalApiKeyCreditLimit(undefined)).toBeNull();
  });

  it("rounds a numeric limit to two decimals", () => {
    expect(normalizeExternalApiKeyCreditLimit(1.005)).toBe(1.01);
    expect(normalizeExternalApiKeyCreditLimit("2.345")).toBe(2.35);
  });

  it("throws on negative or non-finite limits", () => {
    expect(() => normalizeExternalApiKeyCreditLimit(-1)).toThrow();
    expect(() => normalizeExternalApiKeyCreditLimit("abc")).toThrow();
    expect(() =>
      normalizeExternalApiKeyCreditLimit(Number.POSITIVE_INFINITY)
    ).toThrow();
  });
});

describe("getExternalApiKeyQuotaRemaining", () => {
  it("returns null for an unlimited key", () => {
    expect(getExternalApiKeyQuotaRemaining(null, 10)).toBeNull();
  });

  it("returns the remaining quota rounded to two decimals", () => {
    expect(getExternalApiKeyQuotaRemaining(10, 4.005)).toBe(6);
    expect(getExternalApiKeyQuotaRemaining(10, 3.33)).toBe(6.67);
  });

  it("clamps remaining at zero when used exceeds the limit", () => {
    expect(getExternalApiKeyQuotaRemaining(5, 7.5)).toBe(0);
  });
});

describe("roundQuotaCredits", () => {
  it("rounds at the two-decimal boundary without float drift", () => {
    expect(roundQuotaCredits(0.1 + 0.2)).toBe(0.3);
    expect(roundQuotaCredits(1.555)).toBe(1.56);
  });
});

describe("ExternalApiKeyQuotaExceededError", () => {
  it("carries the required / remaining / limit / used context", () => {
    const error = new ExternalApiKeyQuotaExceededError(5, 2, 10, 8);
    expect(error.code).toBe("api_key_quota_exceeded");
    expect(error.required).toBe(5);
    expect(error.remaining).toBe(2);
    expect(error.limit).toBe(10);
    expect(error.used).toBe(8);
    expect(isExternalApiKeyQuotaExceededError(error)).toBe(true);
    expect(isExternalApiKeyQuotaExceededError(new Error("x"))).toBe(false);
  });
});
