/**
 * 用户直传对象的纯契约与安全校验。
 *
 * 职责：按上传用途派生可信 MIME/扩展名，生成绑定用户的对象 key，并校验后续
 * 控制面请求携带的稳定对象引用。使用方包括 UOL 直传授权、上传 API 和生图入口；
 * 本文件不访问数据库或对象存储，便于 DB-free 单测。
 */

import { nanoid } from "nanoid";
import { z } from "zod";

/** 站内直传允许的业务用途。不同用途拥有独立 MIME 白名单和 key 前缀。 */
export const DIRECT_UPLOAD_PURPOSES = [
  "image-source",
  "image-mask",
  "chat-attachment",
  "document",
] as const;

export type DirectUploadPurpose = (typeof DIRECT_UPLOAD_PURPOSES)[number];

/** 客户端在后续控制面请求中提交的稳定对象引用。 */
export const directUploadReferenceSchema = z
  .object({
    bucket: z.string().min(1).max(255),
    key: z.string().min(1).max(512),
    filename: z.string().min(1).max(160),
    contentType: z.string().min(1).max(128),
    contentLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    purpose: z.enum(DIRECT_UPLOAD_PURPOSES),
  })
  .strict();

export type DirectUploadReference = z.infer<
  typeof directUploadReferenceSchema
>;

/** UOL 返回给浏览器的直传授权；uploadUrl 只用于 PUT，不作为资源身份。 */
export const directUploadAuthorizationSchema = z.object({
  uploadUrl: z.string().min(1),
  uploadContentType: z.string().min(1),
  expiresIn: z.number().int().positive(),
  reference: directUploadReferenceSchema,
});

export type DirectUploadAuthorization = z.infer<
  typeof directUploadAuthorizationSchema
>;

/** 输入不满足用途白名单时抛出的可识别校验错误。 */
export class DirectUploadInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectUploadInputError";
  }
}

type DirectUploadMetadata = {
  filename: string;
  contentType: string;
  uploadContentType: string;
  storageExtension: string;
};

const IMAGE_CONTENT_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const CHAT_ATTACHMENT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".log",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".sql",
  ".sh",
  ".toml",
  ".ini",
  ".env",
  ".pdf",
]);

const CHAT_ATTACHMENT_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/json",
  "application/jsonl",
  "application/ld+json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/xml",
]);

const DOCUMENT_CONTENT_TYPES = new Map([
  [".pdf", "application/pdf"],
  [".doc", "application/msword"],
  [
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  [".md", "text/markdown"],
  [".txt", "text/plain"],
]);

/**
 * 取文件名最后一个扩展名并转小写。
 *
 * @param filename 客户端声明的原始文件名。
 * @returns 含前导点的扩展名；没有扩展名时返回空字符串。
 */
function getExtension(filename: string): string {
  const normalized = filename.trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index) : "";
}

/**
 * 把不可信文件名规范为仅用于展示和上游附件名称的安全值。
 *
 * @param filename 客户端文件名。
 * @returns 去除路径、控制字符且最多 160 字符的文件名。
 * @throws DirectUploadInputError 文件名为空或规范化后为空。
 */
function sanitizeFilename(filename: string): string {
  const withoutPathSeparators = filename.replace(/[\\/]+/g, "_");
  const normalized = Array.from(withoutPathSeparators)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? "_" : character;
    })
    .join("")
    .trim()
    .slice(0, 160);
  if (!normalized) {
    throw new DirectUploadInputError("Filename is required");
  }
  return normalized;
}

/**
 * 为文本/代码附件派生服务端认可的逻辑 MIME。
 *
 * @param extension 原始文件名扩展名。
 * @param claimedContentType 浏览器声明的 MIME。
 * @returns 后续构造 File 时使用的 MIME。
 * @throws DirectUploadInputError 扩展名与 MIME 均不在白名单时。
 */
function resolveChatAttachmentContentType(
  extension: string,
  claimedContentType: string
): string {
  if (
    !CHAT_ATTACHMENT_EXTENSIONS.has(extension) &&
    !CHAT_ATTACHMENT_CONTENT_TYPES.has(claimedContentType)
  ) {
    throw new DirectUploadInputError("Unsupported chat attachment type");
  }
  if (extension === ".pdf" || claimedContentType === "application/pdf") {
    return "application/pdf";
  }
  if (CHAT_ATTACHMENT_CONTENT_TYPES.has(claimedContentType)) {
    return claimedContentType;
  }
  if (extension === ".json" || extension === ".jsonl") {
    return "application/json";
  }
  if (extension === ".xml") return "application/xml";
  if (extension === ".yaml" || extension === ".yml") {
    return "application/yaml";
  }
  if (extension === ".md" || extension === ".markdown") {
    return "text/markdown";
  }
  return "text/plain";
}

/**
 * 按业务用途派生可信上传元数据。
 *
 * 图片沿用真实 MIME 供上游解码；文本/文档对象一律以 octet-stream 存储，防止私有
 * 附件被同源读取路由误当可执行 HTML。逻辑 MIME 仍保留在引用中供服务端处理。
 *
 * @param input 不可信的用途、文件名和 MIME。
 * @returns 安全文件名、逻辑 MIME、PUT MIME 与对象扩展名。
 * @throws DirectUploadInputError 输入不在用途白名单时。
 */
export function resolveDirectUploadMetadata(input: {
  purpose: DirectUploadPurpose;
  filename: string;
  contentType: string;
}): DirectUploadMetadata {
  const filename = sanitizeFilename(input.filename);
  const claimedContentType = input.contentType.trim().toLowerCase();
  const extension = getExtension(input.filename);

  if (input.purpose === "image-source") {
    const storageExtension = IMAGE_CONTENT_TYPES.get(claimedContentType);
    if (!storageExtension) {
      throw new DirectUploadInputError(
        "Source images must be PNG, JPEG, or WebP files"
      );
    }
    return {
      filename,
      contentType: claimedContentType,
      uploadContentType: claimedContentType,
      storageExtension,
    };
  }

  if (input.purpose === "image-mask") {
    if (claimedContentType !== "image/png") {
      throw new DirectUploadInputError("Mask must be a PNG file");
    }
    return {
      filename,
      contentType: "image/png",
      uploadContentType: "image/png",
      storageExtension: "png",
    };
  }

  if (input.purpose === "chat-attachment") {
    return {
      filename,
      contentType: resolveChatAttachmentContentType(
        extension,
        claimedContentType
      ),
      uploadContentType: "application/octet-stream",
      storageExtension: "bin",
    };
  }

  const documentContentType = DOCUMENT_CONTENT_TYPES.get(extension);
  if (!documentContentType) {
    throw new DirectUploadInputError("Unsupported document type");
  }
  return {
    filename,
    contentType: documentContentType,
    uploadContentType: "application/octet-stream",
    storageExtension: "bin",
  };
}

/**
 * 生成只属于当前用户和用途的不可预测对象 key。
 *
 * @param userId 已鉴权用户 ID。
 * @param purpose 上传用途。
 * @param storageExtension 服务端派生的安全扩展名。
 * @returns `{encodedUserId}/requests/{purpose}/{random}.{ext}`。
 * @throws DirectUploadInputError 用户 ID 或扩展名为空时。
 */
export function createDirectUploadKey(
  userId: string,
  purpose: DirectUploadPurpose,
  storageExtension: string
): string {
  const normalizedUserId = userId.trim();
  const normalizedExtension = storageExtension.replace(/^\.+/, "");
  if (!normalizedUserId || !normalizedExtension) {
    throw new DirectUploadInputError("Invalid direct upload key input");
  }
  return `${encodeURIComponent(normalizedUserId)}/requests/${purpose}/${nanoid()}.${normalizedExtension}`;
}

/**
 * 校验稳定对象引用是否属于指定用户、桶与用途。
 *
 * 签名 URL 只是短期传输凭据，不能证明后续请求的资源归属；服务端必须重新执行本
 * 校验，并在读取对象后按实际字节数再次执行套餐上限校验。
 *
 * @param input 不可信对象引用及当前请求安全上下文。
 * @returns 通过 Zod 收窄且确认归属的引用。
 * @throws DirectUploadInputError 结构、桶、用途、用户前缀或声明大小不合法时。
 */
export function assertDirectUploadReference(input: {
  reference: unknown;
  userId: string;
  bucket: string;
  purpose: DirectUploadPurpose;
  maxFileSizeBytes: number;
}): DirectUploadReference {
  const parsed = directUploadReferenceSchema.safeParse(input.reference);
  if (!parsed.success) {
    throw new DirectUploadInputError("Invalid direct upload reference");
  }
  const reference = parsed.data;
  const expectedPrefix = `${encodeURIComponent(input.userId.trim())}/requests/${input.purpose}/`;
  if (
    reference.bucket !== input.bucket ||
    reference.purpose !== input.purpose ||
    !reference.key.startsWith(expectedPrefix) ||
    reference.key.slice(expectedPrefix.length).includes("/") ||
    reference.key.includes("..")
  ) {
    throw new DirectUploadInputError("Direct upload reference is not owned");
  }
  if (reference.contentLength > input.maxFileSizeBytes) {
    throw new DirectUploadInputError("Direct upload exceeds the plan limit");
  }

  const metadata = resolveDirectUploadMetadata({
    purpose: reference.purpose,
    filename: reference.filename,
    contentType: reference.contentType,
  });
  if (metadata.contentType !== reference.contentType) {
    throw new DirectUploadInputError("Direct upload content type is invalid");
  }
  return reference;
}
