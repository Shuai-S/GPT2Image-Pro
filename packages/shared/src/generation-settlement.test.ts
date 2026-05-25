import { describe, expect, it } from "vitest";

import {
  getFailedGenerationTargetCredits,
  getFailedGenerationTargetCreditsFromMetadata,
} from "./generation-settlement";

describe("failed generation settlement", () => {
  it("keeps only moderation costs for non-moderation generation failures", () => {
    for (const reason of [
      "generation_error",
      "storage_error",
      "settlement_error",
    ] as const) {
      expect(
        getFailedGenerationTargetCredits({
          reason,
          moderationFailureCredits: 1.31,
          moderationOnlyCredits: 0.04,
        })
      ).toBe(0.04);
    }
  });

  it("uses moderation failure policy only for moderation blocks", () => {
    expect(
      getFailedGenerationTargetCredits({
        reason: "moderation_block",
        moderationFailureCredits: 1.31,
        moderationOnlyCredits: 0.04,
      })
    ).toBe(1.31);
  });

  it("does not charge when moderation service fails before completing moderation", () => {
    expect(
      getFailedGenerationTargetCredits({
        reason: "moderation_error",
        moderationFailureCredits: 1.31,
        moderationOnlyCredits: 0.04,
      })
    ).toBe(0);
  });

  it("reads moderation-only timeout settlement from generation metadata", () => {
    expect(
      getFailedGenerationTargetCreditsFromMetadata({
        reason: "generation_error",
        chargedCredits: 1.31,
        metadata: {
          moderationFailureCredits: 1.31,
          creditCost: {
            moderationOnlyCredits: 0.04,
          },
        },
      })
    ).toBe(0.04);
  });

  it("uses multiplied moderation-only settlement from generation metadata", () => {
    expect(
      getFailedGenerationTargetCreditsFromMetadata({
        reason: "generation_error",
        chargedCredits: 3,
        metadata: {
          billingMultiplier: 2,
          moderationFailureCredits: 3,
          creditCost: {
            moderationOnlyCredits: 0.08,
          },
        },
      })
    ).toBe(0.08);
  });

  it("keeps old timeout rows compatible when metadata has no cost breakdown", () => {
    expect(
      getFailedGenerationTargetCreditsFromMetadata({
        reason: "generation_error",
        chargedCredits: 1.31,
        metadata: {},
      })
    ).toBe(1.31);
  });
});
