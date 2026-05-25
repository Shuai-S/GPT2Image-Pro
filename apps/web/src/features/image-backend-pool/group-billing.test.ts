import { describe, expect, it } from "vitest";

import {
  getEffectiveBillingMultiplierForSelectedGroup,
  getGroupBillingMultiplier,
  normalizeGroupBillingMultiplier,
} from "./group-billing";

describe("image backend group billing", () => {
  it("normalizes billing multipliers", () => {
    expect(normalizeGroupBillingMultiplier(undefined)).toBe(1);
    expect(normalizeGroupBillingMultiplier("2.345")).toBe(2.35);
    expect(normalizeGroupBillingMultiplier(0)).toBe(1);
    expect(normalizeGroupBillingMultiplier(-1)).toBe(1);
    expect(normalizeGroupBillingMultiplier(200)).toBe(100);
    expect(normalizeGroupBillingMultiplier(0.001)).toBe(0.01);
  });

  it("reads current and legacy metadata keys", () => {
    expect(getGroupBillingMultiplier({ billingMultiplier: 1.5 })).toBe(1.5);
    expect(getGroupBillingMultiplier({ creditMultiplier: 2 })).toBe(2);
    expect(getGroupBillingMultiplier({ costMultiplier: "3" })).toBe(3);
  });

  it("uses only the selected parent group multiplier for nested dispatch", () => {
    expect(
      getEffectiveBillingMultiplierForSelectedGroup({
        selectedGroupMetadata: { billingMultiplier: 2 },
        selectedMemberGroupMetadata: { billingMultiplier: 5 },
      })
    ).toBe(2);
  });
});
