import { describe, expect, it } from "vitest";
import {
  applyVideoBackendMultiplier,
  DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND,
  getVideoCreditCost,
  resolveVideoModelMultiplier,
} from "./video-pricing";

describe("getVideoCreditCost", () => {
  it("默认 30/秒", () => {
    expect(DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND).toBe(30);
    expect(getVideoCreditCost({ durationSeconds: 8 })).toBe(240);
    expect(getVideoCreditCost({ durationSeconds: 5 })).toBe(150);
  });

  it("自定义基价 + 模型倍率", () => {
    expect(
      getVideoCreditCost({
        durationSeconds: 10,
        basePerSecond: 30,
        modelMultiplier: 1.5,
      })
    ).toBe(450);
    expect(
      getVideoCreditCost({
        durationSeconds: 4,
        basePerSecond: 25,
        modelMultiplier: 2,
      })
    ).toBe(200);
  });

  it("向上取 2 位小数", () => {
    expect(
      getVideoCreditCost({
        durationSeconds: 5,
        basePerSecond: 30,
        modelMultiplier: 1.333,
      })
    ).toBe(199.95);
  });

  it("非法/缺省回退默认", () => {
    expect(
      getVideoCreditCost({
        durationSeconds: 8,
        basePerSecond: 0,
        modelMultiplier: -1,
      })
    ).toBe(240);
    expect(getVideoCreditCost({ durationSeconds: 0 })).toBe(0);
  });
});

describe("applyVideoBackendMultiplier", () => {
  it("叠加后端倍率,向上取整,缺省/非法回退 1", () => {
    // 倍率 1：仅把 2 位小数向上取整成整数。
    expect(applyVideoBackendMultiplier(240, 1)).toBe(240);
    expect(applyVideoBackendMultiplier(199.95, 1)).toBe(200);
    // 正常倍率。
    expect(applyVideoBackendMultiplier(240, 1.5)).toBe(360);
    // 缺省/非法/非正数回退 1。
    expect(applyVideoBackendMultiplier(240, null)).toBe(240);
    expect(applyVideoBackendMultiplier(240, 0)).toBe(240);
    expect(applyVideoBackendMultiplier(240, -2)).toBe(240);
    // 非负下限。
    expect(applyVideoBackendMultiplier(0, 2)).toBe(0);
  });

  it("与扣费侧口径一致(getVideoCreditCost → applyVideoBackendMultiplier)", () => {
    const base = getVideoCreditCost({
      durationSeconds: 8,
      basePerSecond: 30,
      modelMultiplier: 1.5,
    });
    expect(applyVideoBackendMultiplier(base, 2)).toBe(720);
  });
});

describe("resolveVideoModelMultiplier", () => {
  it("从配置取倍率,缺省/非法回退 1", () => {
    const map = { sora2: 2, "veo31-fast": 0.5, bad: -3 };
    expect(resolveVideoModelMultiplier("sora2", map)).toBe(2);
    expect(resolveVideoModelMultiplier("veo31-fast", map)).toBe(0.5);
    expect(resolveVideoModelMultiplier("bad", map)).toBe(1);
    expect(resolveVideoModelMultiplier("unknown", map)).toBe(1);
    expect(resolveVideoModelMultiplier("sora2", null)).toBe(1);
    expect(resolveVideoModelMultiplier(null, map)).toBe(1);
  });
});
