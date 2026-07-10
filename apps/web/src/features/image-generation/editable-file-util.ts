/**
 * 可编辑文件(PPT/PSD)编排的纯函数。
 *
 * 职责：严格解码并限制外部图片输入，提供产物扩展名和计费服务名。该文件保持
 * DB-free，供同步 handler、持久 worker 与单元测试共同复用。
 */

export const MAX_EDITABLE_INPUT_IMAGES = 4;
export const MAX_EDITABLE_INPUT_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_EDITABLE_INPUT_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_EDITABLE_INPUT_BASE64_CHARACTERS =
  Math.ceil(MAX_EDITABLE_INPUT_IMAGE_BYTES / 3) * 4 + 256;

export type EditableInputImage = {
  data: Buffer;
  name: string;
  type: string;
};

/**
 * 从裸 base64 或 data URL 中提取 MIME 与编码正文。
 *
 * 在移除空白和分配 Buffer 前先检查字符串长度；data URL 必须明确使用 base64，MIME
 * 必须是 image/*。非法字符、错误 padding 与空正文都会抛错。
 */
function parseBase64ImageInput(input: string): {
  base64: string;
  mime: string;
} {
  if (input.length > MAX_EDITABLE_INPUT_BASE64_CHARACTERS) {
    throw new Error("editable image input exceeds 25 MiB");
  }

  const trimmed = input.trim();
  const dataUrl = trimmed.match(/^data:([^;,]+);base64,([\s\S]*)$/i);
  if (trimmed.startsWith("data:") && !dataUrl) {
    throw new Error("editable image data URL must use base64 encoding");
  }

  const mime = (dataUrl?.[1] ?? "image/png").trim().toLowerCase();
  if (!mime.startsWith("image/") || mime.length > 128) {
    throw new Error("editable image MIME type is invalid");
  }

  const unpadded = (dataUrl?.[2] ?? trimmed).replace(/\s/g, "");
  if (
    unpadded.length === 0 ||
    unpadded.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(unpadded)
  ) {
    throw new Error("editable image base64 is invalid");
  }
  const base64 = unpadded.padEnd(
    unpadded.length + ((4 - (unpadded.length % 4)) % 4),
    "="
  );
  return { base64, mime };
}

/**
 * 解码一张 base64 图片供 ChatGPT Web 上传。
 *
 * @param input 裸 base64 或 data:image/*;base64 URL。
 * @param index 生成稳定文件名所用的 1-based 序号。
 * @returns 受大小限制的图片 Buffer、文件名与 MIME。
 * @throws 输入非法、为空或解码后超过 25 MiB。
 */
export function decodeBase64DataUrl(
  input: string,
  index: number
): EditableInputImage {
  const { base64, mime } = parseBase64ImageInput(input);
  const data = Buffer.from(base64, "base64");
  if (data.byteLength === 0) {
    throw new Error("editable image input is empty");
  }
  if (data.byteLength > MAX_EDITABLE_INPUT_IMAGE_BYTES) {
    throw new Error("editable image input exceeds 25 MiB");
  }
  const ext = mime.split("/")[1]?.split("+")[0] || "png";
  return { data, name: `input_${index}.${ext}`, type: mime };
}

/**
 * 校验并解码一次可编辑文件请求的全部图片。
 *
 * PSD 至少一张，所有类型最多四张；累计解码字节不能超过 50 MiB。函数只分配受控
 * Buffer，不访问数据库、网络或对象存储。
 */
export function decodeEditableInputImages(input: {
  kind: "ppt" | "psd";
  base64Images: readonly string[];
}): EditableInputImage[] {
  if (input.kind === "psd" && input.base64Images.length === 0) {
    throw new Error("base64_images is empty");
  }
  if (input.base64Images.length > MAX_EDITABLE_INPUT_IMAGES) {
    throw new Error(
      `base64_images must contain at most ${MAX_EDITABLE_INPUT_IMAGES} images`
    );
  }

  let totalBytes = 0;
  return input.base64Images.map((raw, index) => {
    const image = decodeBase64DataUrl(raw, index + 1);
    totalBytes += image.data.byteLength;
    if (totalBytes > MAX_EDITABLE_INPUT_TOTAL_BYTES) {
      throw new Error("base64_images total size exceeds 50 MiB");
    }
    return image;
  });
}

/** 计算产物扩展名；zip 恒为 zip，主文件按 kind 返回 pptx 或 psd。 */
export function editableFileExtension(
  kind: "ppt" | "psd",
  isZip: boolean
): string {
  if (isZip) return "zip";
  return kind === "psd" ? "psd" : "pptx";
}

/** 返回区分 PPT/PSD 的扣费与审计服务名。 */
export function editableFileServiceName(kind: "ppt" | "psd"): string {
  return `editable_file_${kind}`;
}

/**
 * 无可用 web 账号时的报错消息(供 editable-file-operations 抛出)。
 * WHY 措辞:必须含子串 "no available backend",让 external-api 的 classifyExternalApiError
 *   归为 no_available_image_backend(HTTP 503 server_error),而非落到 502 upstream_error
 *   兜底(会被客户端当可重试而疯狂重试)。有些用户的池只有 api/codex 后端、无 web 账号,
 *   PPT/PSD 走不了 web 会话,必须清晰报错而非硬跑非 web 后端。改文案务必保留该子串(有单测兜底)。
 */
export const NO_WEB_ACCOUNT_ERROR =
  "No available backend for editable file generation: PPT/PSD requires a ChatGPT web (Plus/Pro) account, but none is available for this plan or account pool.";
