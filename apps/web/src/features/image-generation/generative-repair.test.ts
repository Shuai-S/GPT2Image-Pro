/**
 * 生成式修复纯函数单测（DB-free）：修复分辨率与最终放大尺寸计算。
 * 不测 generativeRepairImage 编排（依赖 sharp/后端回调），只测尺寸决策与边界。
 */
import { describe, expect, it } from "vitest";

import {
  finalDimensions,
  REPAIR_LONG_EDGE,
  repairDimensions,
} from "./generative-repair";

describe("repairDimensions", () => {
  it("大图缩到甜点分辨率(较长边=REPAIR_LONG_EDGE),保持比例", () => {
    const p = repairDimensions(2880, 2880);
    expect(Math.max(p.rw, p.rh)).toBe(REPAIR_LONG_EDGE);
    expect(p.rw).toBe(p.rh); // 方形保持方形
  });

  it("竖图保持比例,较长边=甜点,尺寸对齐 16", () => {
    const p = repairDimensions(1024, 1536);
    expect(Math.max(p.rw, p.rh)).toBe(REPAIR_LONG_EDGE);
    expect(p.rh).toBeGreaterThan(p.rw); // 竖图
    expect(p.rw % 16).toBe(0);
    expect(p.rh % 16).toBe(0);
  });

  it("小图也放大到甜点(源小于甜点时)", () => {
    const p = repairDimensions(512, 512);
    expect(Math.max(p.rw, p.rh)).toBe(REPAIR_LONG_EDGE);
  });

  it("非法尺寸回退甜点方形", () => {
    expect(repairDimensions(0, 100)).toEqual({
      rw: REPAIR_LONG_EDGE,
      rh: REPAIR_LONG_EDGE,
    });
  });
});

describe("finalDimensions", () => {
  it("把修复尺寸等比放大到目标较长边", () => {
    const p = finalDimensions(1280, 1280, 2880);
    expect(Math.max(p.fw, p.fh)).toBe(2880);
    expect(p.fw).toBe(p.fh);
  });

  it("竖图放大保持比例", () => {
    const p = finalDimensions(848, 1280, 2880);
    expect(Math.max(p.fw, p.fh)).toBe(2880);
    expect(p.fw).toBeLessThan(p.fh);
    // 比例保持
    expect(p.fw / p.fh).toBeCloseTo(848 / 1280, 2);
  });
});
