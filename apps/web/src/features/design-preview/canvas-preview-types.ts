// 无限画布高保真原型的数据模型与纯布局辅助函数。

import { getArtwork } from "./mock-data";
import type { PreviewImageSizeTier, PreviewRatioValue } from "./ratio-presets";

export const CREATOR_NODE_WIDTH = 340;
export const CREATOR_NODE_HEIGHT = 250;
export const MIN_PREVIEW_ZOOM = 0.4;
export const MAX_PREVIEW_ZOOM = 2;

export type CanvasPoint = { x: number; y: number };

export type CanvasViewport = CanvasPoint & { zoom: number };

export type CreatorPanel = "model" | "ratio" | "advanced" | null;

export type CreatorNode = {
  id: string;
  kind: "creator";
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  prompt: string;
  modelId: string;
  modelName: string;
  ratio: PreviewRatioValue;
  sizeTier: PreviewImageSizeTier;
  resolution: string;
  customResolution: { width: number; height: number };
  count: number;
  references: string[];
  outputSequence: number;
  runningBatchId?: string;
  completedCount: number;
};

export type ImageNodeStatus =
  | "ready"
  | "queued"
  | "generating"
  | "failed"
  | "uploading";

export type ImageNode = {
  id: string;
  kind: "image";
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  artworkId: string;
  source: "generated" | "uploaded" | "gallery";
  status: ImageNodeStatus;
  batchId?: string;
  creatorId?: string;
  promptSnapshot?: string;
  modelSnapshot?: string;
  generatedAt?: string;
  edited: boolean;
  hasMask: boolean;
  maskDataUrl?: string;
  error?: string;
};

export type CanvasPreviewNode = CreatorNode | ImageNode;

export type CanvasPreviewEdge = {
  id: string;
  from: string;
  to: string;
  kind: "input" | "output";
  batchId?: string;
};

export type ConnectionDraft = {
  sourceId: string;
  point: CanvasPoint;
};

/**
 * 创建一个固定尺寸的创作节点。
 *
 * @param input 节点位置与可选的初始创作配置。
 * @returns 可直接加入原型画布的创作节点。
 * @sideEffects 无。
 */
export function createPreviewCreatorNode(input: {
  id: string;
  x: number;
  y: number;
  title?: string;
  prompt?: string;
  modelId?: string;
  modelName?: string;
  ratio?: PreviewRatioValue;
  sizeTier?: PreviewImageSizeTier;
  resolution?: string;
  customResolution?: { width: number; height: number };
  count?: number;
  references?: string[];
}): CreatorNode {
  return {
    id: input.id,
    kind: "creator",
    title: input.title ?? "新创作",
    x: input.x,
    y: input.y,
    width: CREATOR_NODE_WIDTH,
    height: CREATOR_NODE_HEIGHT,
    prompt: input.prompt ?? "",
    modelId: input.modelId ?? "gpt-image-2",
    modelName: input.modelName ?? "GPT Image 2",
    ratio: input.ratio ?? "1:1",
    sizeTier: input.sizeTier ?? "1k",
    resolution: input.resolution ?? "1024 × 1024",
    customResolution: input.customResolution ?? {
      width: 1024,
      height: 1024,
    },
    count: input.count ?? 1,
    references: input.references ?? [],
    outputSequence: 0,
    completedCount: 0,
  };
}

/**
 * 按图片宽高比计算接近等视觉面积的节点尺寸。
 *
 * @param artworkId 原型作品目录中的图片 ID。
 * @returns 包含固定标题栏后的节点宽高。
 * @sideEffects 读取静态原型作品目录。
 */
export function getPreviewImageNodeSize(artworkId: string) {
  const artwork = getArtwork(artworkId);
  const ratio = artwork.width / artwork.height;
  const targetArea = 49_500;
  const contentWidth = Math.min(
    292,
    Math.max(176, Math.sqrt(targetArea * ratio))
  );
  const contentHeight = Math.min(272, Math.max(164, targetArea / contentWidth));
  return {
    width: Math.round(contentWidth),
    height: Math.round(contentHeight + 36),
  };
}

/**
 * 创建引用静态作品资产的统一图片节点。
 *
 * @param input 图片、位置、来源与生成快照。
 * @returns 可直接加入原型画布的图片节点。
 * @sideEffects 读取静态作品尺寸。
 */
export function createPreviewImageNode(input: {
  id: string;
  artworkId: string;
  x: number;
  y: number;
  title?: string;
  source?: ImageNode["source"];
  status?: ImageNodeStatus;
  batchId?: string;
  creatorId?: string;
  promptSnapshot?: string;
  modelSnapshot?: string;
  generatedAt?: string;
}): ImageNode {
  const artwork = getArtwork(input.artworkId);
  const size = getPreviewImageNodeSize(input.artworkId);
  return {
    id: input.id,
    kind: "image",
    title: input.title ?? artwork.title,
    x: input.x,
    y: input.y,
    width: size.width,
    height: size.height,
    artworkId: input.artworkId,
    source: input.source ?? "gallery",
    status: input.status ?? "ready",
    batchId: input.batchId,
    creatorId: input.creatorId,
    promptSnapshot: input.promptSnapshot,
    modelSnapshot: input.modelSnapshot,
    generatedAt: input.generatedAt,
    edited: false,
    hasMask: false,
  };
}

/**
 * 约束预览画布缩放范围。
 *
 * @param zoom 任意缩放值。
 * @returns 40% 至 200% 之间的安全缩放。
 * @sideEffects 无。
 */
export function clampPreviewZoom(zoom: number) {
  return Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, zoom));
}

/**
 * 返回节点连接端口的世界坐标。
 *
 * @param node 画布节点。
 * @param side 固定的输入或输出侧。
 * @returns 端口中心的世界坐标。
 * @sideEffects 无。
 */
export function getPreviewNodePort(
  node: CanvasPreviewNode,
  side: "input" | "output"
): CanvasPoint {
  return {
    x: side === "input" ? node.x : node.x + node.width,
    y: node.y + Math.min(node.height * 0.5, 126),
  };
}

/**
 * 为一次生成计算自适应结果位置。
 *
 * @param creator 产生结果的创作节点。
 * @param count 本批生成数量。
 * @param nodes 当前全部节点，用于避让已有布局。
 * @returns 每张结果图片的世界坐标。
 * @sideEffects 无。
 */
export function getPreviewResultPositions(
  creator: CreatorNode,
  count: number,
  nodes: CanvasPreviewNode[]
): CanvasPoint[] {
  const columns = count === 1 ? 1 : count === 2 ? 2 : 2;
  const rows = Math.ceil(count / columns);
  const cellWidth = 270;
  const cellHeight = 280;
  let startX = creator.x + creator.width + 180;
  let startY = creator.y - (rows - 1) * 70;

  const collides = (x: number, y: number) =>
    nodes.some(
      (node) =>
        x < node.x + node.width + 36 &&
        x + 250 > node.x - 36 &&
        y < node.y + node.height + 36 &&
        y + 250 > node.y - 36
    );

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const positions = Array.from({ length: count }, (_, index) => ({
      x: startX + (index % columns) * cellWidth,
      y: startY + Math.floor(index / columns) * cellHeight,
    }));
    if (positions.every((point) => !collides(point.x, point.y))) {
      return positions;
    }
    startY += cellHeight;
    if (attempt === 3) {
      startX += cellWidth;
      startY = creator.y;
    }
  }

  return Array.from({ length: count }, (_, index) => ({
    x: startX + (index % columns) * cellWidth,
    y: startY + Math.floor(index / columns) * cellHeight,
  }));
}

/**
 * 计算节点集合的世界边界。
 *
 * @param nodes 需要包含的节点集合。
 * @returns 空集合返回 null，否则返回矩形边界。
 * @sideEffects 无。
 */
export function getPreviewNodeBounds(nodes: CanvasPreviewNode[]) {
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * 从期望位置开始寻找不覆盖已有节点的最近空白区域。
 *
 * @param nodes 当前画布节点。
 * @param preferred 首选左上角世界坐标。
 * @param size 待放置节点宽高。
 * @returns 首个无碰撞位置；搜索耗尽时返回最远候选。
 * @sideEffects 无。
 */
export function findPreviewFreePosition(
  nodes: CanvasPreviewNode[],
  preferred: CanvasPoint,
  size: { width: number; height: number }
) {
  const gap = 44;
  const offsets: CanvasPoint[] = [
    { x: 0, y: 0 },
    { x: size.width + 80, y: 0 },
    { x: 0, y: size.height + 80 },
    { x: size.width + 80, y: size.height + 80 },
    { x: -(size.width + 80), y: 0 },
    { x: 0, y: -(size.height + 80) },
    { x: size.width * 2 + 160, y: 0 },
    { x: 0, y: size.height * 2 + 160 },
  ];

  for (const offset of offsets) {
    const candidate = {
      x: preferred.x + offset.x,
      y: preferred.y + offset.y,
    };
    const collides = nodes.some(
      (node) =>
        candidate.x < node.x + node.width + gap &&
        candidate.x + size.width > node.x - gap &&
        candidate.y < node.y + node.height + gap &&
        candidate.y + size.height > node.y - gap
    );
    if (!collides) return candidate;
  }

  const fallback = offsets.at(-1) ?? { x: 0, y: 0 };
  return { x: preferred.x + fallback.x, y: preferred.y + fallback.y };
}
