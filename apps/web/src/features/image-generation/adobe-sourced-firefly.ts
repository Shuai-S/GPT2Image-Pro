/**
 * 「Adobe 来源」api 后端的 firefly-* → gpt 反向转换（纯函数，DB-free，可单测）。
 *
 * 背景：上游实为 Adobe 的 gpt 格式 api 后端（image_backend_api.adobe_sourced=true）会参与
 * firefly 候选；当请求模型为 firefly-* 时，须把它反向转换成普通 gpt 请求：
 * - 出站 model 取 firefly id 里的家族名（gpt-image-2 / nano-banana-pro …），
 *   后端自配 model 非空则优先（可选覆盖）；
 * - 出站 size 由全量 id（firefly-<家族>-<res>-<ratio>）的 res/ratio 推出，族级 id 沿用请求 size。
 *
 * 使用方：image-generation/service.ts 派发层（出站 model 不经 getModel 的 gpt-image-only
 * 校验，故 nano-banana 家族也能由本后端服务）。
 */

import type { AdobeImageFamily } from "@repo/shared/adobe";
import {
  gptImagePixelsFromRatio,
  resolveFireflyImageModel,
  sizeFromRatio,
} from "@repo/shared/adobe/firefly-direct";

// 受支持的图像家族（即 gpt 侧模型名）。按最长前缀匹配（见下），顺序无关。
export const ADOBE_IMAGE_FAMILIES: AdobeImageFamily[] = [
  "gpt-image-2",
  "gpt-image-1.5",
  "nano-banana",
  "nano-banana2",
  "nano-banana-pro",
];

/**
 * 从请求 model（firefly-<family>[-<res>-<ratio>]）解析家族；解析不到返回 null。
 * 按最长前缀匹配，避免 nano-banana 误吞 nano-banana-pro / nano-banana2。
 */
export function pickAdobeFamilyFromModel(
  model: string | null | undefined
): AdobeImageFamily | null {
  const normalized = String(model || "")
    .trim()
    .toLowerCase();
  if (!normalized.startsWith("firefly-")) return null;
  const rest = normalized.slice("firefly-".length);
  const byLength = [...ADOBE_IMAGE_FAMILIES].sort(
    (a, b) => b.length - a.length
  );
  for (const family of byLength) {
    if (rest === family || rest.startsWith(`${family}-`)) return family;
  }
  return null;
}

/**
 * firefly-* 请求 → gpt 出站 { model, size }。
 *
 * @param input.requestedModel 请求模型；非 firefly- 前缀或截不出家族时返回 null（走普通路径）。
 * @param input.requestedSize 请求自带 size（族级 id 时沿用）。
 * @param input.backendModel 后端自配 model；非空则作出站 model 覆盖，否则用截得的家族名。
 */
export function reverseFireflyToGptRequest(input: {
  requestedModel: string | null | undefined;
  requestedSize: string | null | undefined;
  backendModel?: string | null;
}): { model: string; size: string | undefined } | null {
  const requested = String(input.requestedModel || "").trim();
  if (!requested.toLowerCase().startsWith("firefly-")) return null;
  const family = pickAdobeFamilyFromModel(requested);
  if (!family) return null;

  const conf = resolveFireflyImageModel(requested);
  let size = input.requestedSize ?? undefined;
  if (conf) {
    const pixels = family.startsWith("gpt-image")
      ? gptImagePixelsFromRatio(conf.aspectRatio, conf.outputResolution)
      : sizeFromRatio(conf.aspectRatio, conf.outputResolution);
    if (pixels) size = `${pixels.width}x${pixels.height}`;
  }
  return { model: input.backendModel?.trim() || family, size };
}
