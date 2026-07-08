/**
 * 可编辑文件(PPT/PSD)编排的纯函数(DB-free,便于单测):base64/data URL 解码、扩展名、服务名。
 * 使用方:editable-file-operations.ts。无 @repo 依赖。
 */

/** 解码 base64 或 data URL(data:<mime>;base64,<data>)→ 输入图文件(供 chatgpt-web 上传)。 */
export function decodeBase64DataUrl(
  input: string,
  index: number
): { data: Buffer; name: string; type: string } {
  const trimmed = input.trim();
  const match = trimmed.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);
  const mime = (match?.[1] || "image/png").trim();
  const base64 = (match ? match[2] || "" : trimmed).replace(/\s/g, "");
  const data = Buffer.from(base64, "base64");
  const ext = mime.split("/")[1]?.split("+")[0] || "png";
  return { data, name: `input_${index}.${ext}`, type: mime };
}

/** 产物落地扩展名:zip 恒 zip;主文件 psd→psd、ppt→pptx。 */
export function editableFileExtension(
  kind: "ppt" | "psd",
  isZip: boolean
): string {
  if (isZip) return "zip";
  return kind === "psd" ? "psd" : "pptx";
}

/** 扣费/审计用的服务名(区分 ppt/psd)。 */
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
