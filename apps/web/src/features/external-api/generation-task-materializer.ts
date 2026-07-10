/**
 * 普通 image/video 异步任务的动态公开结果物化。
 *
 * 职责：从 task 中的稳定 generation ID 查询产物真相，每次读取重新生成签名 URL；
 * b64_json 只在轮询或 callback 当下有限读取对象并编码，绝不写回 task JSON。
 */

import type { Generation } from "@repo/database/schema";
import { DEFAULT_IMAGE_RESPONSE_MAX_BYTES } from "@repo/shared/http/fetch";
import {
  buildPublicImageUrl,
  buildSignedStorageImageUrl,
  parseStorageImageUrl,
} from "@repo/shared/storage/signed-url";
import { z } from "zod";
import { recoverImageGenerationResult } from "@/features/image-generation/generation-recovery";
import type { ExternalAsyncTaskRow } from "./external-async-task-store";
import {
  type GenerationTaskRequestPayload,
  generationTaskRequestPayloadSchema,
} from "./generation-task-input";
import {
  getExternalFinalImageOutputs,
  toExternalGenerationUsage,
  toOpenAIErrorPayload,
} from "./images";

const MAX_MATERIALIZED_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_LEGACY_GENERATION_IDS = 10_000;
const legacyGenerationIdsSchema = z
  .array(z.string().trim().min(1).max(128))
  .max(MAX_LEGACY_GENERATION_IDS);

type VideoGenerationTaskRow = {
  id: string;
  userId: string;
  apiKeyId: string | null;
  model: string;
  status: string;
  storageKey: string | null;
  creditsConsumed: string | number | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
};

export type MaterializedGenerationTask = {
  objectType: "image" | "video";
  status: "completed" | "failed";
  payload: Record<string, unknown>;
};

export type GenerationTaskMaterializerDependencies = {
  readImageRows: (generationIds: readonly string[]) => Promise<Generation[]>;
  readVideoRow: (
    generationId: string
  ) => Promise<VideoGenerationTaskRow | null>;
  readObject: (
    key: string,
    bucket: string,
    maxBytes: number
  ) => Promise<Buffer>;
  getRuntimeSiteUrl: () => Promise<string>;
};

/** 判断未知值是否为可逐字段读取的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** 把 metadata 中的非空字符串安全取出。 */
function metadataString(
  metadata: Record<string, unknown> | null,
  key: string
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 从持久 task 请求或兼容 initial payload 读取稳定 generation ID。
 *
 * @param row external_async_task 完整行。
 * @returns 严格新 payload 及其 ID；legacy 行仅返回可对账 ID，不伪造可执行输入。
 * @sideEffects 无。
 */
function readTaskIdentity(row: ExternalAsyncTaskRow):
  | {
      request: GenerationTaskRequestPayload;
      generationIds: string[];
    }
  | { request: null; generationIds: string[] } {
  const parsed = generationTaskRequestPayloadSchema.safeParse(
    row.requestPayload
  );
  if (parsed.success) {
    return {
      request: parsed.data,
      generationIds:
        parsed.data.kind === "video"
          ? [parsed.data.generationId]
          : parsed.data.generationIds,
    };
  }

  const initial = isRecord(row.initialPayload) ? row.initialPayload : {};
  const singular =
    typeof initial.generation_id === "string"
      ? initial.generation_id
      : typeof initial.generationId === "string"
        ? initial.generationId
        : undefined;
  const plural = Array.isArray(initial.generation_ids)
    ? initial.generation_ids
    : Array.isArray(initial.generationIds)
      ? initial.generationIds
      : [];
  const parsedLegacyIds = legacyGenerationIdsSchema.safeParse(
    singular ? [singular] : plural
  );
  return {
    request: null,
    generationIds: parsedLegacyIds.success
      ? Array.from(new Set(parsedLegacyIds.data))
      : [],
  };
}

/**
 * 构造物化失败结果。
 *
 * @param objectType 对外产物类型。
 * @param message 可分类的安全错误信息。
 * @returns failed 状态及 OpenAI 错误信封。
 * @sideEffects 无。
 */
function failedMaterialization(
  objectType: "image" | "video",
  message: string
): MaterializedGenerationTask {
  return {
    objectType,
    status: "failed",
    payload: toOpenAIErrorPayload(message),
  };
}

/**
 * 把一张受控 storage 输出转换为当前请求格式。
 *
 * @param input 已恢复的签名 URL、提示词和响应格式。
 * @param dependencies 对象有限读取与运行时站点地址。
 * @returns url 或 b64_json 数据项及真实读取字节数。
 * @throws URL 不是受控 storage 引用或对象超限时抛错。
 * @sideEffects b64_json 路径读取一次对象；url 路径无对象 I/O。
 */
async function materializeImageOutput(
  input: {
    imageUrl: string;
    revisedPrompt?: string;
    responseFormat: "url" | "b64_json";
    siteUrl: string;
    maxBytes: number;
  },
  dependencies: GenerationTaskMaterializerDependencies
): Promise<{ item: Record<string, unknown>; bytesRead: number }> {
  if (input.responseFormat === "url") {
    const url = buildPublicImageUrl(input.imageUrl, input.siteUrl);
    if (!url) throw new Error("Completed generation output is unavailable");
    return {
      item: {
        url,
        ...(input.revisedPrompt ? { revised_prompt: input.revisedPrompt } : {}),
      },
      bytesRead: 0,
    };
  }

  const reference = parseStorageImageUrl(input.imageUrl, input.siteUrl);
  if (!reference) {
    throw new Error("Completed generation output is not in controlled storage");
  }
  const data = await dependencies.readObject(
    reference.key,
    reference.bucket,
    Math.min(DEFAULT_IMAGE_RESPONSE_MAX_BYTES, input.maxBytes)
  );
  return {
    item: {
      b64_json: data.toString("base64"),
      ...(input.revisedPrompt ? { revised_prompt: input.revisedPrompt } : {}),
    },
    bytesRead: data.byteLength,
  };
}

/**
 * 动态物化一个已终结 image task。
 *
 * @param row external_async_task 终态行。
 * @param request 新协议请求；legacy 行为空并按 URL 格式兼容物化。
 * @param generationIds 稳定图像 generation ID，保持创建顺序。
 * @param dependencies 数据库、存储和站点地址适配。
 * @returns 当前签名/有限 base64 结果；产物不完整时返回 failed。
 * @sideEffects 查询 generation，b64_json 时有限读取对象。
 */
async function materializeImageTask(
  row: ExternalAsyncTaskRow,
  request: GenerationTaskRequestPayload | null,
  generationIds: readonly string[],
  dependencies: GenerationTaskMaterializerDependencies
): Promise<MaterializedGenerationTask | undefined> {
  if (generationIds.length === 0) return undefined;
  const rows = await dependencies.readImageRows(generationIds);
  const byId = new Map(
    rows.map((generationRow) => [generationRow.id, generationRow])
  );
  const ordered = generationIds.map((id) => byId.get(id));
  if (ordered.some((generationRow) => !generationRow)) {
    return row.status === "failed"
      ? undefined
      : failedMaterialization("image", "Generation task result is incomplete");
  }

  const results = ordered.map((generationRow) =>
    recoverImageGenerationResult(generationRow as Generation, {
      expectedUserId: row.userId,
      buildImageUrl: (storageKey, bucket) =>
        bucket ? buildSignedStorageImageUrl(storageKey, bucket) : null,
    })
  );
  if (results.some((result) => !result)) {
    return failedMaterialization(
      "image",
      "Generation task result is still processing"
    );
  }
  const terminalResults = results.filter(
    (result): result is NonNullable<(typeof results)[number]> => Boolean(result)
  );
  const failed = terminalResults.find((result) => result.error);
  if (failed?.error) {
    return {
      objectType: "image",
      status: "failed",
      payload: toOpenAIErrorPayload(failed.error, {
        generationId: failed.generationId,
        creditsConsumed: failed.creditsConsumed,
      }),
    };
  }

  const responseFormat =
    request && request.kind !== "video" ? request.responseFormat : "url";
  const siteUrl = await dependencies.getRuntimeSiteUrl();
  const data: Record<string, unknown>[] = [];
  let totalBytes = 0;
  for (const result of terminalResults) {
    for (const output of getExternalFinalImageOutputs(result)) {
      if (!output.imageUrl) {
        return failedMaterialization(
          "image",
          "Completed generation output is unavailable"
        );
      }
      if (
        responseFormat === "b64_json" &&
        totalBytes >= MAX_MATERIALIZED_IMAGE_BYTES
      ) {
        return failedMaterialization(
          "image",
          "Materialized image response exceeds 100 MiB"
        );
      }
      const materialized = await materializeImageOutput(
        {
          imageUrl: output.imageUrl,
          revisedPrompt: output.revisedPrompt || result.revisedPrompt,
          responseFormat,
          siteUrl,
          maxBytes: MAX_MATERIALIZED_IMAGE_BYTES - totalBytes,
        },
        dependencies
      );
      totalBytes += materialized.bytesRead;
      if (totalBytes > MAX_MATERIALIZED_IMAGE_BYTES) {
        return failedMaterialization(
          "image",
          "Materialized image response exceeds 100 MiB"
        );
      }
      data.push(materialized.item);
    }
  }
  return {
    objectType: "image",
    status: "completed",
    payload: {
      created:
        request?.createdAtEpochSeconds ??
        Math.floor(row.createdAt.getTime() / 1000),
      data,
      ...toExternalGenerationUsage(terminalResults),
      usage: null,
    },
  };
}

/**
 * 动态物化一个已终结 video task。
 *
 * @param row external_async_task 终态行。
 * @param generationId 稳定 video_generation ID。
 * @param dependencies 数据库与 URL 运行时依赖。
 * @returns 当前签名视频响应；业务失败返回 OpenAI 错误信封。
 * @sideEffects 查询 video_generation 和运行时 site 设置。
 */
async function materializeVideoTask(
  row: ExternalAsyncTaskRow,
  generationId: string,
  dependencies: GenerationTaskMaterializerDependencies
): Promise<MaterializedGenerationTask | undefined> {
  const video = await dependencies.readVideoRow(generationId);
  if (!video) {
    return row.status === "failed"
      ? undefined
      : failedMaterialization("video", "Video task result is unavailable");
  }
  if (video.userId !== row.userId || video.apiKeyId !== row.apiKeyId) {
    throw new Error("Video generation result ownership does not match task");
  }
  if (video.status === "failed") {
    return failedMaterialization(
      "video",
      video.error || "Video generation failed"
    );
  }
  if (video.status !== "completed" || !video.storageKey) {
    return failedMaterialization(
      "video",
      "Video task result is still processing"
    );
  }

  const bucket = metadataString(video.metadata, "storageBucket");
  if (!bucket) {
    return failedMaterialization(
      "video",
      "Completed video output bucket is unavailable"
    );
  }
  const signedUrl = buildSignedStorageImageUrl(video.storageKey, bucket);
  const siteUrl = await dependencies.getRuntimeSiteUrl();
  const videoUrl = buildPublicImageUrl(signedUrl, siteUrl);
  if (!videoUrl) {
    return failedMaterialization(
      "video",
      "Completed video output is unavailable"
    );
  }
  return {
    objectType: "video",
    status: "completed",
    payload: {
      object: "video",
      model: video.model,
      video_url: videoUrl,
      data: [{ url: videoUrl }],
      credits_consumed: Number(video.creditsConsumed ?? 0),
    },
  };
}

/**
 * 从数据库读取一组完整 generation 行。
 *
 * @param generationIds 待物化 ID。
 * @returns 命中行，不保证顺序。
 * @sideEffects 延迟加载数据库并执行一次有界 IN 查询。
 */
async function readImageRows(
  generationIds: readonly string[]
): Promise<Generation[]> {
  const [{ db }, { generation }, { inArray }] = await Promise.all([
    import("@repo/database"),
    import("@repo/database/schema"),
    import("drizzle-orm"),
  ]);
  return await db
    .select()
    .from(generation)
    .where(inArray(generation.id, [...generationIds]));
}

/** 按 ID 读取一条 video_generation；不存在时返回 null。 */
async function readVideoRow(
  generationId: string
): Promise<VideoGenerationTaskRow | null> {
  const [{ db }, { videoGeneration }, { eq }] = await Promise.all([
    import("@repo/database"),
    import("@repo/database/schema"),
    import("drizzle-orm"),
  ]);
  const [row] = await db
    .select()
    .from(videoGeneration)
    .where(eq(videoGeneration.id, generationId))
    .limit(1);
  return row ?? null;
}

/** 有限读取一个受控 storage 对象。 */
async function readObject(
  key: string,
  bucket: string,
  maxBytes: number
): Promise<Buffer> {
  const { getStorageProvider } = await import("@repo/shared/storage/providers");
  const storage = await getStorageProvider();
  return await storage.getObject(key, bucket, { maxBytes });
}

/** 读取当前部署公开站点地址。 */
async function getRuntimeSiteUrl(): Promise<string> {
  const runtime = await import("@repo/shared/config/site-runtime");
  return await runtime.getRuntimeSiteUrl();
}

const productionDependencies: GenerationTaskMaterializerDependencies = {
  readImageRows,
  readVideoRow,
  readObject,
  getRuntimeSiteUrl,
};

/**
 * 动态物化一个普通 generation task 的公开终态字段。
 *
 * @param row external_async_task 行；processing/editable 行返回 undefined。
 * @param dependencies 可注入 DB-free 测试依赖，生产默认延迟加载数据库/存储。
 * @returns 可平铺到公开 task 的终态字段与状态；无可用 legacy ID 时返回 undefined。
 * @sideEffects 终态 image/video 查询产物表；b64_json 额外有限读取对象。
 */
export async function materializeGenerationTask(
  row: ExternalAsyncTaskRow,
  dependencies: GenerationTaskMaterializerDependencies = productionDependencies
): Promise<MaterializedGenerationTask | undefined> {
  if (
    row.taskType === "editable_file" ||
    (row.status !== "completed" && row.status !== "failed")
  ) {
    return undefined;
  }
  const identity = readTaskIdentity(row);
  if (row.taskType === "video") {
    const generationId = identity.generationIds[0];
    return generationId
      ? await materializeVideoTask(row, generationId, dependencies)
      : undefined;
  }
  return await materializeImageTask(
    row,
    identity.request,
    identity.generationIds,
    dependencies
  );
}
