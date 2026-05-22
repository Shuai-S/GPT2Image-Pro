import { describe, expect, it } from "vitest";

import {
  AUTO_IMAGE_SIZE,
  getImageCreditCostBreakdown,
  IMAGE_1K_BASE_SIZE,
  IMAGE_RESOLUTION_PRESETS,
  isOneKImageSize,
  validateImageSize,
} from "../../apps/web/src/features/image-generation/resolution";

describe("image resolution", () => {
  it("accepts auto size", () => {
    expect(validateImageSize(AUTO_IMAGE_SIZE)).toEqual({
      auto: true,
      dimensions: null,
      valid: true,
    });
  });

  it("keeps validating explicit dimensions", () => {
    expect(validateImageSize("1024x1024")).toEqual({
      auto: false,
      dimensions: { width: 1024, height: 1024 },
      valid: true,
    });
    expect(validateImageSize("433x1360").valid).toBe(false);
  });

  it("exposes auto as a UI preset", () => {
    expect(IMAGE_RESOLUTION_PRESETS[0]?.value).toBe(AUTO_IMAGE_SIZE);
  });

  it("uses 1248 as the 1K routing baseline", () => {
    expect(IMAGE_RESOLUTION_PRESETS[1]?.value).toBe(IMAGE_1K_BASE_SIZE);
    expect(isOneKImageSize("1248x1248")).toBe(true);
    expect(isOneKImageSize("1248x704")).toBe(true);
    expect(isOneKImageSize("1536x1024")).toBe(false);
    expect(isOneKImageSize(AUTO_IMAGE_SIZE)).toBe(false);
  });

  it("can remove moderation costs when moderation is disabled", () => {
    const withModeration = getImageCreditCostBreakdown("1024x1024", {
      imageModerationCount: 2,
    });
    const withoutModeration = getImageCreditCostBreakdown("1024x1024", {
      textModerationCount: 0,
      imageModerationCount: 0,
    });

    expect(withModeration.moderationOnlyCredits).toBeGreaterThan(0);
    expect(withoutModeration.moderationOnlyCredits).toBe(0);
    expect(withoutModeration.totalCredits).toBeLessThan(
      withModeration.totalCredits
    );
  });
});
