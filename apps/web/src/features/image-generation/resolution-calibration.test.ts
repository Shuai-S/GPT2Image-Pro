import { describe, expect, it } from "vitest";

import { shouldSuperResolve } from "./resolution-calibration";

describe("shouldSuperResolve（超分触发阈值：实际较长边 < 目标 2/3）", () => {
  it("实际明显偏小（1024 目标，512 实际）→ 触发", () => {
    expect(
      shouldSuperResolve(
        { width: 512, height: 512 },
        { width: 1024, height: 1024 }
      )
    ).toBe(true);
  });

  it("恰好等于 2/3 → 不触发（严格小于）", () => {
    // 2/3 × 1536 = 1024
    expect(
      shouldSuperResolve(
        { width: 1024, height: 1024 },
        { width: 1536, height: 1536 }
      )
    ).toBe(false);
  });

  it("略低于 2/3 → 触发", () => {
    expect(
      shouldSuperResolve(
        { width: 1000, height: 1000 },
        { width: 1536, height: 1536 }
      )
    ).toBe(true);
  });

  it("尺寸达标（实际≥目标）→ 不触发", () => {
    expect(
      shouldSuperResolve(
        { width: 1024, height: 1024 },
        { width: 1024, height: 1024 }
      )
    ).toBe(false);
  });

  it("按较长边判定：1024 目标、长边 768 的非方图 → 不触发（768 > 683）", () => {
    expect(
      shouldSuperResolve(
        { width: 768, height: 512 },
        { width: 1024, height: 1024 }
      )
    ).toBe(false);
  });

  it("4K 目标、2000 实际（< 2731）→ 触发", () => {
    expect(
      shouldSuperResolve(
        { width: 2000, height: 2000 },
        { width: 4096, height: 4096 }
      )
    ).toBe(true);
  });

  it("缺失实际或目标 → 不触发", () => {
    expect(shouldSuperResolve(null, { width: 1024, height: 1024 })).toBe(false);
    expect(shouldSuperResolve({ width: 512, height: 512 }, null)).toBe(false);
  });

  it("零或负尺寸 → 不触发", () => {
    expect(
      shouldSuperResolve({ width: 0, height: 0 }, { width: 1024, height: 1024 })
    ).toBe(false);
  });
});
