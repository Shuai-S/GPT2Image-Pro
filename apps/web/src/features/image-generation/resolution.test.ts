import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_MODEL,
  fitImageDimensionsToValidSize,
  getImageBaseCredits,
  getImageCreditCostBreakdown,
  getImageModel,
  IMAGE_1024_BASE_PIXELS,
  IMAGE_DIMENSION_STEP,
  isImageModel,
  isImageSizeWithinPixelRange,
  isValidImageDimension,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MIN_IMAGE_DIMENSION,
  MIN_IMAGE_PIXELS,
  normalizeImageModel,
  parseImageSize,
  roundUpCreditAmount,
  validateImageSize,
} from "./resolution";

describe("image resolution credit pricing", () => {
  it("keeps legacy default anchor prices for 1024 square and 4K", () => {
    expect(
      getImageCreditCostBreakdown("1024x1024", {
        textModerationCount: 0,
      }).baseCredits
    ).toBe(1.27);
    expect(
      getImageCreditCostBreakdown("3840x2160", {
        textModerationCount: 0,
      }).baseCredits
    ).toBe(10);
  });

  it("linearly interpolates between configured 1024 square and 4K prices", () => {
    const pricing = { base1024Credits: 2, base4kCredits: 20 };
    const halfwayPixels = (IMAGE_1024_BASE_PIXELS + MAX_IMAGE_PIXELS) / 2;

    expect(getImageBaseCredits(IMAGE_1024_BASE_PIXELS, pricing)).toBe(2);
    expect(getImageBaseCredits(MAX_IMAGE_PIXELS, pricing)).toBe(20);
    expect(getImageBaseCredits(halfwayPixels, pricing)).toBe(11);
  });

  it("clamps outside the configured anchor range", () => {
    const pricing = { base1024Credits: 2, base4kCredits: 20 };

    expect(getImageBaseCredits(512 * 512, pricing)).toBe(2);
    expect(getImageBaseCredits(MAX_IMAGE_PIXELS * 2, pricing)).toBe(20);
  });

  it("charges the 1024 base price for the legal lower-bound size", () => {
    const pricing = { base1024Credits: 2, base4kCredits: 20 };
    const lowerBoundSize = "1024x640";

    expect(validateImageSize(lowerBoundSize)).toMatchObject({
      valid: true,
      dimensions: { width: 1024, height: 640 },
    });
    expect(1024 * 640).toBe(MIN_IMAGE_PIXELS);
    expect(
      getImageCreditCostBreakdown(lowerBoundSize, {
        basePricing: pricing,
        textModerationCount: 0,
      }).baseCredits
    ).toBe(2);
  });

  it("checks force web eligibility by configured pixel range", () => {
    const minPixels = 660_000;
    const maxPixels = 2_000_000;

    expect(isImageSizeWithinPixelRange("1024x1024", minPixels, maxPixels)).toBe(
      true
    );
    expect(isImageSizeWithinPixelRange("2000x1000", minPixels, maxPixels)).toBe(
      true
    );
    expect(isImageSizeWithinPixelRange("3840x2160", minPixels, maxPixels)).toBe(
      false
    );
    expect(isImageSizeWithinPixelRange("512x512", minPixels, maxPixels)).toBe(
      false
    );
    expect(isImageSizeWithinPixelRange("auto", minPixels, maxPixels)).toBe(
      false
    );
  });
});

describe("image model resolution", () => {
  it("normalizes legacy / blank models away", () => {
    expect(normalizeImageModel(undefined)).toBeUndefined();
    expect(normalizeImageModel("  ")).toBeUndefined();
    expect(normalizeImageModel("gpt-image-1")).toBeUndefined();
    expect(normalizeImageModel(" gpt-image-2 ")).toBe("gpt-image-2");
  });

  it("identifies image models by prefix", () => {
    expect(isImageModel("gpt-image-2")).toBe(true);
    expect(isImageModel("gpt-image-1")).toBe(false); // 经 normalize 视为 legacy
    expect(isImageModel("gpt-4o")).toBe(false);
  });

  it("getImageModel passes through image models, defaults for legacy/blank, null for non-image", () => {
    expect(getImageModel("gpt-image-2")).toBe("gpt-image-2");
    expect(getImageModel(undefined)).toBe(DEFAULT_IMAGE_MODEL);
    expect(getImageModel("gpt-image-1")).toBe(DEFAULT_IMAGE_MODEL);
    expect(getImageModel("gpt-4o")).toBeNull();
    expect(getImageModel(undefined, "gpt-image-3")).toBe("gpt-image-3");
  });
});

describe("parseImageSize", () => {
  it("parses WIDTHxHEIGHT and rejects malformed strings", () => {
    expect(parseImageSize("1024x768")).toEqual({ width: 1024, height: 768 });
    expect(parseImageSize(" 1024X768 ")).toEqual({ width: 1024, height: 768 });
    expect(parseImageSize("auto")).toBeNull();
    expect(parseImageSize("1024")).toBeNull();
    expect(parseImageSize("12x34x56")).toBeNull();
  });
});

describe("fitImageDimensionsToValidSize", () => {
  it("snaps results to the dimension step and stays within bounds", () => {
    for (const dimensions of [
      { width: 100, height: 100 }, // 远低于最小像素，需生长
      { width: 8000, height: 4000 }, // 超过最大像素与最大边，需收缩
      { width: 4000, height: 256 }, // 超出 3:1 宽高比，需收敛
    ]) {
      const fitted = fitImageDimensionsToValidSize(dimensions);
      expect(fitted.width % IMAGE_DIMENSION_STEP).toBe(0);
      expect(fitted.height % IMAGE_DIMENSION_STEP).toBe(0);
      expect(fitted.width).toBeGreaterThanOrEqual(MIN_IMAGE_DIMENSION);
      expect(fitted.height).toBeGreaterThanOrEqual(MIN_IMAGE_DIMENSION);
      expect(fitted.width).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
      expect(fitted.height).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
      expect(fitted.width * fitted.height).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
      expect(isValidImageDimension(fitted.width)).toBe(true);
      expect(isValidImageDimension(fitted.height)).toBe(true);
    }
  });

  it("grows an undersized square up to the minimum pixel budget", () => {
    const fitted = fitImageDimensionsToValidSize({ width: 100, height: 100 });
    expect(fitted.width * fitted.height).toBeGreaterThanOrEqual(
      MIN_IMAGE_PIXELS
    );
  });
});

describe("roundUpCreditAmount", () => {
  it("ceils to two decimals without float drift", () => {
    expect(roundUpCreditAmount(1.271)).toBe(1.28);
    expect(roundUpCreditAmount(1.27)).toBe(1.27);
    expect(roundUpCreditAmount(0.1 + 0.2)).toBe(0.3);
  });
});
