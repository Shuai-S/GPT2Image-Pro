// 创作原型的画面比例预设。数值与生产环境 AspectRatioSizeDialog 的合法尺寸矩阵保持一致。

import {
  MAX_IMAGE_ASPECT_RATIO,
  MAX_IMAGE_DIMENSION,
  MIN_IMAGE_DIMENSION,
  normalizeValidImageSize,
  parseImageSize,
} from "../image-generation/resolution";

export type PreviewImageSizeTier = "1k" | "2k" | "4k";

export type PreviewImageAspectRatio =
  | "1:1"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "4:5"
  | "5:4"
  | "16:9"
  | "9:16"
  | "21:9";

export type PreviewRatioValue = PreviewImageAspectRatio | "auto" | "custom";

export const previewImageSizeTiers: Array<{
  value: PreviewImageSizeTier;
  label: string;
}> = [
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];

export const previewImageRatioPresets: Array<{
  value: PreviewImageAspectRatio;
  width: number;
  height: number;
  label: string;
}> = [
  { value: "1:1", width: 1, height: 1, label: "正方形" },
  { value: "2:3", width: 2, height: 3, label: "竖版" },
  { value: "3:2", width: 3, height: 2, label: "横版" },
  { value: "3:4", width: 3, height: 4, label: "竖版" },
  { value: "4:3", width: 4, height: 3, label: "横版" },
  { value: "4:5", width: 4, height: 5, label: "竖版" },
  { value: "5:4", width: 5, height: 4, label: "横版" },
  { value: "9:16", width: 9, height: 16, label: "竖版" },
  { value: "16:9", width: 16, height: 9, label: "宽屏" },
  { value: "21:9", width: 21, height: 9, label: "影院" },
];

const previewImageSizeMatrix = {
  "1:1": {
    "1k": [1024, 1024],
    "2k": [2048, 2048],
    "4k": [2880, 2880],
  },
  "2:3": {
    "1k": [688, 1024],
    "2k": [1360, 2048],
    "4k": [2336, 3520],
  },
  "3:2": {
    "1k": [1024, 688],
    "2k": [2048, 1360],
    "4k": [3520, 2336],
  },
  "3:4": {
    "1k": [768, 1024],
    "2k": [1536, 2048],
    "4k": [2480, 3312],
  },
  "4:3": {
    "1k": [1024, 768],
    "2k": [2048, 1536],
    "4k": [3312, 2480],
  },
  "4:5": {
    "1k": [816, 1024],
    "2k": [1632, 2048],
    "4k": [2560, 3216],
  },
  "5:4": {
    "1k": [1024, 816],
    "2k": [2048, 1632],
    "4k": [3216, 2560],
  },
  "9:16": {
    "1k": [576, 1024],
    "2k": [1152, 2048],
    "4k": [2160, 3840],
  },
  "16:9": {
    "1k": [1024, 576],
    "2k": [2048, 1152],
    "4k": [3840, 2160],
  },
  "21:9": {
    "1k": [1024, 432],
    "2k": [2048, 864],
    "4k": [3840, 1632],
  },
} satisfies Record<
  PreviewImageAspectRatio,
  Record<PreviewImageSizeTier, readonly [number, number]>
>;

/**
 * 读取生产规则对应的预设图片尺寸。
 *
 * @param ratio 受支持的画面比例。
 * @param tier 1K、2K 或 4K 分辨率档位。
 * @returns 固定的宽高像素元组；配置不完整时抛出错误以暴露原型漂移。
 */
export function getPreviewImageSize(
  ratio: PreviewImageAspectRatio,
  tier: PreviewImageSizeTier
): readonly [number, number] {
  const size = previewImageSizeMatrix[ratio]?.[tier];
  if (!size) {
    throw new Error(`Unsupported preview image size: ${ratio}/${tier}`);
  }
  return size;
}

/**
 * 判断自定义分辨率是否处于生产环境允许的输入边界内。
 *
 * @param width 用户输入的像素宽度。
 * @param height 用户输入的像素高度。
 * @returns 是否为整数、处于尺寸边界内且宽高比不超过 3:1。
 */
export function isPreviewCustomResolutionValid(width: number, height: number) {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= MIN_IMAGE_DIMENSION &&
    width <= MAX_IMAGE_DIMENSION &&
    height >= MIN_IMAGE_DIMENSION &&
    height <= MAX_IMAGE_DIMENSION &&
    Math.max(width / height, height / width) <= MAX_IMAGE_ASPECT_RATIO
  );
}

/**
 * 按生产环境尺寸归一化规则计算自定义分辨率的合法输出尺寸。
 *
 * @param width 用户输入的像素宽度。
 * @param height 用户输入的像素高度。
 * @returns 经过 16 像素步进和系统像素范围校正后的宽高。
 */
export function normalizePreviewCustomResolution(
  width: number,
  height: number
): readonly [number, number] {
  const normalized = normalizeValidImageSize({ width, height });
  const dimensions = parseImageSize(normalized);
  if (!dimensions) {
    throw new Error(
      `Unable to normalize preview image size: ${width}x${height}`
    );
  }
  return [dimensions.width, dimensions.height];
}
