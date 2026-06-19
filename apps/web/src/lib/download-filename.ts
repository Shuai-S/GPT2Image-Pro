/**
 * 下载文件名生成工具（纯函数，确定性输出）。
 *
 * 格式: gpt2image_<prompt 哈希 8 位>_<ISO8601 文件名安全时间戳>.<扩展名>
 * 示例: gpt2image_a3f2b1c0_2026-06-19T14-30-52-123Z.png
 *
 * 哈希用于区分不同 prompt，方便用户在本地按 prompt 整理文件；
 * 时间戳精确到毫秒（UTC），避免同一秒内多次生成的文件名冲突。
 * 相同 (prompt, createdAt) 输入永远产出同一文件名，与下载时间/时区无关。
 */

/**
 * DJB2 哈希:轻量、纯字符串输入、冲突率足够低（仅用于文件名区分，非安全场景）。
 * 输出 base36 字符串，取前 length 位。
 */
function promptHash(prompt: string, length: number): string {
  let hash = 5381;
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) + hash + prompt.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(length, "0").slice(0, length);
}

/**
 * ISO 时间字符串 -> 文件名安全的 ISO 8601 UTC 时间戳（精确到毫秒）。
 * 冒号替换为连字符以兼容所有文件系统。
 * 示例: 2026-06-19T14-30-52-123Z
 * 解析失败时回退到原始字符串的 sanitize 版本。
 */
function formatTimestamp(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) {
    return isoString.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 30);
  }
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}-${pad2(d.getUTCMinutes())}-${pad2(d.getUTCSeconds())}` +
    `-${pad3(d.getUTCMilliseconds())}Z`
  );
}

/**
 * 生成 GPT2Image 标准下载文件名。
 *
 * @param prompt    - 生成时使用的提示词
 * @param createdAt - 生成时间 ISO 字符串
 * @param extension - 文件扩展名（不带点），默认 "png"
 * @returns 格式化文件名，如 gpt2image_a3f2b1c0_2026-06-19T14-30-52-123Z.png
 */
export function generateDownloadFilename(
  prompt: string,
  createdAt: string,
  extension = "png"
): string {
  const hash = promptHash(prompt, 8);
  const time = formatTimestamp(createdAt);
  return `gpt2image_${hash}_${time}.${extension}`;
}
