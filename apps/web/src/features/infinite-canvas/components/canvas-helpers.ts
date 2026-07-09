import type { AspectRatioSizeDialogValue } from "@/features/image-generation/components/aspect-ratio-size-dialog";
import {
  AUTO_IMAGE_SIZE,
  DEFAULT_IMAGE_SIZE,
  normalizeImageSize,
  parseImageSize,
} from "@/features/image-generation/resolution";
import type { CanvasNode } from "@/features/infinite-canvas/canvas-state";
import { z } from "zod";

/**
 * 画布客户端用到的纯函数与共享类型/校验 schema。
 *
 * 使用方：infinite-canvas-client.tsx、canvas-generators.ts、canvas-ui.tsx。
 * 关键约束：本文件不依赖 React，仅包含纯逻辑，便于单测与按需抽离。
 */

const MIN_CANVAS_LOOP_COUNT = 1;
const MAX_CANVAS_LOOP_COUNT = 12;
const DEFAULT_CANVAS_IMAGE_DIMENSIONS = { width: 1024, height: 1024 };

const nullableStringSchema = z
  .string()
  .nullish()
  .transform((value) => value || undefined);
const nullableNumberSchema = z
  .number()
  .nullish()
  .transform((value) => value ?? undefined);
const generationStatusSchema = z
  .enum(["pending", "completed", "failed"])
  .nullish()
  .transform((value) => value || undefined);

/**
 * 单次图片生成接口响应校验 schema。
 */
export const GENERATION_RESULT_SCHEMA = z.object({
  error: nullableStringSchema,
  generationId: nullableStringSchema,
  generation_id: nullableStringSchema,
  status: generationStatusSchema,
  imageUrl: nullableStringSchema,
  imageBase64: nullableStringSchema,
  imageOutputs: z
    .array(
      z.object({
        imageUrl: nullableStringSchema,
        imageBase64: nullableStringSchema,
      })
    )
    .nullish()
    .transform((value) => value || undefined)
    .optional(),
  revisedPrompt: nullableStringSchema,
  model: nullableStringSchema,
  size: nullableStringSchema,
  creditsConsumed: nullableNumberSchema,
});

/**
 * 批量图片生成接口响应校验 schema。
 */
export const BATCH_GENERATION_RESULT_SCHEMA = z.object({
  error: nullableStringSchema,
  results: z.array(GENERATION_RESULT_SCHEMA).optional(),
});

export type GenerationResult = z.infer<typeof GENERATION_RESULT_SCHEMA>;

export { MIN_CANVAS_LOOP_COUNT, MAX_CANVAS_LOOP_COUNT };

/**
 * 图片预览弹层状态。
 */
export type ImagePreviewState = {
  imageUrl: string;
  title: string;
};

/**
 * 节点连接点方向。
 */
export type ConnectorSide = "input" | "output";

/**
 * 下载画布中的图片资源。
 *
 * @param imageUrl 图片 data URL 或网络 URL。
 * @param title 用于生成下载文件名的节点标题。
 * @sideEffects 读取图片并触发浏览器下载。
 */
export async function downloadCanvasImage(imageUrl: string, title: string) {
  const fileName = getCanvasImageDownloadName(title, imageUrl);
  if (imageUrl.startsWith("data:")) {
    triggerImageDownload(imageUrl, fileName);
    return;
  }

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error("Image download failed");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    triggerImageDownload(objectUrl, fileName);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

/**
 * 触发浏览器下载链接。
 *
 * @param url 下载 URL。
 * @param fileName 文件名。
 * @sideEffects 创建并点击临时下载链接。
 */
export function triggerImageDownload(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * 根据节点标题和图片地址生成下载文件名。
 *
 * @param title 节点标题。
 * @param imageUrl 图片地址。
 * @returns 安全的图片文件名。
 * @sideEffects 无。
 */
export function getCanvasImageDownloadName(title: string, imageUrl: string) {
  const baseName =
    title
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "canvas-image";
  return `${baseName}.${getCanvasImageExtension(imageUrl)}`;
}

/**
 * 从图片 URL 中推断扩展名。
 *
 * @param imageUrl 图片地址。
 * @returns 浏览器下载使用的扩展名。
 * @sideEffects 无。
 */
export function getCanvasImageExtension(imageUrl: string) {
  const dataMatch = /^data:image\/([a-z0-9.+-]+);/i.exec(imageUrl);
  if (dataMatch?.[1]) return normalizeImageExtension(dataMatch[1]);
  try {
    const pathname = new URL(imageUrl, window.location.href).pathname;
    const extension = pathname.split(".").pop()?.toLowerCase();
    if (extension) return normalizeImageExtension(extension);
  } catch {
    return "png";
  }
  return "png";
}

/**
 * 把 MIME 子类型或路径扩展名归一为常见图片扩展名。
 *
 * @param value MIME 子类型或扩展名。
 * @returns 可用于文件名的扩展名。
 * @sideEffects 无。
 */
export function normalizeImageExtension(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "jpeg" || normalized === "jpg") return "jpg";
  if (normalized === "webp") return "webp";
  if (normalized === "gif") return "gif";
  if (normalized === "avif") return "avif";
  return "png";
}

/**
 * 创建可传给图片生成接口并用于状态回查的 ID。
 *
 * @returns 图片生成记录 ID。
 * @sideEffects 读取浏览器随机源。
 */
export function createCanvasGenerationId() {
  const randomPart = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `gen_${randomPart}`;
}

/**
 * 把本地文件读取为 data URL。
 *
 * @param file 图片文件。
 * @returns data URL。
 * @sideEffects 读取用户选择的本地文件。
 */
export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("File read failed"));
    reader.onerror = () =>
      reject(reader.error || new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * 判断节点是否能向下游提供提示词文本。
 *
 * @param node 画布节点。
 * @returns 是否为提示词类节点。
 * @sideEffects 无。
 */
export function isCanvasPromptLikeNode(node: CanvasNode) {
  return node.kind === "prompt" || node.kind === "loop";
}

/**
 * 将循环节点的数量输入归一到画布允许范围内。
 *
 * @param value 用户输入或持久化的数量。
 * @returns 安全循环次数。
 * @sideEffects 无。
 */
export function normalizeCanvasLoopCount(value: unknown) {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return MIN_CANVAS_LOOP_COUNT;
  return Math.min(
    MAX_CANVAS_LOOP_COUNT,
    Math.max(MIN_CANVAS_LOOP_COUNT, Math.trunc(parsed))
  );
}

/**
 * 根据循环节点配置拆出每一轮生成要使用的提示词。
 *
 * WHY：每轮变量为空时保留相同提示词，后续可走后端批量 count；
 * 每轮变量不同时逐轮请求，避免不同分镜被合并成一条提示词。
 *
 * @param node 循环节点。
 * @param basePrompt 已由上游节点合成的基础提示词。
 * @returns 每张图对应的完整提示词。
 * @sideEffects 无。
 */
export function buildCanvasLoopPromptPlan(
  node: CanvasNode,
  basePrompt: string
) {
  const itemLines = (node.loopItems || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const count = normalizeCanvasLoopCount(
    itemLines.length > 0 ? itemLines.length : node.loopCount
  );

  return Array.from({ length: count }, (_, index) => {
    const item = itemLines[index]
      ?.replaceAll("{i}", String(index + 1))
      .replaceAll("{n}", String(index + 1));
    return [basePrompt, item].filter(Boolean).join("\n\n");
  });
}

/**
 * 延迟指定毫秒数。
 *
 * @param ms 延迟时间。
 * @returns 延迟 Promise。
 * @sideEffects 设置计时器。
 */
export function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

/**
 * 从生成响应中取第一张可显示图片。
 *
 * @param result 生成接口结果。
 * @returns 图片 URL 或 data URL。
 * @sideEffects 无。
 */
export function firstImageUrl(result: GenerationResult) {
  if (result.imageUrl) return result.imageUrl;
  if (result.imageBase64) return `data:image/png;base64,${result.imageBase64}`;
  const output = result.imageOutputs?.find(
    (item) => item.imageUrl || item.imageBase64
  );
  if (output?.imageUrl) return output.imageUrl;
  if (output?.imageBase64) return `data:image/png;base64,${output.imageBase64}`;
  return undefined;
}

/**
 * 把画布节点保存的尺寸字符串转换为共享比例控件需要的值对象。
 *
 * @param size 节点持久化的 WIDTHxHEIGHT 或 auto。
 * @returns 比例控件可渲染的尺寸值。
 * @sideEffects 无。
 */
export function getCanvasNodeSizeValue(
  size?: string | null
): AspectRatioSizeDialogValue {
  const normalizedSize = size?.trim().toLowerCase();
  const fallback =
    parseImageSize(DEFAULT_IMAGE_SIZE) || DEFAULT_CANVAS_IMAGE_DIMENSIONS;

  if (normalizedSize === AUTO_IMAGE_SIZE) {
    return {
      auto: true,
      width: fallback.width,
      height: fallback.height,
      mixWebFirst: false,
    };
  }

  const dimensions = normalizedSize ? parseImageSize(normalizedSize) : fallback;
  return {
    auto: false,
    width: dimensions?.width || fallback.width,
    height: dimensions?.height || fallback.height,
    mixWebFirst: false,
  };
}

/**
 * 把共享比例控件的值转换为画布节点保存的尺寸字符串。
 *
 * @param value 比例控件返回的尺寸值。
 * @returns 节点与生成接口使用的尺寸字符串。
 * @sideEffects 无。
 */
export function getCanvasNodeSizeFromValue(value: AspectRatioSizeDialogValue) {
  if (value.auto) return AUTO_IMAGE_SIZE;
  return normalizeImageSize(value.width, value.height);
}
