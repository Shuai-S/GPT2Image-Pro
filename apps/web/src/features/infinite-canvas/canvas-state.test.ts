import { describe, expect, it } from "vitest";
import {
  addCanvasEdge,
  addCanvasNode,
  createCanvasNode,
  createEmptyCanvasState,
  fitViewportToNodes,
  getInputNodesForNode,
  moveCanvasNode,
  parseCanvasState,
  removeCanvasNodes,
  screenPointToWorld,
  serializeCanvasState,
} from "./canvas-state";

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
