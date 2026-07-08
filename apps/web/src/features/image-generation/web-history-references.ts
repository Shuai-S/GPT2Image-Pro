import path from "node:path";
import { fetchPublicImage } from "../external-api/safe-image-fetch";
import type { ChatHistoryMessage, ImageInputFile } from "./types";

// 远程历史图片下载的正文大小上限（25MB），防止伪造 content-length 的 OOM DoS。
const MAX_HISTORY_IMAGE_BYTES = 25 * 1024 * 1024;

// 仅允许读取生成图所在的对象存储桶（默认 generations）。
const GENERATIONS_BUCKET =
  process.env.NEXT_PUBLIC_GENERATIONS_BUCKET_NAME?.trim() || "generations";

/**
 * 校验客户端提交的历史 storage 引用（审计 S-H2，越权/IDOR 防护）。
 *
 * WHY: 历史 imageUrl 形如 /api/storage/<bucket>/<key> 时由客户端完全控制，
 * 直接 storage.getObject(key,bucket) 会让服务器代读任意桶/任意 key 的对象。
 * 此处强制：(1) 仅允许 generations 桶（封堵跨桶任意读，如 avatars 或内部桶）；
 * (2) 拒绝路径穿越 ../ 与绝对路径（封堵越目录读取）。
 * 残留：同桶跨用户读取需已知受害者完整 key（含 nanoid(32) 高熵段，不可猜），
 * 彻底闭合需把请求方 userId 透传至此做前缀校验（见 docs/TODO 待办）。
 */
function assertAllowedStorageReference(reference: StorageImageReference) {
  if (reference.bucket !== GENERATIONS_BUCKET) {
    throw new Error("History storage reference bucket is not allowed.");
  }
  const key = reference.key;
  const segments = key.split("/");
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("\0") ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("History storage reference key is not allowed.");
  }
}

export type WebHistoryImageReference = {
  imageUrl: string;
  fileName: string;
  sourceId: string;
};

type StorageImageReference = {
  bucket: string;
  key: string;
  extension: string;
};

type DownloadWebHistoryImageReferenceOptions = {
  signal?: AbortSignal;
  readStorageImage?: (reference: StorageImageReference) => Promise<Buffer>;
};

function isUsableHistoryImageUrl(url: string) {
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("data:image/") ||
    url.startsWith("/api/storage/") ||
    url.includes("/api/storage/")
  );
}

// data:image/<mime>;base64,<payload> → 直接解出二进制(用户上传的参考图在会话历史里以 data URL
// 持久化,见 create-page-client 的附件预览)。非 base64 或畸形则返回 null。
function parseDataImageUrl(imageUrl: string) {
  const match = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!match) return null;
  try {
    return { type: match[1] || "image/png", data: Buffer.from(match[2] || "", "base64") };
  } catch {
    return null;
  }
}

function parseStorageImageUrl(imageUrl: string) {
  try {
    const parsed = new URL(imageUrl, "http://localhost");
    if (!parsed.pathname.includes("/api/storage/")) return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const storageIndex = segments.indexOf("storage");
    if (storageIndex < 0) return null;

    const bucket = segments[storageIndex + 1];
    const keySegments = segments.slice(storageIndex + 2);
    if (!bucket || keySegments.length === 0) return null;

    return {
      bucket,
      key: keySegments.map((segment) => decodeURIComponent(segment)).join("/"),
      extension: path.extname(parsed.pathname).toLowerCase(),
    };
  } catch {
    return null;
  }
}

function mimeTypeFromExtension(extension: string) {
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/png";
  }
}

function getActiveHistoryVariantImageUrl(message: ChatHistoryMessage) {
  const variants = message.variants || [];
  const variant = variants[message.activeVariant || 0] || variants[0];
  return variant?.imageUrl;
}

/**
 * 收集会话历史里最近的图片引用(assistant 生成图 + 用户上传的参考图),最新在前、去重、限量。
 *
 * WHY:web 后端跨轮上下文靠"同账号原生续接"(复用 conversationId);一旦换号(账号冷却/被占用)
 * 续接失效,此时必须把参考图重新作为附件带上。若只看 assistant 生成图,会漏掉"上一轮是纯文字、
 * 参考图是用户上传"的常见情形(实测:先问"这是什么"、再"变成青苹果",换号后丢图)。这里同时纳入
 * 用户上传图,覆盖该场景。
 */
export function getRecentWebHistoryImageReferences(
  history: ChatHistoryMessage[] | undefined,
  options?: { limit?: number }
): WebHistoryImageReference[] {
  const limit = Math.max(1, options?.limit ?? 3);
  const refs: WebHistoryImageReference[] = [];
  const seen = new Set<string>();
  const add = (imageUrl: string | undefined, fileName: string) => {
    if (!imageUrl || !isUsableHistoryImageUrl(imageUrl) || seen.has(imageUrl)) {
      return;
    }
    seen.add(imageUrl);
    refs.push({ imageUrl, fileName, sourceId: imageUrl });
  };
  for (
    let index = (history || []).length - 1;
    index >= 0 && refs.length < limit;
    index--
  ) {
    const message = history?.[index];
    if (!message || message.error) continue;
    const label =
      message.role === "assistant"
        ? `web-history-assistant-${index + 1}`
        : `web-history-user-${index + 1}`;
    // assistant 生成图:站内在 variant.imageUrl,外部 chat/completions 在 message.imageUrls;两处都收。
    if (message.role === "assistant") {
      add(getActiveHistoryVariantImageUrl(message), label);
    }
    // 用户上传图 / 外部 assistant 图:message.imageUrls,同条消息内也按最新在前。
    for (const url of [...(message.imageUrls || [])].reverse()) {
      if (refs.length >= limit) break;
      add(url, label);
    }
  }
  return refs;
}

/**
 * 把会话历史压成一段文字转录(用户/助手轮次),供 web 后端"非原生续接"(换号/无 conversationId,
 * 如外部 /v1/chat/completions)时随 prompt 带上,弥补 ChatGPT 服务端会话上下文的缺失。
 *
 * WHY:web 换号后原生续接失效,只重附图会丢多轮文字上下文;codex 侧靠 buildResponsesInput 全量
 * 重建不受影响。这里生成简洁转录,超 maxChars 时**从最旧逐轮丢弃、保留最近**(最近轮次对当前请求
 * 最相关),再兜底按尾部截断。图片仅以 [附图]/[生成了图片] 标注(实际像素由 getRecentWebHistoryImage
 * References 另行重附)。
 */
export function buildWebHistoryTranscript(
  history: ChatHistoryMessage[] | undefined,
  maxChars: number
): string {
  if (!history?.length || maxChars <= 0) return "";
  const lines: string[] = [];
  for (const message of history) {
    if (message.error) continue;
    if (message.role === "user") {
      const text = (message.text || "").trim();
      const note = message.imageUrls?.length ? " [附图]" : "";
      if (text || note) lines.push(`用户: ${text}${note}`);
      continue;
    }
    const variant =
      message.variants?.[message.activeVariant || 0] || message.variants?.[0];
    const text = (variant?.text || message.text || "").trim();
    const note =
      variant?.imageUrl || message.imageUrls?.length ? " [生成了图片]" : "";
    if (text || note) lines.push(`助手: ${text}${note}`);
  }
  if (!lines.length) return "";
  // 超限:从最旧逐轮丢弃保留最近;单轮仍超则尾部硬截断。
  while (lines.join("\n").length > maxChars && lines.length > 1) {
    lines.shift();
  }
  const joined = lines.join("\n");
  return joined.length > maxChars ? joined.slice(-maxChars) : joined;
}

export async function downloadWebHistoryImageReference(
  reference: WebHistoryImageReference,
  options?: DownloadWebHistoryImageReferenceOptions
): Promise<ImageInputFile> {
  const dataImage = parseDataImageUrl(reference.imageUrl);
  if (dataImage) {
    if (dataImage.data.byteLength > MAX_HISTORY_IMAGE_BYTES) {
      throw new Error("ChatGPT Web history image exceeds size limit.");
    }
    const extension =
      dataImage.type === "image/jpeg"
        ? "jpg"
        : dataImage.type === "image/webp"
          ? "webp"
          : dataImage.type.slice(6);
    return {
      data: dataImage.data,
      name: reference.fileName.endsWith(`.${extension}`)
        ? reference.fileName
        : `${reference.fileName}.${extension}`,
      type: dataImage.type,
      url: reference.imageUrl,
    };
  }

  const storageReference = parseStorageImageUrl(reference.imageUrl);
  if (storageReference) {
    assertAllowedStorageReference(storageReference);
    const data = options?.readStorageImage
      ? await options.readStorageImage(storageReference)
      : await (async () => {
          // 动态导入：getStorageProvider 会经 system-settings 间接拉入 @repo/database，
          // 改为按需导入可让本模块的纯校验逻辑保持 DB-free 可单测。
          const { getStorageProvider } = await import(
            "@repo/shared/storage/providers"
          );
          const storage = await getStorageProvider();
          return storage.getObject(storageReference.key, storageReference.bucket);
        })();
    const type = mimeTypeFromExtension(storageReference.extension);
    const extension = type === "image/jpeg" ? "jpg" : type.slice(6);
    return {
      data,
      name: reference.fileName.endsWith(`.${extension}`)
        ? reference.fileName
        : `${reference.fileName}.${extension}`,
      type,
      url: reference.imageUrl,
    };
  }

  // SSRF 防护（审计 S-H1）：历史图片 URL 来自客户端提交的聊天历史，必须走
  // fetchPublicImage（逐跳 redirect:manual + assertPublicImageUrl 封堵内网/云元数据），
  // 不可裸 fetch 任意客户端 URL。
  const response = await fetchPublicImage(reference.imageUrl, {
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(
      `ChatGPT Web history image download failed: HTTP ${response.status}`
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const mimeType = contentType.split(";")[0]?.trim() || "";
  const type = mimeType.startsWith("image/") ? mimeType : "image/png";
  const extension =
    type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";

  const data = Buffer.from(await response.arrayBuffer());
  if (data.byteLength > MAX_HISTORY_IMAGE_BYTES) {
    throw new Error("ChatGPT Web history image exceeds size limit.");
  }

  return {
    data,
    name: reference.fileName.endsWith(`.${extension}`)
      ? reference.fileName
      : `${reference.fileName}.${extension}`,
    type,
    url: reference.imageUrl,
  };
}
