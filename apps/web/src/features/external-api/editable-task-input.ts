/**
 * 可编辑文件持久任务输入处理。
 *
 * 职责：规范化 PPT/PSD 请求、计算稳定 requestHash，并把 base64 图片写入对象存储；
 * 数据库仅保存受控 bucket/key/MIME/size 引用，worker 再按引用恢复 File 输入。
 */

import { createHash } from "node:crypto";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { z } from "zod";

import {
  decodeEditableInputImages,
  type EditableInputImage,
  MAX_EDITABLE_INPUT_IMAGE_BYTES,
  MAX_EDITABLE_INPUT_IMAGES,
  MAX_EDITABLE_INPUT_TOTAL_BYTES,
} from "@/features/image-generation/editable-file-util";

export type EditableTaskInputReference = {
  bucket: string;
  key: string;
  name: string;
  contentType: string;
  size: number;
};

export const editableTaskInputReferenceSchema = z.object({
  bucket: z.string().min(1).max(128),
  key: z.string().min(1).max(1024),
  name: z.string().min(1).max(255),
  contentType: z.string().min(1).max(128).startsWith("image/"),
  size: z.number().int().positive().max(MAX_EDITABLE_INPUT_IMAGE_BYTES),
});

export const editableTaskRequestPayloadSchema = z.object({
  prompt: z.string().min(1).max(8000),
  inputReferences: z
    .array(editableTaskInputReferenceSchema)
    .max(MAX_EDITABLE_INPUT_IMAGES),
});

/** 获取可编辑文件输入对象使用的受保护存储桶。 */
async function editableInputBucket(): Promise<string> {
  return (
    (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
    "generations"
  );
}

/**
 * 计算可编辑文件请求的稳定 SHA-256 哈希。
 *
 * prompt 会 trim，图片按原顺序对真实解码字节和 MIME 做摘要；相同 clientRequestId
 * 只有内容完全一致才允许重放已有任务。
 */
export function hashEditableTaskRequest(input: {
  kind: "ppt" | "psd";
  prompt: string;
  images: Array<{ data: Buffer; type: string }>;
}): string {
  const hash = createHash("sha256");
  hash.update(input.kind);
  hash.update("\0");
  hash.update(input.prompt.trim());
  for (const image of input.images) {
    hash.update("\0");
    hash.update(image.type);
    hash.update("\0");
    hash.update(image.data);
  }
  return hash.digest("hex");
}

/**
 * 解码并校验可编辑文件的 base64 输入图。
 *
 * 限制最多 4 张、单张 25 MiB、合计 50 MiB；PSD 必须至少一张。无效或空字节输入
 * 立即抛错，避免把任意大字符串写入数据库或对象存储。
 */
export function decodeEditableTaskImages(input: {
  kind: "ppt" | "psd";
  base64Images: string[];
}): EditableInputImage[] {
  return decodeEditableInputImages(input);
}

/**
 * 把已解码输入图写入任务专属对象前缀。
 *
 * 若中途失败，会尽力删除本次已写对象后重新抛错；返回值只含 worker 恢复所需引用。
 */
export async function storeEditableTaskImages(input: {
  taskId: string;
  userId: string;
  images: Array<{ data: Buffer; name: string; type: string }>;
}): Promise<EditableTaskInputReference[]> {
  if (input.images.length === 0) return [];
  const bucket = await editableInputBucket();
  const storage = await getStorageProvider();
  const references: EditableTaskInputReference[] = [];
  try {
    for (const [index, image] of input.images.entries()) {
      const extension = image.name.split(".").pop() || "bin";
      const key = `${input.userId}/editable-task-inputs/${input.taskId}/${index + 1}.${extension}`;
      await storage.putObject(key, bucket, image.data, image.type);
      references.push({
        bucket,
        key,
        name: image.name,
        contentType: image.type,
        size: image.data.byteLength,
      });
    }
    return references;
  } catch (error) {
    await Promise.allSettled(
      references.map((reference) =>
        storage.deleteObject(reference.key, reference.bucket)
      )
    );
    throw error;
  }
}

/**
 * 从受控对象引用恢复 runEditableFileForUser 兼容的 data URL。
 *
 * worker 只读取数据库中由 enqueue 写入的任务专属 key；单个对象仍复核声明 size 上限，
 * 防止对象被替换成超大内容造成内存压力。
 */
export async function loadEditableTaskImages(input: {
  userId: string;
  taskId: string;
  references: readonly EditableTaskInputReference[];
}): Promise<EditableInputImage[]> {
  const storage = await getStorageProvider();
  const results: EditableInputImage[] = [];
  let totalBytes = 0;
  const expectedPrefix = `${input.userId}/editable-task-inputs/${input.taskId}/`;
  for (const rawReference of input.references) {
    const reference = editableTaskInputReferenceSchema.parse(rawReference);
    if (
      !reference.key.startsWith(expectedPrefix) ||
      reference.key.slice(expectedPrefix.length).includes("/")
    ) {
      throw new Error("Invalid editable task input reference");
    }
    const data = await storage.getObject(reference.key, reference.bucket, {
      maxBytes: Math.min(MAX_EDITABLE_INPUT_IMAGE_BYTES, reference.size + 1),
    });
    if (
      data.byteLength !== reference.size ||
      data.byteLength > MAX_EDITABLE_INPUT_IMAGE_BYTES
    ) {
      throw new Error("Editable task input exceeds 25 MiB");
    }
    totalBytes += data.byteLength;
    if (totalBytes > MAX_EDITABLE_INPUT_TOTAL_BYTES) {
      throw new Error("Editable task inputs exceed 50 MiB");
    }
    results.push({
      data: Buffer.from(data),
      name: reference.name,
      type: reference.contentType,
    });
  }
  return results;
}

/**
 * 删除任务输入对象并返回每个合法对象的执行结果。
 *
 * @param input 已鉴权用户、任务 ID 和数据库中的未知引用集合。
 * @returns 所有合法且属于该任务前缀的对象删除结果；非法引用被安全忽略。
 * @sideEffects 并行调用对象存储删除；单个失败不阻断其他删除尝试。
 */
async function settleEditableTaskInputCleanup(input: {
  userId: string;
  taskId: string;
  references: readonly EditableTaskInputReference[];
}): Promise<PromiseSettledResult<void>[]> {
  const storage = await getStorageProvider();
  const expectedPrefix = `${input.userId}/editable-task-inputs/${input.taskId}/`;
  const references = input.references.flatMap((rawReference) => {
    const parsed = editableTaskInputReferenceSchema.safeParse(rawReference);
    if (
      !parsed.success ||
      !parsed.data.key.startsWith(expectedPrefix) ||
      parsed.data.key.slice(expectedPrefix.length).includes("/")
    ) {
      return [];
    }
    return [parsed.data];
  });
  return await Promise.allSettled(
    references.map(async (reference) => {
      await storage.deleteObject(reference.key, reference.bucket);
    })
  );
}

/**
 * 尽力删除任务输入对象。
 *
 * @param input 用户、任务和受控对象引用。
 * @returns 所有删除尝试结束后完成。
 * @sideEffects 并行删除合法对象；保留既有语义，单个删除失败不会向调用方抛出。
 */
export async function cleanupEditableTaskInputs(input: {
  userId: string;
  taskId: string;
  references: readonly EditableTaskInputReference[];
}): Promise<void> {
  await settleEditableTaskInputCleanup(input);
}

/**
 * 严格删除任务输入对象并汇总报告失败。
 *
 * @param input 用户、任务和经严格 payload 提取的受控对象引用。
 * @returns 所有合法对象均删除成功时完成；非法引用被安全忽略。
 * @throws 存储初始化或任一合法对象删除失败时抛出，供 retention 保留任务行重试。
 * @sideEffects 并行删除对象存储中的任务输入。
 */
export async function cleanupEditableTaskInputsStrict(input: {
  userId: string;
  taskId: string;
  references: readonly EditableTaskInputReference[];
}): Promise<void> {
  const deletions = await settleEditableTaskInputCleanup(input);
  const failed = deletions.filter(
    (deletion): deletion is PromiseRejectedResult =>
      deletion.status === "rejected"
  );
  if (failed.length > 0) {
    throw new AggregateError(
      failed.map((deletion) => deletion.reason),
      `Failed to delete ${failed.length} editable task input object(s)`
    );
  }
}
