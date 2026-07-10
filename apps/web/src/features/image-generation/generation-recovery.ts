/**
 * 持久 generation 行的执行恢复决策。
 *
 * 职责：在异步任务重签后，把已完成/失败的图像或视频行还原为业务结果；pending
 * 返回未决，让当前租约继续执行。模块不访问数据库，供统一管线、worker 与单测复用。
 */

type RecoverableImageGenerationRow = {
  id: string;
  userId: string;
  status: "pending" | "completed" | "failed";
  model: string;
  size: string;
  storageKey: string | null;
  storageBucket: string | null;
  revisedPrompt: string | null;
  creditsConsumed: string | number | null;
  error: string | null;
  metadata: unknown;
};

type RecoverableVideoGenerationRow = {
  id: string;
  userId: string;
  apiKeyId: string | null;
  status: string;
  storageKey: string | null;
  creditsConsumed: string | number | null;
  error: string | null;
};

export type RecoveredImageGenerationResult = {
  error?: string;
  generationId: string;
  imageUrl?: string;
  imageOutputs?: Array<{
    generationId?: string;
    imageUrl: string;
    size?: string;
    revisedPrompt?: string;
    index: number;
    outputRole?: "final" | "agent_draft" | "choice";
  }>;
  model: string;
  size: string;
  revisedPrompt?: string;
  promptRepairNotice?: string;
  creditsConsumed: number;
};

export type RecoveredVideoGenerationResult =
  | {
      videoGenerationId: string;
      storageKey: string;
      creditsConsumed: number;
    }
  | { error: string; videoGenerationId: string };

/** 判断未知值是否为可逐字段读取的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** 把未知值收窄为非空字符串，非法值返回 undefined。 */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** 把数据库 numeric 值收窄为非负有限数字，非法值回退 0。 */
function creditsValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/** 只接受 generation metadata 已声明的输出角色。 */
function outputRole(
  value: unknown
): "final" | "agent_draft" | "choice" | undefined {
  return value === "final" || value === "agent_draft" || value === "choice"
    ? value
    : undefined;
}

/** 从 metadata 中读取提示词修复告知；未成功或结构非法时省略。 */
function promptRepairNotice(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined;
  const repair = metadata.moderationPromptRepair;
  if (!isRecord(repair) || repair.succeeded !== true) return undefined;
  return optionalString(repair.notice);
}

/**
 * 从完成行恢复图像操作结果。
 *
 * @param row 数据库读取的 generation 行。
 * @param options 期望用户与基于 storage key 生成当前签名 URL 的函数。
 * @returns completed/failed 的恢复结果；pending 返回 undefined 允许当前租约续跑。
 * @throws generation 归属不符时 fail-closed，防止服务端 ID 碰撞造成越权。
 * @sideEffects 调用 buildImageUrl，不访问网络或数据库。
 */
export function recoverImageGenerationResult(
  row: RecoverableImageGenerationRow,
  options: {
    expectedUserId: string;
    buildImageUrl: (storageKey: string, bucket: string | null) => string | null;
  }
): RecoveredImageGenerationResult | undefined {
  if (row.userId !== options.expectedUserId) {
    throw new Error("Generation ID does not belong to the requesting user");
  }
  if (row.status === "pending") return undefined;

  const base = {
    generationId: row.id,
    model: row.model,
    size: row.size,
    ...(row.revisedPrompt ? { revisedPrompt: row.revisedPrompt } : {}),
    ...(promptRepairNotice(row.metadata)
      ? { promptRepairNotice: promptRepairNotice(row.metadata) }
      : {}),
    creditsConsumed: creditsValue(row.creditsConsumed),
  };
  if (row.status === "failed") {
    return { ...base, error: row.error || "Image generation failed" };
  }

  const outputImage =
    isRecord(row.metadata) && isRecord(row.metadata.outputImage)
      ? row.metadata.outputImage
      : null;
  const rawOutputs = Array.isArray(outputImage?.imageOutputs)
    ? outputImage.imageOutputs
    : [];
  const imageOutputs = rawOutputs.flatMap((rawOutput, index) => {
    if (!isRecord(rawOutput)) return [];
    const storageKey = optionalString(rawOutput.storageKey);
    if (!storageKey) return [];
    const imageUrl = options.buildImageUrl(storageKey, row.storageBucket);
    if (!imageUrl) return [];
    return [
      {
        ...(optionalString(rawOutput.generationId)
          ? { generationId: optionalString(rawOutput.generationId) }
          : {}),
        imageUrl,
        ...(optionalString(rawOutput.size)
          ? { size: optionalString(rawOutput.size) }
          : {}),
        ...(optionalString(rawOutput.revisedPrompt)
          ? { revisedPrompt: optionalString(rawOutput.revisedPrompt) }
          : {}),
        index,
        ...(outputRole(rawOutput.role)
          ? { outputRole: outputRole(rawOutput.role) }
          : {}),
        primary: rawOutput.primary === true,
        storageKey,
      },
    ];
  });
  const fallbackUrl = row.storageKey
    ? options.buildImageUrl(row.storageKey, row.storageBucket)
    : null;
  const primaryOutput =
    imageOutputs.find((output) => output.primary) ??
    (row.storageKey
      ? imageOutputs.find((output) => output.storageKey === row.storageKey)
      : undefined) ??
    imageOutputs.find((output) => output.outputRole === "final") ??
    imageOutputs.at(-1);
  const imageUrl = primaryOutput?.imageUrl ?? fallbackUrl;
  if (!imageUrl) {
    return { ...base, error: "Completed generation output is unavailable" };
  }

  return {
    ...base,
    imageUrl,
    imageOutputs:
      imageOutputs.length > 0
        ? imageOutputs.map(({ primary: _primary, storageKey: _key, ...output }) =>
            output
          )
        : [
            {
              generationId: row.id,
              imageUrl,
              size: row.size,
              ...(row.revisedPrompt
                ? { revisedPrompt: row.revisedPrompt }
                : {}),
              index: 0,
              outputRole: "final",
            },
          ],
  };
}

/**
 * 从持久视频行恢复业务结果。
 *
 * @param row 数据库读取的 video_generation 行。
 * @param options 期望用户及可选 API Key 归属。
 * @returns completed/failed 的恢复结果；pending/running 返回 undefined。
 * @throws 用户或 API Key 归属不符时 fail-closed。
 * @sideEffects 无。
 */
export function recoverVideoGenerationResult(
  row: RecoverableVideoGenerationRow,
  options: { expectedUserId: string; expectedApiKeyId?: string | null }
): RecoveredVideoGenerationResult | undefined {
  if (row.userId !== options.expectedUserId) {
    throw new Error("Video generation ID does not belong to the requesting user");
  }
  if (
    options.expectedApiKeyId !== undefined &&
    row.apiKeyId !== options.expectedApiKeyId
  ) {
    throw new Error(
      "Video generation ID does not belong to the requesting API key"
    );
  }
  if (row.status === "pending" || row.status === "running") return undefined;
  if (row.status === "failed") {
    return {
      error: row.error || "Video generation failed",
      videoGenerationId: row.id,
    };
  }
  if (row.status !== "completed" || !row.storageKey) {
    return {
      error: "Completed video output is unavailable",
      videoGenerationId: row.id,
    };
  }
  return {
    videoGenerationId: row.id,
    storageKey: row.storageKey,
    creditsConsumed: creditsValue(row.creditsConsumed),
  };
}
