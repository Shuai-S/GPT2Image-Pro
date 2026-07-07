/**
 * Google 图像协议适配器。
 *
 * 职责：把站内统一图像参数转换为 Google Gemini Interactions API 请求，并把
 * Interactions / generateContent / Imagen predict 的常见响应形态收敛成 GenerateImageResult。
 * 使用方：image-generation/service.ts 的 pool-api google 协议后端。
 * 关键依赖：官方 Google API 使用 x-goog-api-key 鉴权，不能套用 OpenAI Bearer 头。
 */
import type {
  GenerateImageResult,
  ImageInputFile,
  ImageOutputFormat,
} from "./types";

export const DEFAULT_GOOGLE_IMAGE_MODEL = "gemini-2.5-flash-image";

type GoogleImageOutput = {
  imageBase64: string;
  mimeType?: string;
};

type GoogleImageRequestInput = {
  model: string;
  prompt: string;
  images?: ImageInputFile[];
  size?: string;
  outputFormat?: ImageOutputFormat;
};

// 判断未知值是否为普通对象；所有 Google 响应解析都先经此处收窄。
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// 读取非空字符串；空字符串视为未提供，避免把空错误或空图片写入结果。
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

// 去掉 baseUrl 尾部斜杠，保证拼接 /interactions 时不会出现双斜杠。
function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

// 计算宽高最大公约数，用于把像素尺寸化简成 Google 宽高比。
function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

/**
 * 把本站 WxH 尺寸转换成 Google response_format 可接受的宽高比和 1K/2K 档位。
 *
 * @param size 站内尺寸字符串，例如 1024x1024、1536x1024、auto。
 * @returns Google 图像响应格式字段；无法解析时只返回 type/mime_type。
 */
export function buildGoogleImageResponseFormat(params: {
  size?: string;
  outputFormat?: ImageOutputFormat;
}) {
  const mimeType =
    params.outputFormat === "jpeg"
      ? "image/jpeg"
      : params.outputFormat === "webp"
        ? "image/webp"
        : "image/png";
  const responseFormat: {
    type: "image";
    mime_type: string;
    aspect_ratio?: string;
    image_size?: "1K" | "2K";
  } = {
    type: "image",
    mime_type: mimeType,
  };

  const match = (params.size || "").trim().match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) return responseFormat;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0) {
    return responseFormat;
  }
  const divisor = gcd(width, height);
  responseFormat.aspect_ratio = `${width / divisor}:${height / divisor}`;
  responseFormat.image_size = Math.max(width, height) >= 1536 ? "2K" : "1K";
  return responseFormat;
}

/**
 * 获取 Google 图像模型名。
 *
 * @param requestedModel 用户请求模型。
 * @param configuredModel 后端配置默认模型。
 * @returns Google 原生模型名；两者都为空时用当前推荐的 flash-image 默认值。
 */
export function getGoogleImageModel(
  requestedModel?: string,
  configuredModel?: string
) {
  const configured = configuredModel?.trim();
  if (configured) return configured;
  const requested = requestedModel?.trim();
  if (requested && !requested.startsWith("gpt-image-")) return requested;
  return DEFAULT_GOOGLE_IMAGE_MODEL;
}

/**
 * 构造 Google Interactions API URL。
 *
 * @param baseUrl 管理端配置的 Google API baseUrl，通常为 https://generativelanguage.googleapis.com/v1beta。
 * @returns 可直接 POST 的 /interactions URL；若管理员已填完整路径则保持不重复追加。
 */
export function buildGoogleImageUrl(baseUrl: string) {
  const normalized = stripTrailingSlash(baseUrl);
  return normalized.endsWith("/interactions")
    ? normalized
    : `${normalized}/interactions`;
}

/**
 * 构造 Google 图像请求体。
 *
 * @param params 统一图像参数。
 * @returns Google Interactions API JSON body。
 */
export function buildGoogleImageRequest(params: GoogleImageRequestInput) {
  return {
    model: params.model,
    input: [
      { type: "text", text: params.prompt },
      ...(params.images || []).map((image) => ({
        type: "image",
        mime_type: image.type || "image/png",
        data: Buffer.from(image.data).toString("base64"),
      })),
    ],
    response_format: buildGoogleImageResponseFormat({
      size: params.size,
      outputFormat: params.outputFormat,
    }),
  };
}

/**
 * 构造 Google API 请求头。
 *
 * @param apiKey 管理端保存的 Google API key。
 * @returns 不含 Authorization 的请求头，避免把 OpenAI Bearer 格式错发给 Google。
 */
export function getGoogleImageHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };
}

// 将可能的 base64 图片写入输出数组；无数据时跳过。
function pushImage(
  outputs: GoogleImageOutput[],
  data: unknown,
  mimeType?: unknown
) {
  const imageBase64 = stringValue(data);
  if (!imageBase64) return;
  outputs.push({
    imageBase64,
    mimeType: stringValue(mimeType),
  });
}

// 从 Google content part / interaction output item 中提取图片数据。
function collectPartImage(outputs: GoogleImageOutput[], part: unknown) {
  if (!isRecord(part)) return;
  const inlineData = isRecord(part.inlineData)
    ? part.inlineData
    : isRecord(part.inline_data)
      ? part.inline_data
      : null;
  if (inlineData) {
    pushImage(
      outputs,
      inlineData.data,
      inlineData.mimeType ?? inlineData.mime_type
    );
  }
  pushImage(outputs, part.data, part.mime_type ?? part.mimeType);
}

// 汇总 Google 多种接口形态中的图片，兼容 Interactions、generateContent 与 Imagen predict。
function collectGoogleImages(payload: unknown): GoogleImageOutput[] {
  const outputs: GoogleImageOutput[] = [];
  if (!isRecord(payload)) return outputs;

  if (isRecord(payload.output_image)) {
    pushImage(
      outputs,
      payload.output_image.data,
      payload.output_image.mime_type ?? payload.output_image.mimeType
    );
  }

  if (Array.isArray(payload.output)) {
    for (const item of payload.output) collectPartImage(outputs, item);
  }

  if (Array.isArray(payload.candidates)) {
    for (const candidate of payload.candidates) {
      if (!isRecord(candidate) || !isRecord(candidate.content)) continue;
      const parts = candidate.content.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) collectPartImage(outputs, part);
    }
  }

  if (Array.isArray(payload.predictions)) {
    for (const prediction of payload.predictions) {
      if (!isRecord(prediction)) continue;
      pushImage(
        outputs,
        prediction.bytesBase64Encoded ?? prediction.bytes_base64_encoded,
        prediction.mimeType ?? prediction.mime_type
      );
    }
  }

  if (Array.isArray(payload.generatedImages)) {
    for (const item of payload.generatedImages) {
      if (!isRecord(item)) continue;
      const image = isRecord(item.image) ? item.image : item;
      pushImage(
        outputs,
        image.imageBytes ?? image.image_bytes ?? image.bytesBase64Encoded,
        image.mimeType ?? image.mime_type
      );
    }
  }

  return outputs;
}

// 提取 Gemini 文本部分，便于无图或混合响应时给前端/测活展示诊断文本。
function collectGoogleText(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.candidates))
    return undefined;
  const chunks: string[] = [];
  for (const candidate of payload.candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content)) continue;
    const parts = candidate.content.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (isRecord(part) && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  return chunks.length ? chunks.join("\n") : undefined;
}

/**
 * 提取 Google 错误文本。
 *
 * @param payload 上游 JSON 响应。
 * @returns 可展示给管理员/用户的错误消息；无明确错误时返回 null。
 */
export function getGoogleImageError(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (isRecord(payload.error)) {
    return (
      stringValue(payload.error.message) ||
      stringValue(payload.error.status) ||
      "Google API returned an error"
    );
  }
  if (isRecord(payload.promptFeedback)) {
    return stringValue(payload.promptFeedback.blockReason) || null;
  }
  if (Array.isArray(payload.candidates)) {
    const finishReasons = payload.candidates
      .map((candidate) =>
        isRecord(candidate) ? stringValue(candidate.finishReason) : undefined
      )
      .filter((value): value is string => Boolean(value));
    if (finishReasons.some((reason) => reason !== "STOP")) {
      return `Google API finish reason: ${finishReasons.join(", ")}`;
    }
  }
  return null;
}

/**
 * 把 Google JSON 响应收敛为站内图像结果。
 *
 * @param payload Google Interactions / generateContent / Imagen predict 响应。
 * @returns GenerateImageResult；无图时带 error 与可能的文本响应。
 */
export function parseGoogleImagePayload(payload: unknown): GenerateImageResult {
  const outputs = collectGoogleImages(payload);
  if (!outputs.length) {
    const responseText = collectGoogleText(payload);
    return {
      error:
        getGoogleImageError(payload) || "Google API returned no image data",
      responseText,
    };
  }

  return {
    imageBase64: outputs[0]?.imageBase64,
    imageOutputCount: outputs.length,
    imageOutputs: outputs.map((output, index) => ({
      imageBase64: output.imageBase64,
      index,
    })),
    responseText: collectGoogleText(payload),
  };
}

/**
 * 解析 Google API HTTP 响应。
 *
 * @param response fetch 返回值。
 * @returns GenerateImageResult；HTTP 非 2xx 会包含状态码与响应摘要。
 */
export async function parseGoogleImageResponse(
  response: Response
): Promise<GenerateImageResult> {
  const text = await response.text().catch(() => "");
  let payload: unknown = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    return {
      error:
        getGoogleImageError(payload) ||
        `Google API returned HTTP ${response.status}: ${text.slice(0, 500)}`,
    };
  }
  return parseGoogleImagePayload(payload);
}
