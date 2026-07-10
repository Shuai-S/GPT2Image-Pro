/**
 * 可编辑文件持久任务结果契约。
 *
 * 职责：把 worker 产出的稳定对象引用编码到数据库，并在轮询或 callback 时生成当前
 * 有效的签名 URL。内部 bucket/key 不进入公开响应，过期签名也不会写入任务表。
 */

import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { z } from "zod";

import type {
  EditableFileOutput,
  EditableFileStorageReference,
} from "@/features/image-generation/editable-file-operations";

const editableFileStorageReferenceSchema = z.object({
  bucket: z.string().min(1).max(128),
  key: z.string().min(1).max(1024),
  contentType: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
});

export const editableTaskStoredResultSchema = z.object({
  object: z.literal("editable_file_task"),
  kind: z.enum(["ppt", "psd"]),
  result: z.object({
    conversation_id: z.string().min(1),
    primary_storage: editableFileStorageReferenceSchema,
    zip_storage: editableFileStorageReferenceSchema.nullable(),
  }),
  credits_charged: z.number().nonnegative(),
});

export type EditableTaskStoredResult = z.infer<
  typeof editableTaskStoredResultSchema
>;

/**
 * 从业务结果构建可持久化的终态载荷。
 *
 * 只保存稳定对象引用、会话 ID 与扣费数值；调用者把返回值写入 result_payload。
 */
export function buildEditableTaskStoredResult(input: {
  kind: "ppt" | "psd";
  output: EditableFileOutput;
}): EditableTaskStoredResult {
  return {
    object: "editable_file_task",
    kind: input.kind,
    result: {
      conversation_id: input.output.conversationId,
      primary_storage: input.output.primaryStorage,
      zip_storage: input.output.zipStorage,
    },
    credits_charged: input.output.creditsCharged,
  };
}

/** 判断对象引用是否属于当前任务用户的可编辑文件产物前缀。 */
function isOwnedEditableOutput(
  userId: string,
  reference: EditableFileStorageReference
): boolean {
  return reference.key.startsWith(`${userId}/editable-file-results/`);
}

/**
 * 把数据库中的稳定结果物化为对外响应。
 *
 * 非法 schema、越过用户前缀或无法签名时返回 undefined，由调用方按内部数据损坏处理；
 * 每次调用都会重新生成 URL，因此轮询和 callback 不会返回数据库中的过期签名。
 */
export function materializeEditableTaskResult(
  payload: unknown,
  userId: string
): Record<string, unknown> | undefined {
  const parsed = editableTaskStoredResultSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  const primary = parsed.data.result.primary_storage;
  const zip = parsed.data.result.zip_storage;
  if (
    !isOwnedEditableOutput(userId, primary) ||
    (zip !== null && !isOwnedEditableOutput(userId, zip))
  ) {
    return undefined;
  }

  const primaryUrl = buildSignedStorageImageUrl(primary.key, primary.bucket);
  const zipUrl = zip
    ? buildSignedStorageImageUrl(zip.key, zip.bucket)
    : null;
  if (!primaryUrl || (zip && !zipUrl)) return undefined;

  return {
    object: parsed.data.object,
    kind: parsed.data.kind,
    result: {
      conversation_id: parsed.data.result.conversation_id,
      primary_url: primaryUrl,
      zip_url: zipUrl,
    },
    credits_charged: parsed.data.credits_charged,
  };
}
