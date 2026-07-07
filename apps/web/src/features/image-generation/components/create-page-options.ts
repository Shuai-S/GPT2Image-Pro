import { buildStorageThumbnailUrl } from "@repo/shared/storage/signed-url";
import {
  DEFAULT_IMAGE_SIZE,
  IMAGE_DIMENSION_STEP,
  isFireflyModel,
  isImageSizeWithinPixelRange,
  MAX_IMAGE_DIMENSION,
  parseImageSize,
} from "../resolution";
import type {
  BackendGroupOption,
  ForceWebPixelRange,
  ImageBackground,
  ImageOutputFormat,
  ImageQuality,
} from "./create-page-types";

// 创作页静态配置与模型选项:集中维护下拉项、默认值和轻量格式化工具。

export const defaultDimensions = parseImageSize(DEFAULT_IMAGE_SIZE) || {
  width: 1024,
  height: 1024,
};

export const DEFAULT_FORCE_WEB_PIXEL_RANGE: ForceWebPixelRange = {
  minPixels: 660_000,
  maxPixels: 2_000_000,
};

export const DEFAULT_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_EDIT_REQUEST_BYTES = 75 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
export const CHAT_FILE_ACCEPT =
  ".txt,.md,.markdown,.csv,.json,.jsonl,.yaml,.yml,.log,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.java,.go,.rs,.c,.cc,.cpp,.h,.hpp,.sql,.sh,.toml,.ini,.env,.pdf,text/*,application/json,application/xml,application/pdf";
export const CHAT_ATTACHMENT_ACCEPT = `${IMAGE_ACCEPT},${CHAT_FILE_ACCEPT}`;

// Adobe Firefly 模型族按前缀自动路由到 Adobe 后端。
export const FIREFLY_MODEL_OPTIONS = [
  { value: "firefly-nano-banana-pro", label: "Firefly · Nano Banana Pro" },
  { value: "firefly-nano-banana", label: "Firefly · Nano Banana" },
  { value: "firefly-nano-banana2", label: "Firefly · Nano Banana 2" },
  { value: "firefly-gpt-image-2", label: "Firefly · GPT Image 2" },
  { value: "firefly-gpt-image-1.5", label: "Firefly · GPT Image 1.5" },
] as const;

export const TEXT_MODEL_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "gpt-image-2", label: "GPT Image 2" },
  { value: "gpt-image-1.5", label: "GPT Image 1.5" },
  { value: "gpt-image-1-mini", label: "GPT Image 1 Mini" },
  ...FIREFLY_MODEL_OPTIONS,
] as const;

// 对话生图/Agent 当前不暴露 Firefly 直连模型。
export const CHAT_IMAGE_MODEL_OPTIONS = TEXT_MODEL_OPTIONS.filter(
  (option) => !option.value.startsWith("firefly-")
);

export const EDIT_MODEL_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "gpt-image-2", label: "GPT Image 2" },
  { value: "gpt-image-1.5", label: "GPT Image 1.5" },
  { value: "gpt-image-1-mini", label: "GPT Image 1 Mini" },
  ...FIREFLY_MODEL_OPTIONS,
] as const;

export type ImageModelOption = {
  value: string;
  label: string;
};

const IMAGE_MODEL_LABELS: Map<string, string> = new Map(
  [...TEXT_MODEL_OPTIONS, ...EDIT_MODEL_OPTIONS]
    .filter((option) => option.value !== "default")
    .map((option) => [option.value, option.label])
);

export const QUALITY_OPTIONS: Array<{ value: ImageQuality; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const OUTPUT_FORMAT_OPTIONS: Array<{
  value: ImageOutputFormat;
  label: string;
}> = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];

export const BACKGROUND_OPTIONS: Array<{
  value: ImageBackground;
  label: string;
}> = [
  { value: "auto", label: "Auto" },
  { value: "opaque", label: "Opaque" },
  { value: "transparent", label: "Transparent" },
];

// 瀑布流每批并发预设,运行时会再按套餐并发上限过滤。
export const WATERFALL_TIER_PRESETS = [1, 5, 10, 20] as const;
export const DEFAULT_WATERFALL_TIER = 5;
export const WATERFALL_CONCURRENCY_MULTIPLIER = 3;
export const TEXT_IMAGE_COUNT_SLIDER_MAX = 5;
export const WATERFALL_ASPECT_RATIOS = [
  "1 / 1",
  "3 / 4",
  "4 / 3",
  "2 / 3",
] as const;

export const CHAT_SUGGESTIONS = [
  "A serene mountain lake at sunset, oil painting",
  "Minimalist logo for a tech startup",
  "Cyberpunk city street in the rain, neon lights",
  "Watercolor portrait of a cat wearing glasses",
] as const;
export const CHAT_SUGGESTIONS_ZH = [
  "日落时宁静的山间湖泊，油画风格",
  "科技创业公司的极简标志",
  "雨夜霓虹灯下的赛博朋克城市街道",
  "戴眼镜的猫咪水彩肖像",
] as const;

export const CHAT_STORAGE_KEY = "gpt2image_chat_messages_v1";
export const CHAT_CONVERSATIONS_STORAGE_KEY = "gpt2image_chat_conversations_v1";
export const CHAT_ACTIVE_CONVERSATION_STORAGE_KEY =
  "gpt2image_active_chat_conversation_v1";
export const CHAT_ACTIVE_AGENT_CONVERSATION_STORAGE_KEY =
  "gpt2image_active_agent_conversation_v1";
export const CREATE_ACTIVE_MODE_STORAGE_KEY = "gpt2image_create_active_mode_v1";
export const CHAT_CONTEXT_MESSAGE_LIMIT = 8;
export const CHAT_CONVERSATION_LIMIT = 30;

/**
 * 判断图片是否应绕过 next/image 优化器。
 *
 * @param imageUrl 待展示图片 URL。
 * @returns 当前策略下所有非空 URL 都绕过优化器。
 * @sideEffects 无。
 * @failureMode 空值返回 false。
 */
export const shouldBypassImageOptimization = (imageUrl: string | undefined) =>
  Boolean(imageUrl);

/**
 * 为列表缩略图生成同源存储缩略图 URL。
 *
 * @param imageUrl 原图地址。
 * @param width 期望缩略图宽度。
 * @returns 可用于缩略图展示的 URL。
 * @sideEffects 无。
 * @failureMode 非存储图或空值会返回原图或空字符串。
 */
export const thumbSrc = (
  imageUrl: string | null | undefined,
  width: number
): string => buildStorageThumbnailUrl(imageUrl, width) || imageUrl || "";

/**
 * 归一化 Web 优先路由的像素范围。
 *
 * @param range 后端设置的像素范围。
 * @returns 保证 min <= max 且为有限数值的像素范围。
 * @sideEffects 无。
 * @failureMode 非法输入回退默认范围。
 */
export function normalizeForceWebPixelRange(
  range?: ForceWebPixelRange | null
): ForceWebPixelRange {
  const min =
    typeof range?.minPixels === "number" && Number.isFinite(range.minPixels)
      ? Math.max(0, range.minPixels)
      : DEFAULT_FORCE_WEB_PIXEL_RANGE.minPixels;
  const max =
    typeof range?.maxPixels === "number" && Number.isFinite(range.maxPixels)
      ? Math.max(1, range.maxPixels)
      : DEFAULT_FORCE_WEB_PIXEL_RANGE.maxPixels;
  return {
    minPixels: Math.min(min, max),
    maxPixels: Math.max(min, max),
  };
}

/**
 * 判断尺寸是否处于 Web 优先路由像素范围内。
 *
 * @param size 宽高字符串。
 * @param range Web 优先路由像素范围。
 * @returns 尺寸是否允许走 Web 优先。
 * @sideEffects 无。
 * @failureMode 非法尺寸由底层校验返回 false。
 */
export function isWithinForceWebPixelRange(
  size?: string | null,
  range?: ForceWebPixelRange | null
) {
  const normalized = normalizeForceWebPixelRange(range);
  return isImageSizeWithinPixelRange(
    size,
    normalized.minPixels,
    normalized.maxPixels
  );
}

/**
 * 规范化后端模型 id,用于分组可用模型与前端下拉项匹配。
 *
 * @param value 后端或前端声明的模型 id。
 * @returns 可比较的模型 id。
 * @sideEffects 无。
 * @failureMode 空白输入会返回空字符串,调用方负责过滤。
 */
export const normalizeModelId = (value: string) => value.trim().toLowerCase();

/**
 * 将后端自定义模型 id 转为可读标签。
 *
 * @param value 规范化后的模型 id。
 * @returns 下拉列表展示文案。
 * @sideEffects 无。
 * @failureMode 未识别缩写仅做首字母大写,不影响提交值。
 */
export const formatImageModelLabel = (value: string) =>
  IMAGE_MODEL_LABELS.get(value) ||
  value
    .split("-")
    .filter(Boolean)
    .map((part) => {
      if (part === "gpt") return "GPT";
      if (part === "api") return "API";
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");

/**
 * 根据当前后端分组收敛图片模型下拉项。
 *
 * @param options 当前模式支持的基础模型目录。
 * @param group 当前选中的后端分组。
 * @param allowFirefly 当前模式是否允许 Firefly 模型。
 * @returns 可选择的图片模型列表,顺序决定默认模型。
 * @sideEffects 无。
 * @failureMode 分组未声明模型时回退基础目录;未匹配声明值会保留为自定义模型。
 */
export const filterImageModelOptionsForGroup = (
  options: readonly ImageModelOption[],
  group: BackendGroupOption | null,
  allowFirefly = true
): ImageModelOption[] => {
  const baseOptions = options.filter(
    (option) =>
      option.value !== "default" &&
      (allowFirefly || !isFireflyModel(option.value))
  );
  const availableModels = Array.from(
    new Set(
      (group?.availableModels || [])
        .map((model) => normalizeModelId(model))
        .filter(Boolean)
    )
  ).filter((model) => allowFirefly || !isFireflyModel(model));
  if (!availableModels.length) return baseOptions;

  const availableModelSet = new Set(availableModels);
  const matchedOptions = baseOptions.filter((option) =>
    availableModelSet.has(normalizeModelId(option.value))
  );
  const baseModelSet = new Set(
    baseOptions.map((option) => normalizeModelId(option.value))
  );
  const customOptions = availableModels
    .filter((model) => !baseModelSet.has(model))
    .map((model) => ({
      value: model,
      label: formatImageModelLabel(model),
    }));
  const filteredOptions = [...matchedOptions, ...customOptions];
  return filteredOptions.length ? filteredOptions : baseOptions;
};

export { IMAGE_DIMENSION_STEP, MAX_IMAGE_DIMENSION };
