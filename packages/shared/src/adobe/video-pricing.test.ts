import { describe, expect, it } from "vitest";
import {
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
