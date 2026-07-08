/**
 * edit-reference-limits 单测。
 *
 * 职责：锁定图生图参考图最终上限取套餐与系统设置交集。
 * 使用方：Vitest 测试套件。
 * 关键依赖：edit-reference-limits.ts 纯函数。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingNumber: vi.fn(),
}));

import { getEffectiveImageEditMaxReferenceImages } from "./edit-reference-limits";

describe("getEffectiveImageEditMaxReferenceImages", () => {
  it("uses the stricter runtime image edit reference limit", () => {
    expect(getEffectiveImageEditMaxReferenceImages(16, 4)).toBe(4);
  });

  it("does not raise a stricter plan limit", () => {
    expect(getEffectiveImageEditMaxReferenceImages(3, 4)).toBe(3);
  });

  it("falls back to 1 for invalid values", () => {
    expect(
      getEffectiveImageEditMaxReferenceImages(Number.NaN, Number.NaN)
    ).toBe(1);
  });
});
