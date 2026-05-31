/**
 * Creem 实付金额/币种反欺诈校验 -- 单元测试
 *
 * 覆盖：creemMajorToMinorUnits、evaluateCreemAmountMatch、shouldGrantAfterAmountCheck
 * 场景：正常币种换算、零小数/三小数币种、金额匹配/不匹配、币种不匹配、边界值。
 */

import { describe, expect, it } from "vitest";
import {
  CREEM_AMOUNT_TOLERANCE_MINOR_UNITS,
  type CreemAmountMatchResult,
  creemMajorToMinorUnits,
  evaluateCreemAmountMatch,
  shouldGrantAfterAmountCheck,
} from "./creem-amount";

// ============================================
// creemMajorToMinorUnits
// ============================================

describe("creemMajorToMinorUnits", () => {
  describe("standard 2-decimal currencies (USD, EUR, CNY)", () => {
    it("converts 19.99 USD to 1999 minor units", () => {
      expect(creemMajorToMinorUnits(19.99, "USD")).toBe(1999);
    });

    it("converts 0.01 USD to 1 minor unit", () => {
      expect(creemMajorToMinorUnits(0.01, "USD")).toBe(1);
    });

    it("converts integer amount 10 EUR to 1000 minor units", () => {
      expect(creemMajorToMinorUnits(10, "EUR")).toBe(1000);
    });

    it("converts 0 USD to 0 minor units", () => {
      expect(creemMajorToMinorUnits(0, "USD")).toBe(0);
    });

    it("handles floating point precision (0.1 + 0.2 scenario)", () => {
      // 0.1 * 100 = 10.000000000000002 in IEEE 754, should round to 10
      expect(creemMajorToMinorUnits(0.1, "USD")).toBe(10);
    });

    it("is case-insensitive for currency code", () => {
      expect(creemMajorToMinorUnits(5.5, "usd")).toBe(550);
      expect(creemMajorToMinorUnits(5.5, "Usd")).toBe(550);
    });

    it("trims whitespace in currency code", () => {
      expect(creemMajorToMinorUnits(1.0, " USD ")).toBe(100);
    });

    it("handles very large amounts", () => {
      expect(creemMajorToMinorUnits(999999.99, "USD")).toBe(99999999);
    });
  });

  describe("zero-decimal currencies (JPY, KRW, VND)", () => {
    it("converts 2000 JPY to 2000 (no multiplication)", () => {
      expect(creemMajorToMinorUnits(2000, "JPY")).toBe(2000);
    });

    it("converts 50000 KRW to 50000", () => {
      expect(creemMajorToMinorUnits(50000, "KRW")).toBe(50000);
    });

    it("converts 0 JPY to 0", () => {
      expect(creemMajorToMinorUnits(0, "JPY")).toBe(0);
    });

    it("rounds fractional amounts for zero-decimal currencies", () => {
      // 2000.5 JPY -> round to 2001
      expect(creemMajorToMinorUnits(2000.5, "JPY")).toBe(2001);
    });

    it("handles VND (zero-decimal)", () => {
      expect(creemMajorToMinorUnits(500000, "VND")).toBe(500000);
    });
  });

  describe("three-decimal currencies (BHD, KWD, OMR)", () => {
    it("converts 1.234 BHD to 1234 minor units", () => {
      expect(creemMajorToMinorUnits(1.234, "BHD")).toBe(1234);
    });

    it("converts 10 KWD to 10000 minor units", () => {
      expect(creemMajorToMinorUnits(10, "KWD")).toBe(10000);
    });

    it("converts 0.001 OMR to 1 minor unit", () => {
      expect(creemMajorToMinorUnits(0.001, "OMR")).toBe(1);
    });

    it("converts 0 BHD to 0", () => {
      expect(creemMajorToMinorUnits(0, "BHD")).toBe(0);
    });
  });

  describe("invalid inputs", () => {
    it("returns NaN for negative amount", () => {
      expect(creemMajorToMinorUnits(-1, "USD")).toBeNaN();
    });

    it("returns NaN for NaN amount", () => {
      expect(creemMajorToMinorUnits(Number.NaN, "USD")).toBeNaN();
    });

    it("returns NaN for Infinity", () => {
      expect(creemMajorToMinorUnits(Number.POSITIVE_INFINITY, "USD")).toBeNaN();
    });

    it("returns NaN for -Infinity", () => {
      expect(creemMajorToMinorUnits(Number.NEGATIVE_INFINITY, "USD")).toBeNaN();
    });
  });
});

// ============================================
// evaluateCreemAmountMatch
// ============================================

describe("evaluateCreemAmountMatch", () => {
  describe("amount match (same currency, same amount)", () => {
    it("matches when actual equals expected (USD)", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 19.99, currency: "USD" },
        { amount: 1999, currency: "USD" }
      );
      expect(result.comparable).toBe(true);
      expect(result.matches).toBe(true);
      expect(result.expectedMinor).toBe(1999);
      expect(result.actualMinor).toBe(1999);
    });

    it("matches when actual is within tolerance (slightly over)", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 19.99, currency: "USD" },
        { amount: 1999 + CREEM_AMOUNT_TOLERANCE_MINOR_UNITS, currency: "USD" }
      );
      expect(result.comparable).toBe(true);
      expect(result.matches).toBe(true);
    });

    it("matches for JPY (zero-decimal)", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 2000, currency: "JPY" },
        { amount: 2000, currency: "JPY" }
      );
      expect(result.comparable).toBe(true);
      expect(result.matches).toBe(true);
      expect(result.expectedMinor).toBe(2000);
      expect(result.actualMinor).toBe(2000);
    });

    it("matches for BHD (three-decimal)", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 1.234, currency: "BHD" },
        { amount: 1234, currency: "BHD" }
      );
      expect(result.comparable).toBe(true);
      expect(result.matches).toBe(true);
      expect(result.expectedMinor).toBe(1234);
    });
  });

  describe("amount mismatch (same currency, different amount)", () => {
    it("does not match when actual is too low", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 19.99, currency: "USD" },
        { amount: 999, currency: "USD" }
      );
      expect(result.comparable).toBe(true);
      expect(result.matches).toBe(false);
      expect(result.expectedMinor).toBe(1999);
      expect(result.actualMinor).toBe(999);
    });

    it("does not match when actual exceeds tolerance", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 19.99, currency: "USD" },
        {
          amount: 1999 + CREEM_AMOUNT_TOLERANCE_MINOR_UNITS + 1,
          currency: "USD",
        }
      );
      expect(result.comparable).toBe(true);
      expect(result.matches).toBe(false);
    });

    it("does not match when actual is 0 but expected is non-zero", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 10, currency: "USD" },
        { amount: 0, currency: "USD" }
      );
      expect(result.comparable).toBe(true);
      expect(result.matches).toBe(false);
    });
  });

  describe("currency mismatch", () => {
    it("returns not comparable when currencies differ", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 19.99, currency: "USD" },
        { amount: 1999, currency: "EUR" }
      );
      expect(result.comparable).toBe(false);
      expect(result.matches).toBe(false);
      expect(result.currency).toBe("USD");
      expect(result.actualCurrency).toBe("EUR");
    });

    it("is case-insensitive for currency comparison", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 10, currency: "usd" },
        { amount: 1000, currency: "USD" }
      );
      expect(result.comparable).toBe(true);
      expect(result.matches).toBe(true);
    });
  });

  describe("not comparable (invalid inputs)", () => {
    it("returns not comparable when expected amount is negative", () => {
      const result = evaluateCreemAmountMatch(
        { amount: -5, currency: "USD" },
        { amount: 500, currency: "USD" }
      );
      expect(result.comparable).toBe(false);
      expect(result.matches).toBe(false);
    });

    it("returns not comparable when expected amount is NaN", () => {
      const result = evaluateCreemAmountMatch(
        { amount: Number.NaN, currency: "USD" },
        { amount: 1000, currency: "USD" }
      );
      expect(result.comparable).toBe(false);
    });

    it("returns not comparable when actual amount is NaN", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 10, currency: "USD" },
        { amount: Number.NaN, currency: "USD" }
      );
      expect(result.comparable).toBe(false);
    });

    it("returns not comparable when actual amount is Infinity", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 10, currency: "USD" },
        { amount: Number.POSITIVE_INFINITY, currency: "USD" }
      );
      expect(result.comparable).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles zero expected and zero actual", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 0, currency: "USD" },
        { amount: 0, currency: "USD" }
      );
      expect(result.comparable).toBe(true);
      expect(result.matches).toBe(true);
    });

    it("handles empty currency strings (skips currency check)", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 10, currency: "" },
        { amount: 1000, currency: "" }
      );
      expect(result.comparable).toBe(true);
      expect(result.matches).toBe(true);
    });

    it("handles one empty currency (skips currency check)", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 10, currency: "USD" },
        { amount: 1000, currency: "" }
      );
      expect(result.comparable).toBe(true);
      expect(result.matches).toBe(true);
    });

    it("handles very large amounts", () => {
      const result = evaluateCreemAmountMatch(
        { amount: 999999.99, currency: "USD" },
        { amount: 99999999, currency: "USD" }
      );
      expect(result.comparable).toBe(true);
      expect(result.matches).toBe(true);
    });
  });
});

// ============================================
// shouldGrantAfterAmountCheck
// ============================================

describe("shouldGrantAfterAmountCheck", () => {
  const matchingResult: CreemAmountMatchResult = {
    comparable: true,
    matches: true,
    expectedMinor: 1999,
    actualMinor: 1999,
    currency: "USD",
    actualCurrency: "USD",
  };

  const mismatchResult: CreemAmountMatchResult = {
    comparable: true,
    matches: false,
    expectedMinor: 1999,
    actualMinor: 999,
    currency: "USD",
    actualCurrency: "USD",
  };

  const notComparableResult: CreemAmountMatchResult = {
    comparable: false,
    matches: false,
    expectedMinor: Number.NaN,
    actualMinor: 1000,
    currency: "USD",
    actualCurrency: "EUR",
  };

  describe("comparable + matches", () => {
    it("grants when enforce=true (match overrides enforcement)", () => {
      const decision = shouldGrantAfterAmountCheck(matchingResult, true);
      expect(decision.grant).toBe(true);
      expect(decision.reason).toBe("amount-match");
    });

    it("grants when enforce=false", () => {
      const decision = shouldGrantAfterAmountCheck(matchingResult, false);
      expect(decision.grant).toBe(true);
      expect(decision.reason).toBe("amount-match");
    });
  });

  describe("comparable + !matches (mismatch)", () => {
    it("grants with warning when enforce=false (soft gate)", () => {
      const decision = shouldGrantAfterAmountCheck(mismatchResult, false);
      expect(decision.grant).toBe(true);
      expect(decision.reason).toBe("mismatch-soft-gate-grant-with-warning");
    });

    it("rejects when enforce=true (hard reject)", () => {
      const decision = shouldGrantAfterAmountCheck(mismatchResult, true);
      expect(decision.grant).toBe(false);
      expect(decision.reason).toBe("mismatch-enforced-reject");
    });
  });

  describe("!comparable (cannot compare)", () => {
    it("always grants when enforce=true (cannot compare, never reject)", () => {
      const decision = shouldGrantAfterAmountCheck(notComparableResult, true);
      expect(decision.grant).toBe(true);
      expect(decision.reason).toBe("not-comparable-grant-with-warning");
    });

    it("always grants when enforce=false", () => {
      const decision = shouldGrantAfterAmountCheck(notComparableResult, false);
      expect(decision.grant).toBe(true);
      expect(decision.reason).toBe("not-comparable-grant-with-warning");
    });
  });
});
