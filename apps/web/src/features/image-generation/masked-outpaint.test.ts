/**
 * 掩码顺序外绘纯函数单测（DB-free）：切块规划与每块保留区计算。
 * 不测 maskedOutpaintImage 编排（依赖 sharp/后端回调），只测几何/保留区正确性与边界。
 */
import { describe, expect, it } from "vitest";

import {
  OUTPAINT_MAX_WORKING,
  OUTPAINT_TILE,
  planOutpaintTiles,
  tileKeepInset,
} from "./masked-outpaint";

describe("planOutpaintTiles", () => {
  it("目标 ≤ 块边：单块，块尺寸=目标", () => {
    const p = planOutpaintTiles(800, 800);
    expect(p.cols).toBe(1);
    expect(p.rows).toBe(1);
    expect(p.tiles).toHaveLength(1);
    expect(p.tileW).toBe(800);
  });

  it("封顶工作分辨率(OUTPAINT_MAX_WORKING)→ 2×2=4 块(控成本;更大目标外层超分补足)", () => {
    // 特性实际在 ≤OUTPAINT_MAX_WORKING 的工作分辨率上切块,故为方形时 2×2=4 块。
    const p = planOutpaintTiles(OUTPAINT_MAX_WORKING, OUTPAINT_MAX_WORKING);
    expect(p.tileW).toBe(OUTPAINT_TILE);
    expect(p.cols).toBe(2);
    expect(p.rows).toBe(2);
    expect(p.tiles).toHaveLength(4);
    const xs = [...new Set(p.tiles.map((t) => t.x))].sort((a, b) => a - b);
    expect(xs[0]).toBe(0);
    expect(xs[xs.length - 1]).toBe(OUTPAINT_MAX_WORKING - OUTPAINT_TILE);
  });

  it("相邻块有正重叠（步进 < 块边）", () => {
    const p = planOutpaintTiles(OUTPAINT_MAX_WORKING, OUTPAINT_MAX_WORKING);
    const xs = [...new Set(p.tiles.map((t) => t.x))].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const current = xs[i];
      const previous = xs[i - 1];
      if (current === undefined || previous === undefined) {
        throw new Error("expected adjacent x coordinates");
      }
      const overlap = OUTPAINT_TILE - (current - previous);
      expect(overlap).toBeGreaterThan(0);
    }
  });
});

describe("tileKeepInset", () => {
  it("首块(0,0)无保留区（全部重绘）", () => {
    const p = planOutpaintTiles(2880, 2880);
    const t0 = p.tiles.find((t) => t.col === 0 && t.row === 0);
    if (!t0) throw new Error("expected top-left tile");
    expect(tileKeepInset(p, t0)).toEqual({ left: 0, top: 0 });
  });

  it("非首列块左侧有保留区(=与左邻重叠)", () => {
    const p = planOutpaintTiles(2880, 2880);
    const t = p.tiles.find((x) => x.col === 1 && x.row === 0);
    if (!t) throw new Error("expected second column tile");
    const inset = tileKeepInset(p, t);
    expect(inset.left).toBeGreaterThan(0);
    expect(inset.top).toBe(0);
    // 保留区不吞整块
    expect(inset.left).toBeLessThan(p.tileW);
  });

  it("内部块左、上都有保留区", () => {
    const p = planOutpaintTiles(2880, 2880);
    const t = p.tiles.find((x) => x.col === 2 && x.row === 2);
    if (!t) throw new Error("expected inner tile");
    const inset = tileKeepInset(p, t);
    expect(inset.left).toBeGreaterThan(0);
    expect(inset.top).toBeGreaterThan(0);
  });
});
