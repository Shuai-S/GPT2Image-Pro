import { describe, expect, it } from "vitest";

import {
  checkGroupSelectable,
  GROUP_SELECTION_REJECTED_MESSAGES,
  ImageBackendGroupSelectionError,
  type SelectableGroupRow,
} from "./group-selection";

function makeGroup(
  overrides: Partial<SelectableGroupRow> = {}
): SelectableGroupRow {
  return {
    id: "group-1",
    isEnabled: true,
    isUserSelectable: true,
    metadata: null,
    ...overrides,
  };
}

describe("checkGroupSelectable", () => {
  it("allows a selectable group for a capable plan", () => {
    expect(
      checkGroupSelectable({
        group: makeGroup(),
        plan: "free",
        canSelectGroups: true,
        source: "request",
      })
    ).toEqual({ ok: true });
  });

  it("rejects a missing group", () => {
    expect(
      checkGroupSelectable({
        group: null,
        plan: "pro",
        canSelectGroups: true,
        source: "request",
      })
    ).toEqual({ ok: false, reason: "group_not_found" });
  });

  it("rejects a disabled group for every source", () => {
    const group = makeGroup({ isEnabled: false });
    for (const source of ["request", "preference", "api_key"] as const) {
      expect(
        checkGroupSelectable({
          group,
          plan: "pro",
          canSelectGroups: true,
          source,
        })
      ).toEqual({ ok: false, reason: "group_disabled" });
    }
  });

  it("rejects a plan below the group's minPlan for every source", () => {
    const group = makeGroup({ metadata: { minPlan: "pro" } });
    for (const source of ["request", "preference", "api_key"] as const) {
      expect(
        checkGroupSelectable({
          group,
          plan: "free",
          canSelectGroups: true,
          source,
        })
      ).toEqual({ ok: false, reason: "plan_below_min_plan" });
    }
  });

  it("allows a plan meeting minPlan", () => {
    expect(
      checkGroupSelectable({
        group: makeGroup({ metadata: { minPlan: "pro" } }),
        plan: "pro",
        canSelectGroups: true,
        source: "request",
      })
    ).toEqual({ ok: true });
  });

  it("treats invalid minPlan metadata as free", () => {
    expect(
      checkGroupSelectable({
        group: makeGroup({ metadata: { minPlan: "not-a-plan" } }),
        plan: "free",
        canSelectGroups: true,
        source: "request",
      })
    ).toEqual({ ok: true });
  });

  it("rejects non-user-selectable groups for explicit sources only", () => {
    const group = makeGroup({ isUserSelectable: false });
    expect(
      checkGroupSelectable({
        group,
        plan: "pro",
        canSelectGroups: true,
        source: "request",
      })
    ).toEqual({ ok: false, reason: "group_not_user_selectable" });
    expect(
      checkGroupSelectable({
        group,
        plan: "pro",
        canSelectGroups: true,
        source: "preference",
      })
    ).toEqual({ ok: false, reason: "group_not_user_selectable" });
    // api_key 来源是发 Key 者的管理约束,不要求 isUserSelectable。
    expect(
      checkGroupSelectable({
        group,
        plan: "pro",
        canSelectGroups: false,
        source: "api_key",
      })
    ).toEqual({ ok: true });
  });

  it("rejects when the plan lacks the backendGroups.select capability", () => {
    expect(
      checkGroupSelectable({
        group: makeGroup(),
        plan: "free",
        canSelectGroups: false,
        source: "request",
      })
    ).toEqual({ ok: false, reason: "plan_capability_missing" });
  });
});

describe("ImageBackendGroupSelectionError", () => {
  it("carries the rejection code and mapped message", () => {
    const error = new ImageBackendGroupSelectionError("group_locked_by_key");
    expect(error.code).toBe("group_locked_by_key");
    expect(error.message).toBe(
      GROUP_SELECTION_REJECTED_MESSAGES.group_locked_by_key
    );
    expect(error.name).toBe("ImageBackendGroupSelectionError");
  });

  it("has a message for every rejection code", () => {
    for (const message of Object.values(GROUP_SELECTION_REJECTED_MESSAGES)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
