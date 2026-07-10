/**
 * 生图入口的直传对象引用解析与有限读取。
 *
 * 职责：从小型 multipart 控制请求解析稳定引用，重新校验用户/桶/用途归属，并按
 * 套餐剩余总量从对象存储串行读取。使用方是站内 chat/edit 路由；签名 PUT URL 从不
 * 参与身份判断，实际对象字节数必须与授权声明一致。
 */

import {
  assertDirectUploadReference,
  directUploadReferenceSchema,
  DirectUploadInputError,
  type DirectUploadPurpose,
  type DirectUploadReference,
} from "@repo/shared/storage/direct-upload";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { logWarn } from "@repo/shared/logger";
import type { ImageInputFile } from "./types";

const MAX_DIRECT_UPLOAD_REFERENCE_JSON_CHARACTERS = 64 * 1024;
const DIRECT_UPLOAD_READ_URL_EXPIRES_SECONDS = 15 * 60;

export type LoadedDirectUploadInputs = {
  imageInputs: ImageInputFile[];
  temporaryImages: Array<{ bucket: string; key: string; url: string }>;
  totalBytes: number;
};

/**
 * 从 FormData 的单个 JSON 字段解析直传引用数组。
 *
 * @param formData 已由 Next.js 解析的小型控制面表单。
 * @param fieldName 引用数组字段名。
 * @param maxReferences 当前业务/套餐允许的最大引用数。
 * @returns 仅完成结构校验的引用；归属由加载阶段结合会话用户校验。
 * @throws DirectUploadInputError 字段重复、过长、非 JSON 或数组超限时。
 */
export function parseDirectUploadReferences(
  formData: FormData,
  fieldName: string,
  maxReferences: number
): DirectUploadReference[] {
  const values = formData.getAll(fieldName);
  if (values.length === 0) return [];
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new DirectUploadInputError(`Invalid ${fieldName}`);
  }
  const serialized = values[0];
  if (serialized.length > MAX_DIRECT_UPLOAD_REFERENCE_JSON_CHARACTERS) {
    throw new DirectUploadInputError(`${fieldName} is too large`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new DirectUploadInputError(`${fieldName} must be valid JSON`);
  }
  const result = directUploadReferenceSchema
    .array()
    .max(maxReferences)
    .safeParse(parsed);
  if (!result.success) {
    throw new DirectUploadInputError(`Invalid ${fieldName}`);
  }
  return result.data;
}

/**
 * 读取当前用户拥有的直传对象，并在读取前后执行硬大小约束。
 *
 * @param input 用户、用途、引用和套餐单文件/总请求限制。
 * @returns 可直接送入现有生图管线的 Buffer 输入和短期读取 URL。
 * @sideEffects 读取运行时桶设置与对象存储；不删除对象，生命周期沿用 requests 清理。
 * @throws DirectUploadInputError 归属、声明/实际大小或对象读取不合法时。
 */
export async function loadDirectUploadedInputs(input: {
  userId: string;
  purpose: DirectUploadPurpose;
  references: DirectUploadReference[];
  maxFileSizeBytes: number;
  maxTotalBytes: number;
  existingBytes?: number;
}): Promise<LoadedDirectUploadInputs> {
  if (input.references.length === 0) {
    return { imageInputs: [], temporaryImages: [], totalBytes: 0 };
  }
  const bucket =
    (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
    "generations";
  const references = input.references.map((reference) =>
    assertDirectUploadReference({
      reference,
      userId: input.userId,
      bucket,
      purpose: input.purpose,
      maxFileSizeBytes: input.maxFileSizeBytes,
    })
  );
  const existingBytes = Math.max(0, input.existingBytes ?? 0);
  const declaredBytes = references.reduce(
    (total, reference) => total + reference.contentLength,
    0
  );
  if (existingBytes + declaredBytes > input.maxTotalBytes) {
    throw new DirectUploadInputError(
      "Direct uploads exceed the request size limit"
    );
  }

  const storage = await getStorageProvider();
  const imageInputs: ImageInputFile[] = [];
  const temporaryImages: Array<{ bucket: string; key: string; url: string }> =
    [];
  let totalBytes = 0;

  // 串行读取使同时在内存中的未校验对象不超过一个；每次 maxBytes 还会随总预算递减。
  for (const reference of references) {
    const remainingBytes = input.maxTotalBytes - existingBytes - totalBytes;
    let data: Buffer;
    try {
      data = await storage.getObject(reference.key, reference.bucket, {
        maxBytes: Math.min(input.maxFileSizeBytes, remainingBytes),
      });
    } catch (error) {
      logWarn("直传对象读取失败", {
        source: "direct-upload-input",
        causeType: error instanceof Error ? error.name : typeof error,
      });
      throw new DirectUploadInputError("Failed to read direct upload object");
    }
    if (data.length <= 0 || data.length !== reference.contentLength) {
      throw new DirectUploadInputError(
        "Direct upload object size does not match its authorization"
      );
    }
    totalBytes += data.length;
    if (existingBytes + totalBytes > input.maxTotalBytes) {
      throw new DirectUploadInputError(
        "Direct uploads exceed the request size limit"
      );
    }

    let url: string | undefined;
    if (
      reference.purpose === "image-source" ||
      reference.purpose === "image-mask"
    ) {
      try {
        url = await storage.getSignedUrl(
          reference.key,
          reference.bucket,
          DIRECT_UPLOAD_READ_URL_EXPIRES_SECONDS
        );
      } catch (error) {
        logWarn("直传对象读取签名失败", {
          source: "direct-upload-input",
          causeType: error instanceof Error ? error.name : typeof error,
        });
        throw new DirectUploadInputError(
          "Failed to create direct upload read authorization"
        );
      }
      temporaryImages.push({
        bucket: reference.bucket,
        key: reference.key,
        url,
      });
    }

    imageInputs.push({
      data,
      name: reference.filename,
      type: reference.contentType,
      url,
      storageBucket: reference.bucket,
      storageKey: reference.key,
    });
  }

  return { imageInputs, temporaryImages, totalBytes };
}
