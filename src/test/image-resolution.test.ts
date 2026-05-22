import { describe, expect, it } from "vitest";

import {
  AUTO_IMAGE_SIZE,
  IMAGE_RESOLUTION_PRESETS,
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
});
