import { z } from "zod";

/**
 * 无限画布状态模型与纯函数。
 *
 * 使用方：无限画布客户端组件、导入导出流程与单元测试。
 * 关键依赖：Zod 用于校验外部导入的 JSON，避免损坏画布状态进入 UI。
 */

export const CANVAS_STORAGE_VERSION = 1;
export const MIN_CANVAS_ZOOM = 0.2;
export const MAX_CANVAS_ZOOM = 2.4;
export const DEFAULT_NODE_WIDTH = 280;
export const DEFAULT_NODE_HEIGHT = 180;
export const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

const canvasNodeKindSchema = z.enum(["prompt", "image", "generator", "output"]);

export type CanvasNodeKind = z.infer<typeof canvasNodeKindSchema>;

const canvasNodeStatusSchema = z.enum(["idle", "running", "failed"]);

export type CanvasNodeStatus = z.infer<typeof canvasNodeStatusSchema>;

export const canvasNodeSchema = z.object({
  id: z.string().min(1),
  kind: canvasNodeKindSchema,
  title: z.string().min(1).max(80),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  prompt: z.string().max(8000).optional(),
  imageUrl: z.string().max(200_000).optional(),
  model: z.string().max(128).optional(),
  size: z.string().max(32).optional(),
  status: canvasNodeStatusSchema.optional(),
  error: z.string().max(1000).optional(),
});

export type CanvasNode = z.infer<typeof canvasNodeSchema>;

export const canvasEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
});

export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

export const canvasViewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().finite().positive(),
});

export type CanvasViewport = z.infer<typeof canvasViewportSchema>;

export const canvasStateSchema = z.object({
  version: z.literal(CANVAS_STORAGE_VERSION),
  title: z.string().min(1).max(80),
  nodes: z.array(canvasNodeSchema),
  edges: z.array(canvasEdgeSchema),
  viewport: canvasViewportSchema,
  updatedAt: z.string().datetime(),
});

export type CanvasState = z.infer<typeof canvasStateSchema>;

export type Point = {
  x: number;
  y: number;
};

/**
 * 生成足够稳定的客户端 ID。
 *
 * @returns 节点或连线 ID。
 * @sideEffects 读取浏览器或 Node 的加密随机源；不可用时退回时间戳。
 */
export function createCanvasId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `canvas_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

/**
 * 建立一个空白画布状态。
 *
 * @param title 画布标题。
 * @returns 可直接渲染并持久化的画布状态。
 * @sideEffects 读取当前时间。
 */
export function createEmptyCanvasState(title = "Infinite Canvas"): CanvasState {
  return {
    version: CANVAS_STORAGE_VERSION,
    title,
    nodes: [],
    edges: [],
    viewport: DEFAULT_VIEWPORT,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 把缩放值收敛到画布允许范围。
 *
 * @param zoom 原始缩放值。
 * @returns 安全缩放值。
 * @sideEffects 无。
 */
export function clampCanvasZoom(zoom: number) {
  if (!Number.isFinite(zoom)) return DEFAULT_VIEWPORT.zoom;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

/**
 * 将屏幕坐标换算为世界坐标。
 *
 * @param point 屏幕坐标。
 * @param viewport 当前视口平移与缩放。
 * @returns 对应的画布世界坐标。
 * @sideEffects 无。
 */
export function screenPointToWorld(
  point: Point,
  viewport: CanvasViewport
): Point {
  const zoom = clampCanvasZoom(viewport.zoom);
  return {
    x: (point.x - viewport.x) / zoom,
    y: (point.y - viewport.y) / zoom,
  };
}

/**
 * 创建画布节点。
 *
 * @param kind 节点类型。
 * @param position 节点左上角世界坐标。
 * @param overrides 需要覆盖的节点字段。
 * @returns 新节点。
 * @sideEffects 生成随机 ID。
 */
export function createCanvasNode(
  kind: CanvasNodeKind,
  position: Point,
  overrides: Partial<Omit<CanvasNode, "id" | "kind" | "x" | "y">> = {}
): CanvasNode {
  const baseTitle: Record<CanvasNodeKind, string> = {
    prompt: "Prompt",
    image: "Image",
    generator: "Generator",
    output: "Output",
  };
  const defaultHeight: Record<CanvasNodeKind, number> = {
    prompt: 190,
    image: 220,
    generator: 230,
    output: 230,
  };

  return {
    id: createCanvasId(),
    kind,
    title: overrides.title || baseTitle[kind],
    x: position.x,
    y: position.y,
    width: overrides.width || DEFAULT_NODE_WIDTH,
    height: overrides.height || defaultHeight[kind],
    prompt: overrides.prompt,
    imageUrl: overrides.imageUrl,
    model: overrides.model,
    size: overrides.size || (kind === "generator" ? "1024x1024" : undefined),
    status: overrides.status || "idle",
    error: overrides.error,
  };
}

/**
 * 向画布追加节点并刷新更新时间。
 *
 * @param state 当前画布状态。
 * @param node 新节点。
 * @returns 新画布状态。
 * @sideEffects 读取当前时间。
 */
export function addCanvasNode(
  state: CanvasState,
  node: CanvasNode
): CanvasState {
  return touchCanvasState({ ...state, nodes: [...state.nodes, node] });
}

/**
 * 修改一个节点。
 *
 * @param state 当前画布状态。
 * @param nodeId 目标节点 ID。
 * @param patch 节点字段补丁。
 * @returns 新画布状态；节点不存在时原样更新时间。
 * @sideEffects 读取当前时间。
 */
export function updateCanvasNode(
  state: CanvasState,
  nodeId: string,
  patch: Partial<Omit<CanvasNode, "id" | "kind">>
): CanvasState {
  return touchCanvasState({
    ...state,
    nodes: state.nodes.map((node) =>
      node.id === nodeId ? { ...node, ...patch } : node
    ),
  });
}

/**
 * 移动画布节点。
 *
 * @param state 当前画布状态。
 * @param nodeId 目标节点 ID。
 * @param delta 世界坐标下的移动距离。
 * @returns 新画布状态。
 * @sideEffects 读取当前时间。
 */
export function moveCanvasNode(
  state: CanvasState,
  nodeId: string,
  delta: Point
): CanvasState {
  return touchCanvasState({
    ...state,
    nodes: state.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, x: node.x + delta.x, y: node.y + delta.y }
        : node
    ),
  });
}

/**
 * 删除节点，并清理相关连线。
 *
 * @param state 当前画布状态。
 * @param nodeIds 要删除的节点 ID。
 * @returns 新画布状态。
 * @sideEffects 读取当前时间。
 */
export function removeCanvasNodes(
  state: CanvasState,
  nodeIds: readonly string[]
): CanvasState {
  const removing = new Set(nodeIds);
  return touchCanvasState({
    ...state,
    nodes: state.nodes.filter((node) => !removing.has(node.id)),
    edges: state.edges.filter(
      (edge) => !removing.has(edge.from) && !removing.has(edge.to)
    ),
  });
}

/**
 * 添加有向连线。
 *
 * @param state 当前画布状态。
 * @param from 起点节点 ID。
 * @param to 终点节点 ID。
 * @returns 新画布状态；自连或重复连线会保持原状态。
 * @sideEffects 生成随机 ID，并在有效新增时读取当前时间。
 */
export function addCanvasEdge(
  state: CanvasState,
  from: string,
  to: string
): CanvasState {
  if (from === to) return state;
  const hasNodes =
    state.nodes.some((node) => node.id === from) &&
    state.nodes.some((node) => node.id === to);
  if (!hasNodes) return state;
  const exists = state.edges.some(
    (edge) => edge.from === from && edge.to === to
  );
  if (exists) return state;
  return touchCanvasState({
    ...state,
    edges: [...state.edges, { id: createCanvasId(), from, to }],
  });
}

/**
 * 删除指定连线。
 *
 * @param state 当前画布状态。
 * @param edgeId 连线 ID。
 * @returns 新画布状态。
 * @sideEffects 读取当前时间。
 */
export function removeCanvasEdge(
  state: CanvasState,
  edgeId: string
): CanvasState {
  return touchCanvasState({
    ...state,
    edges: state.edges.filter((edge) => edge.id !== edgeId),
  });
}

/**
 * 找出进入目标节点的输入节点。
 *
 * @param state 当前画布状态。
 * @param nodeId 目标节点 ID。
 * @returns 已按连线顺序排列的输入节点。
 * @sideEffects 无。
 */
export function getInputNodesForNode(
  state: CanvasState,
  nodeId: string
): CanvasNode[] {
  const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
  return state.edges
    .filter((edge) => edge.to === nodeId)
    .map((edge) => nodeById.get(edge.from))
    .filter((node): node is CanvasNode => Boolean(node));
}

/**
 * 计算包含所有节点的世界边界。
 *
 * @param nodes 参与计算的节点集合。
 * @returns 边界对象；没有节点时返回 null。
 * @sideEffects 无。
 */
export function getCanvasNodeBounds(nodes: readonly CanvasNode[]) {
  if (nodes.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * 根据节点边界计算适配视口。
 *
 * @param nodes 要适配的节点集合。
 * @param viewportSize 容器像素尺寸。
 * @returns 推荐视口。
 * @sideEffects 无。
 */
export function fitViewportToNodes(
  nodes: readonly CanvasNode[],
  viewportSize: { width: number; height: number }
): CanvasViewport {
  const bounds = getCanvasNodeBounds(nodes);
  if (!bounds) return DEFAULT_VIEWPORT;
  const padding = 120;
  const zoom = clampCanvasZoom(
    Math.min(
      viewportSize.width / Math.max(bounds.width + padding, 1),
      viewportSize.height / Math.max(bounds.height + padding, 1)
    )
  );
  return {
    zoom,
    x: viewportSize.width / 2 - (bounds.minX + bounds.width / 2) * zoom,
    y: viewportSize.height / 2 - (bounds.minY + bounds.height / 2) * zoom,
  };
}

/**
 * 校验并解析外部画布 JSON。
 *
 * @param value 待解析的未知值。
 * @returns 解析结果；失败时包含 Zod 错误。
 * @sideEffects 无。
 */
export function parseCanvasState(value: unknown) {
  return canvasStateSchema.safeParse(value);
}

/**
 * 序列化画布状态。
 *
 * @param state 当前画布状态。
 * @returns 缩进后的 JSON 文本。
 * @sideEffects 无。
 */
export function serializeCanvasState(state: CanvasState) {
  return JSON.stringify(state, null, 2);
}

/**
 * 刷新画布更新时间。
 *
 * @param state 当前画布状态。
 * @returns 带新 updatedAt 的状态。
 * @sideEffects 读取当前时间。
 */
function touchCanvasState(state: CanvasState): CanvasState {
  return { ...state, updatedAt: new Date().toISOString() };
}
