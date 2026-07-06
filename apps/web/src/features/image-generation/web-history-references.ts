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
    url.startsWith("/api/storage/") ||
    url.includes("/api/storage/")
  );
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

export function getLatestWebHistoryImageReference(
  history: ChatHistoryMessage[] | undefined
): WebHistoryImageReference | null {
  for (let index = (history || []).length - 1; index >= 0; index--) {
    const message = history?.[index];
    if (message?.role !== "assistant" || message.error) continue;

    const imageUrl = getActiveHistoryVariantImageUrl(message);
    if (!imageUrl || !isUsableHistoryImageUrl(imageUrl)) continue;

    return {
      imageUrl,
      fileName: `web-history-assistant-${index + 1}`,
      sourceId: imageUrl,
    };
  }

  return null;
}

export async function downloadWebHistoryImageReference(
  reference: WebHistoryImageReference,
  options?: DownloadWebHistoryImageReferenceOptions
): Promise<ImageInputFile> {
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
          return storage.getObject(
            storageReference.key,
            storageReference.bucket
          );
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
