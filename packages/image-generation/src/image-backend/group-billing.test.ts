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

  it("uses the selected group multiplier when dispatch stays in that group", () => {
    expect(
      getEffectiveBillingMultiplierForSelectedGroup({
        selectedGroupId: "parent",
        selectedGroupMetadata: { billingMultiplier: 2 },
        selectedMemberGroupId: "parent",
        selectedMemberGroupMetadata: { billingMultiplier: 5 },
      })
    ).toBe(2);
  });

  it("combines parent and child group multipliers for nested dispatch", () => {
    expect(
      getEffectiveBillingMultiplierForSelectedGroup({
        selectedGroupId: "parent",
        selectedGroupMetadata: { billingMultiplier: 2 },
        selectedMemberGroupId: "child",
        selectedMemberGroupMetadata: { billingMultiplier: 1.5 },
      })
    ).toBe(3);
  });

  it("does not double count child metadata when group ids are unavailable", () => {
    expect(
      getEffectiveBillingMultiplierForSelectedGroup({
        selectedGroupMetadata: { billingMultiplier: 2 },
        selectedMemberGroupMetadata: { billingMultiplier: 1.5 },
      })
    ).toBe(2);
  });
});
