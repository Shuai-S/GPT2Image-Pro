/**
 * 创作页附件的对象存储预上传客户端。
 *
 * 职责：向站内薄 API 申请 UOL 直传授权，把文件直接 PUT 到对象存储，并在后续
 * chat/edit 控制请求中改传稳定引用。每个 File/用途缓存一次上传；S3/CORS 不可用时
 * 回退现有 multipart，且 PUT 明确 credentials: omit，不向第三方携带站内凭据。
 */

import {
  directUploadAuthorizationSchema,
  type DirectUploadPurpose,
  type DirectUploadReference,
} from "@repo/shared/storage/direct-upload";

const directUploadCache = new WeakMap<
  File,
  Map<DirectUploadPurpose, Promise<DirectUploadReference | null>>
>();

/**
 * 为单个文件申请授权并执行无凭据 PUT。
 *
 * @param file 浏览器本地文件。
 * @param purpose 业务用途，决定服务端 MIME 白名单与 key 前缀。
 * @param signal 可选取消信号；取消会向上抛且不会污染缓存。
 * @returns 成功时稳定引用；S3 未配置或 PUT/CORS 失败时返回 null 触发 multipart 回退。
 * @sideEffects 发起一次站内 JSON 请求和一次对象存储 PUT。
 */
async function uploadFileDirectly(
  file: File,
  purpose: DirectUploadPurpose,
  signal?: AbortSignal
): Promise<DirectUploadReference | null> {
  const authorizationResponse = await fetch("/api/upload/presigned", {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      purpose,
      filename: file.name,
      contentType: file.type,
      contentLength: file.size,
    }),
  });
  if (
    authorizationResponse.status === 501 ||
    authorizationResponse.status === 503
  ) {
    return null;
  }
  if (!authorizationResponse.ok) {
    throw new Error(
      `Failed to authorize direct upload (${authorizationResponse.status})`
    );
  }

  let authorizationBody: unknown;
  try {
    authorizationBody = await authorizationResponse.json();
  } catch {
    throw new Error("Direct upload authorization returned invalid JSON");
  }
  const authorization = directUploadAuthorizationSchema.safeParse(
    authorizationBody
  );
  if (!authorization.success) {
    throw new Error("Direct upload authorization returned an invalid response");
  }

  try {
    const uploadResponse = await fetch(authorization.data.uploadUrl, {
      method: "PUT",
      credentials: "omit",
      signal,
      headers: { "Content-Type": authorization.data.uploadContentType },
      body: file,
    });
    if (!uploadResponse.ok) return null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
  return authorization.data.reference;
}

/**
 * 获取同一 File/用途的共享上传 Promise。
 *
 * @param file 本地文件对象。
 * @param purpose 上传用途。
 * @param signal 首次上传使用的取消信号。
 * @returns 成功引用或 multipart 回退标志 null。
 * @sideEffects 首次调用写入进程内 WeakMap；失败 Promise 会立即移除以允许重试。
 */
function getCachedDirectUpload(
  file: File,
  purpose: DirectUploadPurpose,
  signal?: AbortSignal
): Promise<DirectUploadReference | null> {
  // 服务端会在编辑终态删除蒙版对象；不得复用已消费引用，否则第二次提交会读到 404。
  if (purpose === "image-mask") {
    return uploadFileDirectly(file, purpose, signal);
  }
  let byPurpose = directUploadCache.get(file);
  if (!byPurpose) {
    byPurpose = new Map();
    directUploadCache.set(file, byPurpose);
  }
  const cached = byPurpose.get(purpose);
  if (cached) return cached;

  const pending = uploadFileDirectly(file, purpose, signal).catch((error) => {
    byPurpose?.delete(purpose);
    throw error;
  });
  byPurpose.set(purpose, pending);
  return pending;
}

/**
 * 把一组同用途文件全部预上传；只在全部成功时返回引用数组。
 *
 * @param files 保持业务顺序的文件列表。
 * @param purpose 所有文件共同用途。
 * @param signal 可选取消信号。
 * @returns 与 files 同序的引用；任一基础设施回退时返回 null。
 */
export async function uploadFilesDirectly(
  files: File[],
  purpose: DirectUploadPurpose,
  signal?: AbortSignal
): Promise<DirectUploadReference[] | null> {
  if (files.length === 0) return [];
  const references = await Promise.all(
    files.map((file) => getCachedDirectUpload(file, purpose, signal))
  );
  return references.every(
    (reference): reference is DirectUploadReference => reference !== null
  )
    ? references
    : null;
}

/**
 * 优先向 FormData 追加稳定引用，基础设施不可用时追加原始 File。
 *
 * @param input 表单、文件、用途、引用字段和兼容 multipart 字段生成器。
 * @returns `direct` 表示控制面不含文件正文，`multipart` 表示沿用旧路径。
 * @sideEffects 可能预上传对象，并修改传入 FormData。
 */
export async function appendDirectUploadsOrFiles(input: {
  formData: FormData;
  files: File[];
  purpose: DirectUploadPurpose;
  referenceField: string;
  fileField: (index: number, count: number) => string;
  signal?: AbortSignal;
}): Promise<"direct" | "multipart"> {
  if (input.files.length === 0) return "direct";
  const references = await uploadFilesDirectly(
    input.files,
    input.purpose,
    input.signal
  );
  if (references) {
    input.formData.append(input.referenceField, JSON.stringify(references));
    return "direct";
  }
  input.files.forEach((file, index) => {
    input.formData.append(input.fileField(index, input.files.length), file);
  });
  return "multipart";
}
