/**
 * 普通图像与视频持久任务的请求协议和输入对象存取。
 *
 * 职责：用严格 Zod schema 限定数据库 request_payload 只含执行标量和对象引用，并把
 * image edit/video 的媒体字节放入用户与任务隔离的对象前缀。generation worker 负责
 * 读取与清理；传输层不得把 File、Buffer、base64 或 data URL 写入任务 JSON。
 */

import { getStorageProvider } from "@repo/shared/storage/providers";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { z } from "zod";

const MAX_GENERATION_IDS = 10_000;
const MAX_INPUT_REFERENCES = 10_000;
const MAX_TASK_INPUT_BYTES = 200 * 1024 * 1024;
const MAX_TASK_INPUT_TOTAL_BYTES = 200 * 1024 * 1024;
const TASK_INPUT_SCOPE = "async-task-inputs";

const generationIdSchema = z.string().trim().min(1).max(128);
const generationIdsSchema = z
  .array(generationIdSchema)
  .min(1)
  .max(MAX_GENERATION_IDS)
  .refine(
    (generationIds) => new Set(generationIds).size === generationIds.length,
    "Generation IDs must be unique"
  );
const responseFormatSchema = z.enum(["url", "b64_json"]);
const thinkingSchema = z.enum([
  "minimal",
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
]);
const imageOperationInputSchema = z
  .object({
    prompt: z.string().min(1).max(32_000),
    promptOptimization: z.boolean().optional(),
    moderationPromptRepair: z.boolean().optional(),
    moderationBlockRiskLevel: z.enum(["low", "medium", "high"]).optional(),
    size: z.string().min(1).max(64).optional(),
    model: z.string().trim().min(1).max(200),
    gptModel: z.string().trim().min(1).max(200).optional(),
    thinking: thinkingSchema.optional(),
    quality: z.enum(["auto", "low", "medium", "high"]).optional(),
    moderation: z.enum(["auto", "low"]).optional(),
    outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
    outputCompression: z.number().int().min(0).max(100).optional(),
    background: z.enum(["transparent", "opaque", "auto"]).optional(),
    transparentMatte: z.boolean().optional(),
    forceWebBackend: z.boolean().optional(),
    forceFirefly: z.boolean().optional(),
    hdRepair: z.boolean().optional(),
    blockRepair: z.boolean().optional(),
    repairPrompt: z.string().max(8000).optional(),
  })
  .strict();

/** generation worker 可恢复的一条媒体输入对象引用。 */
export type GenerationTaskInputReference = {
  bucket: string;
  key: string;
  name: string;
  contentType: string;
  size: number;
  role: "source" | "mask" | "first" | "last" | "reference";
};

/** worker 从受控对象存储恢复的一条媒体输入。 */
export type LoadedGenerationTaskInput = GenerationTaskInputReference & {
  data: Buffer;
};

/** enqueue 写对象存储时使用的已校验媒体输入。 */
export type GenerationTaskInputObject = {
  data: Buffer;
  name: string;
  contentType: string;
  role: GenerationTaskInputReference["role"];
};

export const generationTaskInputReferenceSchema = z
  .object({
    bucket: z.string().trim().min(1).max(128),
    key: z.string().trim().min(1).max(1024),
    name: z.string().trim().min(1).max(255),
    contentType: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^image\/[a-z0-9.+-]+$/i),
    size: z.number().int().positive().max(MAX_TASK_INPUT_BYTES),
    role: z.enum(["source", "mask", "first", "last", "reference"]),
  })
  .strict();

const imageGenerateTaskPayloadSchema = z
  .object({
    kind: z.literal("image_generate"),
    relayOnly: z.boolean(),
    generationIds: generationIdsSchema,
    createdAtEpochSeconds: z.number().int().nonnegative(),
    responseFormat: responseFormatSchema,
    input: imageOperationInputSchema,
  })
  .strict();

const imageEditTaskPayloadSchema = z
  .object({
    kind: z.literal("image_edit"),
    relayOnly: z.boolean(),
    generationIds: generationIdsSchema,
    createdAtEpochSeconds: z.number().int().nonnegative(),
    responseFormat: responseFormatSchema,
    input: imageOperationInputSchema,
    inputReferences: z
      .array(
        generationTaskInputReferenceSchema.refine(
          (reference) =>
            reference.role === "source" ||
            (reference.role === "mask" &&
              reference.contentType === "image/png"),
          "Image edit references must use source or mask roles"
        )
      )
      .min(1)
      .max(MAX_INPUT_REFERENCES)
      .refine(
        (references) =>
          references.some((reference) => reference.role === "source") &&
          references.filter((reference) => reference.role === "mask").length <=
            1,
        "Image edit requires a source and at most one PNG mask"
      ),
  })
  .strict();

const videoTaskPayloadSchema = z
  .object({
    kind: z.literal("video"),
    relayOnly: z.boolean(),
    generationId: generationIdSchema,
    createdAtEpochSeconds: z.number().int().nonnegative(),
    input: z
      .object({
        prompt: z.string().min(1).max(32_000),
        model: z.string().trim().min(1).max(200),
        negativePrompt: z.string().max(8000).optional(),
      })
      .strict(),
    inputReferences: z
      .array(
        generationTaskInputReferenceSchema.refine(
          (reference) =>
            reference.role === "first" ||
            reference.role === "last" ||
            reference.role === "reference",
          "Video references must use first, last, or reference roles"
        )
      )
      .max(3),
  })
  .strict();

export const generationTaskRequestPayloadSchema = z.discriminatedUnion("kind", [
  imageGenerateTaskPayloadSchema,
  imageEditTaskPayloadSchema,
  videoTaskPayloadSchema,
]);

export type GenerationTaskRequestPayload = z.infer<
  typeof generationTaskRequestPayloadSchema
>;

export const generationTaskResultPayloadSchema = z.union([
  z.object({ generationIds: generationIdsSchema }).strict(),
  z.object({ generationId: generationIdSchema }).strict(),
]);

export type GenerationTaskResultPayload = z.infer<
  typeof generationTaskResultPayloadSchema
>;

/**
 * 获取普通 generation 任务输入使用的存储桶。
 *
 * @returns 当前 generations bucket；未配置时回退到 generations。
 * @sideEffects 读取带缓存的运行时设置。
 */
async function getGenerationTaskInputBucket(): Promise<string> {
  return (
    (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
    "generations"
  );
}

/**
 * 生成只由 MIME 决定的安全扩展名。
 *
 * @param contentType 已由传输层校验的图片 MIME。
 * @returns 不含路径字符的短扩展名；未知图片类型使用 img。
 * @sideEffects 无。
 */
function extensionForContentType(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "img";
}

/**
 * 返回用户与任务隔离的可信对象 key 前缀。
 *
 * @param userId 已鉴权用户 ID。
 * @param taskId 服务端生成的 task ID。
 * @returns 不带媒体文件名的对象前缀。
 * @sideEffects 无。
 */
function taskInputPrefix(userId: string, taskId: string): string {
  return `${userId}/${TASK_INPUT_SCOPE}/${taskId}/`;
}

/**
 * 校验引用严格归属于指定用户和任务，阻断路径穿越与跨 bucket 读取。
 *
 * @param reference Zod 已收窄的对象引用。
 * @param expectedBucket 当前任务允许读取的唯一 bucket。
 * @param expectedPrefix 当前用户与任务的唯一 key 前缀。
 * @throws bucket/key 越界时抛出错误；调用方必须让任务 fail-closed。
 * @sideEffects 无。
 */
function assertOwnedTaskReference(
  reference: GenerationTaskInputReference,
  expectedBucket: string,
  expectedPrefix: string
): void {
  const suffix = reference.key.slice(expectedPrefix.length);
  if (
    reference.bucket !== expectedBucket ||
    !reference.key.startsWith(expectedPrefix) ||
    !suffix ||
    suffix.includes("/") ||
    suffix === "." ||
    suffix === ".."
  ) {
    throw new Error("Invalid generation task input reference");
  }
}

/**
 * 把已校验媒体写入任务专属对象前缀。
 *
 * @param input 用户、任务和有界 Buffer 输入；调用方不得传入未校验媒体。
 * @returns 可安全写入 request_payload 的标量对象引用。
 * @throws 空对象、单对象或总字节超限、存储失败时抛错；部分写入会尽力回滚。
 * @sideEffects 写对象存储，失败时删除本次已写对象。
 */
export async function storeGenerationTaskInputs(input: {
  userId: string;
  taskId: string;
  inputs: readonly GenerationTaskInputObject[];
}): Promise<GenerationTaskInputReference[]> {
  if (input.inputs.length > MAX_INPUT_REFERENCES) {
    throw new Error("Generation task has too many input objects");
  }
  const totalBytes = input.inputs.reduce(
    (total, item) => total + item.data.byteLength,
    0
  );
  if (totalBytes > MAX_TASK_INPUT_TOTAL_BYTES) {
    throw new Error("Generation task inputs exceed 200 MiB");
  }

  const bucket = await getGenerationTaskInputBucket();
  const storage = await getStorageProvider();
  const prefix = taskInputPrefix(input.userId, input.taskId);
  const references: GenerationTaskInputReference[] = [];
  try {
    for (const [index, item] of input.inputs.entries()) {
      if (
        item.data.byteLength <= 0 ||
        item.data.byteLength > MAX_TASK_INPUT_BYTES
      ) {
        throw new Error(
          "Generation task input must be between 1 byte and 200 MiB"
        );
      }
      const candidate = generationTaskInputReferenceSchema.parse({
        bucket,
        key: `${prefix}${index + 1}.${extensionForContentType(item.contentType)}`,
        name: item.name,
        contentType: item.contentType,
        size: item.data.byteLength,
        role: item.role,
      });
      const contentType = candidate.contentType;
      const key = `${prefix}${index + 1}.${extensionForContentType(contentType)}`;
      await storage.putObject(key, bucket, item.data, contentType);
      references.push({ ...candidate, key });
    }
    return generationTaskInputReferenceSchema.array().parse(references);
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
 * 按受控引用恢复 generation worker 的媒体字节。
 *
 * @param input 用户、任务和已从严格 payload 解析的引用。
 * @returns 保持原顺序的 Buffer、MIME、名称与 role。
 * @throws bucket/key 越界、对象缺失、声明大小不符或总量超限时 fail-closed。
 * @sideEffects 从对象存储读取有上限的正文。
 */
export async function loadGenerationTaskInputs(input: {
  userId: string;
  taskId: string;
  references: readonly GenerationTaskInputReference[];
}): Promise<LoadedGenerationTaskInput[]> {
  const references = generationTaskInputReferenceSchema
    .array()
    .max(MAX_INPUT_REFERENCES)
    .parse(input.references);
  const bucket = references[0]?.bucket;
  if (!bucket) return [];
  if (references.some((reference) => reference.bucket !== bucket)) {
    throw new Error("Generation task input references span multiple buckets");
  }
  const storage = await getStorageProvider();
  const prefix = taskInputPrefix(input.userId, input.taskId);
  const loaded: LoadedGenerationTaskInput[] = [];
  let totalBytes = 0;

  for (const reference of references) {
    assertOwnedTaskReference(reference, bucket, prefix);
    const data = await storage.getObject(reference.key, reference.bucket, {
      maxBytes: Math.min(MAX_TASK_INPUT_BYTES, reference.size + 1),
    });
    if (data.byteLength !== reference.size) {
      throw new Error(
        "Generation task input size does not match its reference"
      );
    }
    totalBytes += data.byteLength;
    if (totalBytes > MAX_TASK_INPUT_TOTAL_BYTES) {
      throw new Error("Generation task inputs exceed 200 MiB");
    }
    loaded.push({ ...reference, data: Buffer.from(data) });
  }
  return loaded;
}

/**
 * 删除任务专属输入对象并汇总报告失败。
 *
 * @param input 用户、任务和待清理引用；非法引用会被忽略而非用于任意删除。
 * @returns 所有合法引用均完成删除尝试且成功时结束。
 * @throws 一个或多个合法对象删除失败时抛 AggregateError；非法引用仍被忽略。
 * @sideEffects 并行删除对象存储；单个失败不会阻断其他删除尝试。
 */
export async function cleanupGenerationTaskInputs(input: {
  userId: string;
  taskId: string;
  references: readonly GenerationTaskInputReference[];
}): Promise<void> {
  const references = input.references.flatMap((rawReference) => {
    const parsed = generationTaskInputReferenceSchema.safeParse(rawReference);
    return parsed.success ? [parsed.data] : [];
  });
  const bucket = references[0]?.bucket;
  if (!bucket) return;
  const storage = await getStorageProvider();
  const prefix = taskInputPrefix(input.userId, input.taskId);
  const deletions = await Promise.allSettled(
    references.map(async (reference) => {
      try {
        assertOwnedTaskReference(reference, bucket, prefix);
      } catch {
        return;
      }
      await storage.deleteObject(reference.key, reference.bucket);
    })
  );
  const failed = deletions.filter(
    (deletion): deletion is PromiseRejectedResult =>
      deletion.status === "rejected"
  );
  if (failed.length > 0) {
    throw new AggregateError(
      failed.map((deletion) => deletion.reason),
      `Failed to delete ${failed.length} generation task input object(s)`
    );
  }
}
