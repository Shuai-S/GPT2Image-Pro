import { describe, expect, it } from "vitest";

import {
  ExternalApiKeyQuotaExceededError,
  getExternalApiKeyQuotaRemaining,
  isExternalApiKeyQuotaExceededError,
  normalizeExternalApiKeyCreditLimit,
  normalizeExternalApiKeyUsageSourceRef,
  resolveExternalApiKeyUsageMutation,
  roundQuotaCredits,
} from "./quota-math";

describe("normalizeExternalApiKeyUsageSourceRef", () => {
  it("keeps the legacy path when sourceRef is omitted", () => {
    expect(normalizeExternalApiKeyUsageSourceRef()).toBeNull();
  });

  it("trims a provided sourceRef and rejects an empty value", () => {
    expect(normalizeExternalApiKeyUsageSourceRef(" generation:1 ")).toBe(
      "generation:1"
    );
    expect(() => normalizeExternalApiKeyUsageSourceRef("   ")).toThrow(
      "sourceRef 不能为空"
    );
  });
});

describe("resolveExternalApiKeyUsageMutation", () => {
  it("inserts the first reserve or refund event", () => {
    expect(
      resolveExternalApiKeyUsageMutation({
        existing: null,
        requestedStatus: "reserved",
        amount: 2,
      })
    ).toBe("insert");
    expect(
      resolveExternalApiKeyUsageMutation({
        existing: null,
        requestedStatus: "refunded",
        amount: 2,
      })
    ).toBe("insert");
  });

  it("makes repeated reserves and refunds no-ops", () => {
    expect(
      resolveExternalApiKeyUsageMutation({
        existing: { status: "reserved", amount: 2 },
        requestedStatus: "reserved",
        amount: 2,
      })
    ).toBe("noop");
    expect(
      resolveExternalApiKeyUsageMutation({
        existing: { status: "refunded", amount: 2 },
        requestedStatus: "refunded",
        amount: 2,
      })
    ).toBe("noop");
  });

  it("transitions a reservation to refunded exactly once", () => {
    expect(
      resolveExternalApiKeyUsageMutation({
        existing: { status: "reserved", amount: 2 },
        requestedStatus: "refunded",
        amount: 2,
      })
    ).toBe("transition");
    expect(
      resolveExternalApiKeyUsageMutation({
        existing: { status: "refunded", amount: 2 },
        requestedStatus: "reserved",
        amount: 2,
      })
    ).toBe("noop");
  });

  it("rejects amount drift and invalid persisted states", () => {
    expect(() =>
      resolveExternalApiKeyUsageMutation({
        existing: { status: "reserved", amount: 2 },
        requestedStatus: "reserved",
        amount: 3,
      })
    ).toThrow("金额不一致");
    expect(() =>
      resolveExternalApiKeyUsageMutation({
        existing: { status: "invalid", amount: 2 },
        requestedStatus: "reserved",
        amount: 2,
      })
    ).toThrow("未知的 API Key 配额账本状态");
  });
});

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
