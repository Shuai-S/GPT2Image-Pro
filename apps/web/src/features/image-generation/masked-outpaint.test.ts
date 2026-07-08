/**
 * 掩码顺序外绘纯函数单测（DB-free）：切块规划、保留区、待补区填黑与平移最小误差对齐。
 * 不测 maskedOutpaintImage 编排（依赖 sharp/后端回调），只测几何/保留区/填黑/对齐正确性与边界。
 */
import { describe, expect, it } from "vitest";

import {
  blackenNewRegion,
  findBestOffset,
  OUTPAINT_MAX_WORKING,
  OUTPAINT_TILE,
  type OutpaintTile,
  planOutpaintTiles,
  slideAlignEditedTile,
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

describe("findBestOffset", () => {
  const tile = (over: Partial<OutpaintTile>): OutpaintTile => ({
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    col: 0,
    row: 0,
    ...over,
  });

  it("恢复已知平移：edited 相对 committed 右移 1px → dx=1", () => {
    // 4px 一行,left=2(重叠 x0,1)。committed 重叠=[10,20];edited=[20,99,..],
    // 在 dx=1 时 edited(x-1) 使重叠 x1→edited(0)=20 精确对上 committed(20) → 误差 0。
    const canvas = Buffer.from([10, 10, 10, 20, 20, 20, 0, 0, 0, 0, 0, 0]);
    const edited = Buffer.from([
      20, 20, 20, 99, 99, 99, 50, 50, 50, 50, 50, 50,
    ]);
    const off = findBestOffset(
      canvas,
      4,
      tile({ w: 4, col: 1 }),
      edited,
      2,
      0,
      2,
      1
    );
    expect(off).toEqual({ dx: 1, dy: 0 });
  });

  it("无重叠(首块)→偏移(0,0)", () => {
    const canvas = Buffer.from([0, 0, 0]);
    const edited = Buffer.from([9, 9, 9]);
    expect(findBestOffset(canvas, 1, tile({ w: 1 }), edited, 0, 0)).toEqual({
      dx: 0,
      dy: 0,
    });
  });
});

describe("slideAlignEditedTile", () => {
  const solid = (n: number, v: number) => Buffer.from(new Array(n * 3).fill(v));
  const tile = (over: Partial<OutpaintTile>): OutpaintTile => ({
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    col: 0,
    row: 0,
    ...over,
  });

  it("首块(无重叠)：整块写回 edited", () => {
    const canvas = solid(3, 0);
    const edited = solid(3, 50);
    slideAlignEditedTile(canvas, 3, tile({ w: 3 }), edited, 0, 0);
    expect([canvas[0], canvas[3], canvas[6]]).toEqual([50, 50, 50]);
  });

  it("对齐偏移=0：重叠区(committed)保持不动、新区写 edited", () => {
    // 4px 一行,left=2。重叠 committed=[10,20] 与 edited 重叠[10,20]一致 → 最佳偏移 0;
    // 新区 x2,3 写 edited(30,40),重叠 x0,1 保持 committed(10,20)。
    const canvas = Buffer.from([
      10, 10, 10, 20, 20, 20, 77, 77, 77, 88, 88, 88,
    ]);
    const edited = Buffer.from([
      10, 10, 10, 20, 20, 20, 30, 30, 30, 40, 40, 40,
    ]);
    slideAlignEditedTile(canvas, 4, tile({ w: 4, col: 1 }), edited, 2, 0);
    expect([canvas[0], canvas[3], canvas[6], canvas[9]]).toEqual([
      10, 20, 30, 40,
    ]);
  });
});

describe("blackenNewRegion", () => {
  const solid = (n: number, v: number) => Buffer.from(new Array(n * 3).fill(v));
  const tile = (over: Partial<OutpaintTile>): OutpaintTile => ({
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    col: 0,
    row: 0,
    ...over,
  });

  it("左外绘块：左列(committed)保留、右侧待补区填黑", () => {
    // 1 行 3px，left=1：x=0 保留(50)、x≥1 填黑(0)。
    const raw = solid(3, 50);
    blackenNewRegion(raw, tile({ w: 3, col: 1 }), 1, 0);
    expect([raw[0], raw[3], raw[6]]).toEqual([50, 0, 0]);
  });

  it("内部块：只填待补角(x≥left&&y≥top)、L 形重叠边保留", () => {
    // 2×2，left=1,top=1：仅 (1,1) 填黑，(0,0)(1,0)(0,1) 保留。
    const raw = solid(4, 50);
    blackenNewRegion(raw, tile({ w: 2, h: 2, col: 1, row: 1 }), 1, 1);
    expect(raw[0]).toBe(50); // (y0,x0) 保留
    expect(raw[3]).toBe(50); // (y0,x1) 上重叠保留
    expect(raw[6]).toBe(50); // (y1,x0) 左重叠保留
    expect(raw[9]).toBe(0); // (y1,x1) 待补区填黑
  });
});
