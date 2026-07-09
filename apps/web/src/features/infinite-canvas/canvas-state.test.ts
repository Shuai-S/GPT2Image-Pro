import { describe, expect, it } from "vitest";
import {
  addCanvasEdge,
  addCanvasNode,
  computeVisibleNodes,
  computeVisibleWorldRect,
  createCanvasNode,
  createEmptyCanvasState,
  fitViewportToNodes,
  getInputNodesForNode,
  isNodeVisibleInRect,
  moveCanvasNode,
  parseCanvasState,
  removeCanvasNodes,
  screenPointToWorld,
  serializeCanvasState,
  VIEWPORT_CULL_MARGIN,
} from "./canvas-state";

/**
 * 视口裁剪测试用的默认视口(zoom=1 且无平移)。
 */
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

/**
 * 无限画布状态纯函数测试。
 *
 * 使用方：Vitest。
 * 关键依赖：canvas-state 纯函数，不依赖数据库或浏览器 DOM。
 */

describe("infinite canvas state", () => {
  it("adds nodes and keeps connected inputs in edge order", () => {
    let state = createEmptyCanvasState("Test");
    const prompt = createCanvasNode("prompt", { x: 0, y: 0 });
    const image = createCanvasNode("image", { x: 0, y: 240 });
    const generator = createCanvasNode("generator", { x: 420, y: 0 });

    state = addCanvasNode(
      addCanvasNode(addCanvasNode(state, prompt), image),
      generator
    );
    state = addCanvasEdge(state, prompt.id, generator.id);
    state = addCanvasEdge(state, image.id, generator.id);

    expect(
      getInputNodesForNode(state, generator.id).map((node) => node.id)
    ).toEqual([prompt.id, image.id]);
  });

  it("removes edges when a node is deleted", () => {
    let state = createEmptyCanvasState("Test");
    const a = createCanvasNode("prompt", { x: 0, y: 0 });
    const b = createCanvasNode("generator", { x: 300, y: 0 });

    state = addCanvasNode(addCanvasNode(state, a), b);
    state = addCanvasEdge(state, a.id, b.id);
    state = removeCanvasNodes(state, [a.id]);

    expect(state.nodes).toHaveLength(1);
    expect(state.edges).toHaveLength(0);
  });

  it("translates screen coordinates into world coordinates", () => {
    expect(
      screenPointToWorld({ x: 120, y: 80 }, { x: 20, y: -20, zoom: 2 })
    ).toEqual({ x: 50, y: 50 });
  });

  it("moves nodes in world coordinates", () => {
    let state = createEmptyCanvasState("Test");
    const node = createCanvasNode("prompt", { x: 10, y: 20 });

    state = addCanvasNode(state, node);
    state = moveCanvasNode(state, node.id, { x: 5, y: -7 });

    expect(state.nodes[0]).toMatchObject({ x: 15, y: 13 });
  });

  it("validates exported canvas JSON before import", () => {
    const state = createEmptyCanvasState("Test");
    const parsed = parseCanvasState(JSON.parse(serializeCanvasState(state)));
    const invalid = parseCanvasState({ version: 1, title: "Bad" });

    expect(parsed.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it("creates loop nodes with bounded batch fields", () => {
    const loop = createCanvasNode("loop", { x: 20, y: 30 });
    const parsed = parseCanvasState(
      JSON.parse(
        serializeCanvasState({
          ...createEmptyCanvasState("Test"),
          nodes: [loop],
        })
      )
    );

    expect(loop).toMatchObject({
      kind: "loop",
      loopCount: 4,
      size: "1024x1024",
    });
    expect(parsed.success).toBe(true);
  });

  it("fits viewport around existing nodes", () => {
    const nodes = [
      createCanvasNode("prompt", { x: 0, y: 0 }),
      createCanvasNode("output", { x: 800, y: 500 }),
    ];

    const viewport = fitViewportToNodes(nodes, { width: 1200, height: 800 });

    expect(viewport.zoom).toBeGreaterThan(0.2);
    expect(Number.isFinite(viewport.x)).toBe(true);
    expect(Number.isFinite(viewport.y)).toBe(true);
  });
});

describe("canvas viewport AABB culling (F-P2-1)", () => {
  const board = { width: 1000, height: 800 };

  it("returns null visible rect when boardSize is zero (first-frame fallback)", () => {
    expect(computeVisibleWorldRect(DEFAULT_VIEWPORT, { width: 0, height: 0 })).toBeNull();
  });

  it("computes visible world rect accounting for zoom and cull margin", () => {
    // viewport x=100,y=50 把画布向右下平移;zoom=2 让屏幕 1000x800 覆盖世界 500x400。
    const rect = computeVisibleWorldRect(
      { x: 100, y: 50, zoom: 2 },
      board
    );
    expect(rect).not.toBeNull();
    if (!rect) return;
    // minX = -100/2 - margin = -50 - 200 = -250
    expect(rect.minX).toBe(-100 / 2 - VIEWPORT_CULL_MARGIN);
    // maxX = (-100+1000)/2 + margin = 450 + 200 = 650
    expect(rect.maxX).toBe((-100 + 1000) / 2 + VIEWPORT_CULL_MARGIN);
    expect(rect.minY).toBe(-50 / 2 - VIEWPORT_CULL_MARGIN);
    expect(rect.maxY).toBe((-50 + 800) / 2 + VIEWPORT_CULL_MARGIN);
  });

  it("includes a node fully inside the visible world rect", () => {
    const node = createCanvasNode("prompt", { x: 100, y: 60 });
    const visible = computeVisibleNodes([node], DEFAULT_VIEWPORT, board);
    expect(visible).toHaveLength(1);
  });

  it("excludes a node far outside the visible world rect", () => {
    // 视口默认覆盖世界 0..1000 / 0..800(+margin),节点在 x=5000 完全在视口外。
    const farNode = createCanvasNode("prompt", { x: 5000, y: 5000 });
    const visible = computeVisibleNodes([farNode], DEFAULT_VIEWPORT, board);
    expect(visible).toHaveLength(0);
  });

  it("excludes a node whose AABB lies entirely beyond the visible world rect", () => {
    // 可见矩形 maxX=1000+margin;节点左边界放在 maxX+1,完全在右侧视口外。
    const rightMinX = 1000 + VIEWPORT_CULL_MARGIN + 1;
    const node = createCanvasNode("prompt", { x: rightMinX, y: 0 });
    expect(
      isNodeVisibleInRect(node, {
        minX: -VIEWPORT_CULL_MARGIN,
        minY: -VIEWPORT_CULL_MARGIN,
        maxX: 1000 + VIEWPORT_CULL_MARGIN,
        maxY: 800 + VIEWPORT_CULL_MARGIN,
      })
    ).toBe(false);
  });

  it("returns all nodes when boardSize is zero (first-frame fallback)", () => {
    const nodes = [
      createCanvasNode("prompt", { x: -10_000, y: 0 }),
      createCanvasNode("output", { x: 10_000, y: 10_000 }),
    ];
    const visible = computeVisibleNodes(nodes, DEFAULT_VIEWPORT, {
      width: 0,
      height: 0,
    });
    expect(visible).toHaveLength(2);
  });

  it("zooms out to reveal a wider world rect and include more nodes", () => {
    // 节点在 x=3000,默认 zoom=1 时屏幕只覆盖到 1000+margin=1200,不可见;
    // zoom=0.2 时屏幕覆盖 1000/0.2=5000 + margin,可见。
    const farNode = createCanvasNode("output", { x: 3000, y: 3000 });
    expect(
      computeVisibleNodes([farNode], DEFAULT_VIEWPORT, board)
    ).toHaveLength(0);
    expect(
      computeVisibleNodes([farNode], { x: 0, y: 0, zoom: 0.2 }, board)
    ).toHaveLength(1);
  });

  it("follows a panned viewport to include nodes that move into view", () => {
    const node = createCanvasNode("prompt", { x: 4000, y: 0 });
    // 默认视口下不可见
    expect(
      computeVisibleNodes([node], DEFAULT_VIEWPORT, board)
    ).toHaveLength(0);
    // 平移视口 x=-3500 让节点进入视口
    expect(
      computeVisibleNodes([node], { x: -3500, y: 0, zoom: 1 }, board)
    ).toHaveLength(1);
  });
});
