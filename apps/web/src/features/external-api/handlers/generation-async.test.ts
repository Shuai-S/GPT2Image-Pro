/**
 * 外部图像与视频 handler 持久异步入队测试。
 *
 * 职责：锁定三个 async 入口只持久化严格任务与对象输入，不在响应生命周期外启动
 * 上游调用；同时覆盖 relay-only、队列故障和图像编辑 JSON 参数映射。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateExternalApiRequest: vi.fn(),
  canUsePlanCapability: vi.fn(),
  createJsonKeepAliveResponse: vi.fn(),
  enqueueGenerationTask: vi.fn(),
  fetchPublicImage: vi.fn(),
  getPlanLimits: vi.fn(),
  getPlanQueueSettings: vi.fn(),
  getPlanUploadLimits: vi.fn(),
  lookup: vi.fn(),
  readResponseBytesWithLimit: vi.fn(),
  runAdobeVideoGenerationForUser: vi.fn(),
  runBatchImageGeneration: vi.fn(),
  runImageGenerationForUser: vi.fn(),
  toOpenAIImagesResponse: vi.fn(),
  validateCallbackUrl: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("@repo/shared/api-logger", () => ({
  withApiLogging: <T>(handler: T) => handler,
}));
vi.mock("@repo/shared/logger", () => ({ logError: vi.fn() }));
vi.mock("@repo/shared/adobe/firefly-direct/video-catalog", () => ({
  isFireflyVideoModelId: vi.fn(() => true),
}));
vi.mock("@repo/shared/subscription/services/plan-capabilities", () => ({
  MAX_PLAN_BATCH_COUNT: 10_000,
  canUsePlanCapability: mocks.canUsePlanCapability,
  getPlanLimits: mocks.getPlanLimits,
  getPlanQueueSettings: mocks.getPlanQueueSettings,
}));
vi.mock("@repo/shared/subscription/services/upload-limits", () => ({
  getPlanUploadLimits: mocks.getPlanUploadLimits,
}));
vi.mock("@repo/shared/storage/signed-url", () => ({
  buildSignedStorageImageUrl: vi.fn(),
}));
vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: vi.fn(async () => "generations"),
}));
vi.mock("@/features/external-api/auth", () => ({
  authenticateExternalApiRequest: mocks.authenticateExternalApiRequest,
}));
vi.mock("@/features/external-api/generation-task-service", () => ({
  enqueueGenerationTask: mocks.enqueueGenerationTask,
}));
vi.mock("@/features/external-api/async-image-tasks", () => ({
  validateCallbackUrl: mocks.validateCallbackUrl,
  toAsyncImageTaskResponse: (task: Record<string, unknown>) => {
    const { userId: _userId, apiKeyId: _apiKeyId, ...publicTask } = task;
    return publicTask;
  },
}));
vi.mock("@/features/external-api/images", () => ({
  createExternalImageStreamResponse: vi.fn(),
  createJsonKeepAliveResponse: mocks.createJsonKeepAliveResponse,
  getExternalFinalImageOutputs: vi.fn(() => []),
  getImageBase64: vi.fn(),
  getPublicImageUrl: vi.fn(),
  IMAGE_JSON_KEEP_ALIVE_INITIAL_WAIT_MS: 100,
  openAIImageError: (message: string, status = 400, code?: string) =>
    Response.json(
      { error: { message, ...(code ? { code } : {}) } },
      { status }
    ),
  toExternalErrorStreamData: vi.fn(),
  toLoggedOpenAIErrorPayload: vi.fn(),
  toOpenAIImagesResponse: mocks.toOpenAIImagesResponse,
  wantsImageStreamResponse: (_request: Request, explicit?: boolean) =>
    explicit === true,
}));
vi.mock("@/features/external-api/safe-image-fetch", () => ({
  fetchPublicImage: mocks.fetchPublicImage,
  readResponseBytesWithLimit: mocks.readResponseBytesWithLimit,
}));
vi.mock("@/features/image-generation/batch-limits", () => ({
  getImageBatchCountLimit: (limits: { maxBatchCount?: number }) =>
    limits.maxBatchCount ?? 1,
}));
vi.mock("@/features/image-generation/batch-runner", () => ({
  runBatchImageGeneration: mocks.runBatchImageGeneration,
}));
vi.mock("@/features/image-generation/edit-reference-limits", () => ({
  getEffectiveImageEditMaxReferenceImages: (
    planLimit: number,
    runtimeLimit: number
  ) => Math.min(planLimit, runtimeLimit),
  getRuntimeImageEditMaxReferenceImages: vi.fn(async () => 4),
}));
vi.mock("@/features/image-generation/operations", () => ({
  runImageGenerationForUser: mocks.runImageGenerationForUser,
}));
vi.mock("@/features/image-generation/output-format", () => ({
  VALID_OUTPUT_FORMATS: new Set(["png", "jpeg", "webp"]),
  normalizeImageBackground: (value?: string) =>
    value === "transparent" || value === "opaque" || value === "auto"
      ? value
      : undefined,
  normalizeOutputCompression: (value?: string | number) =>
    value === undefined ? undefined : Number(value),
  normalizeOutputFormat: (value?: string) => value || "png",
}));
vi.mock("@/features/image-generation/request-utils", () => ({
  DEFAULT_MAX_IMAGE_BYTES: 20 * 1024 * 1024,
  filesToImageInputs: vi.fn(),
  formatMegabytes: (bytes: number) => `${bytes / 1024 / 1024} MB`,
  getTotalUploadSize: (files: readonly File[], mask?: File) =>
    files.reduce((total, file) => total + file.size, mask?.size ?? 0),
  uploadModerationImages: vi.fn(),
  validateImageFile: vi.fn(),
}));
vi.mock("@/features/image-generation/resolution", () => ({
  DEFAULT_IMAGE_SIZE: "1024x1024",
  getImageModel: (model?: string) => model || "gpt-image-2",
  IMAGE_PROMPT_MAX_CHARACTERS: 32_000,
  IMAGE_PROMPT_TOO_LONG_MESSAGE: "Prompt is too long.",
  validateImageSize: vi.fn(() => ({ valid: true })),
}));
vi.mock("@/features/image-generation/video-operations", () => ({
  runAdobeVideoGenerationForUser: mocks.runAdobeVideoGenerationForUser,
}));

const queuedTask = {
  id: "task-1",
  object: "image.generation" as const,
  userId: "user-1",
  apiKeyId: "key-1",
  model: "gpt-image-2",
  status: "processing" as const,
  created_at: "2026-07-10T00:00:00.000Z",
};

/**
 * 构造带 NextRequest.nextUrl 兼容字段的 JSON 请求。
 *
 * @param path 外部 API 路径。
 * @param body 待序列化 JSON 对象。
 * @param idempotencyKey 可选标准幂等请求头。
 * @returns 可传入 handler 的 Request 测试替身。
 * @sideEffects 仅在本地 Request 上定义只读 nextUrl。
 */
function jsonRequest(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string
): never {
  const request = new Request(`https://api.example.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey !== undefined
        ? { "Idempotency-Key": idempotencyKey }
        : {}),
    },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "nextUrl", { value: new URL(request.url) });
  return request as never;
}

/**
 * 构造带 NextRequest.nextUrl 兼容字段的 multipart 请求。
 *
 * @param path 外部 API 路径。
 * @param formData 已填充的 multipart 字段。
 * @returns 可传入 handler 的 Request 测试替身。
 * @sideEffects 仅在本地 Request 上定义只读 nextUrl。
 */
function multipartRequest(path: string, formData: FormData): never {
  const request = new Request(`https://api.example.test${path}`, {
    method: "POST",
    body: formData,
  });
  Object.defineProperty(request, "nextUrl", { value: new URL(request.url) });
  return request as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateExternalApiRequest.mockResolvedValue({
    userId: "user-1",
    apiKeyId: "key-1",
    plan: "ultra",
    moderationBlockRiskLevel: "low",
    relayOnly: false,
  });
  mocks.canUsePlanCapability.mockResolvedValue(true);
  mocks.getPlanLimits.mockResolvedValue({
    maxBatchCount: 4,
    maxEditImages: 4,
    imageGenerationConcurrency: 3,
    queuePriority: "priority",
  });
  mocks.getPlanQueueSettings.mockResolvedValue({
    priority: "highest",
    userConcurrency: 2,
  });
  mocks.getPlanUploadLimits.mockResolvedValue({
    maxFileSizeBytes: 20 * 1024 * 1024,
    maxUploadBytes: 80 * 1024 * 1024,
  });
  mocks.enqueueGenerationTask.mockResolvedValue(queuedTask);
  mocks.lookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
  mocks.fetchPublicImage.mockResolvedValue(
    new Response(Buffer.from("image-data"), {
      headers: { "Content-Type": "image/png" },
    })
  );
  mocks.readResponseBytesWithLimit.mockResolvedValue(Buffer.from("image-data"));
  mocks.validateCallbackUrl.mockImplementation(async (value: string) => value);
  mocks.runBatchImageGeneration.mockResolvedValue([]);
  mocks.toOpenAIImagesResponse.mockResolvedValue({ data: [] });
  mocks.createJsonKeepAliveResponse.mockImplementation(
    async (run: () => Promise<unknown>) => Response.json(await run())
  );
});

describe("external generation async handlers", () => {
  it("文生图只持久入队批量 ID 与套餐队列设置", async () => {
    const { postExternalImageGenerations } = await import(
      "./image-generations"
    );

    const response = await postExternalImageGenerations(
      jsonRequest(
        "/v1/images/generations",
        {
          prompt: "draw a poster",
          model: "gpt-image-2",
          n: 2,
          async: true,
          response_format: "url",
          prompt_repair: false,
        },
        "  image-request-1  "
      )
    );

    const responsePayload = await response.clone().json();
    expect(response.status, JSON.stringify(responsePayload)).toBe(200);
    expect(mocks.enqueueGenerationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        apiKeyId: "key-1",
        relayOnly: false,
        clientRequestId: "image-request-1",
        priority: "priority",
        userConcurrency: 3,
        request: expect.objectContaining({
          kind: "image_generate",
          generationIds: [expect.any(String), expect.any(String)],
          responseFormat: "url",
          input: expect.objectContaining({
            prompt: "draw a poster",
            model: "gpt-image-2",
            moderationPromptRepair: false,
          }),
        }),
      })
    );
    expect(mocks.runBatchImageGeneration).not.toHaveBeenCalled();
    expect(mocks.runImageGenerationForUser).not.toHaveBeenCalled();
  });

  it("异步入队失败返回 503 且不调用上游", async () => {
    mocks.enqueueGenerationTask.mockRejectedValueOnce(
      new Error("database unavailable")
    );
    const { postExternalImageGenerations } = await import(
      "./image-generations"
    );

    const response = await postExternalImageGenerations(
      jsonRequest("/v1/images/generations", {
        prompt: "draw a poster",
        model: "gpt-image-2",
        async: true,
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("queue_unavailable");
    expect(mocks.runImageGenerationForUser).not.toHaveBeenCalled();
  });

  it("有效 relay-only 身份在 callback 与入队前返回 400", async () => {
    mocks.authenticateExternalApiRequest.mockResolvedValueOnce({
      userId: "user-1",
      apiKeyId: "key-1",
      plan: "ultra",
      moderationBlockRiskLevel: "low",
      relayOnly: true,
    });
    const { postExternalImageGenerations } = await import(
      "./image-generations"
    );

    const response = await postExternalImageGenerations(
      jsonRequest("/v1/images/generations", {
        prompt: "draw a poster",
        model: "gpt-image-2",
        async: true,
        callback_url: "https://callback.example.test/result",
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.validateCallbackUrl).not.toHaveBeenCalled();
    expect(mocks.enqueueGenerationTask).not.toHaveBeenCalled();
  });

  it("图像编辑 JSON 参数与源图都进入严格持久任务", async () => {
    const { postExternalImageEdits } = await import("./image-edits");

    const response = await postExternalImageEdits(
      jsonRequest(
        "/v1/images/edits",
        {
          prompt: "remove background",
          model: "gpt-image-2",
          image: "https://assets.example.test/source.png",
          async: true,
          hd_repair: false,
          block_repair: true,
          repair_prompt: "preserve the product label",
        },
        "edit-request-1"
      )
    );

    const responsePayload = await response.clone().json();
    expect(response.status, JSON.stringify(responsePayload)).toBe(200);
    const call = mocks.enqueueGenerationTask.mock.calls[0]?.[0];
    expect(call).toEqual(
      expect.objectContaining({
        clientRequestId: "edit-request-1",
        priority: "priority",
        userConcurrency: 3,
        request: expect.objectContaining({
          kind: "image_edit",
          input: expect.objectContaining({
            hdRepair: false,
            blockRepair: true,
            repairPrompt: "preserve the product label",
          }),
        }),
        mediaInputs: [
          expect.objectContaining({
            data: Buffer.from("image-data"),
            contentType: "image/png",
            role: "source",
          }),
        ],
      })
    );
    expect(mocks.runBatchImageGeneration).not.toHaveBeenCalled();
    expect(mocks.runImageGenerationForUser).not.toHaveBeenCalled();
  });

  it("图像编辑在解析媒体前把过长 repairPrompt 映射为 400", async () => {
    const formData = new FormData();
    formData.append("prompt", "remove background");
    formData.append("model", "gpt-image-2");
    formData.append("async", "true");
    formData.append("repairPrompt", "x".repeat(8001));
    formData.append(
      "image",
      new Blob([Buffer.from("image-data")], { type: "image/png" }),
      "source.png"
    );
    const { postExternalImageEdits } = await import("./image-edits");

    const response = await postExternalImageEdits(
      multipartRequest("/v1/images/edits", formData)
    );

    expect(response.status).toBe(400);
    expect(mocks.enqueueGenerationTask).not.toHaveBeenCalled();
    expect(mocks.fetchPublicImage).not.toHaveBeenCalled();
  });

  it("视频输入按首帧、尾帧、参考图顺序只写持久任务", async () => {
    const images = ["first", "last", "reference"].map(
      (value) =>
        `data:image/png;base64,${Buffer.from(value).toString("base64")}`
    );
    const { postExternalVideoGenerations } = await import(
      "./video-generations"
    );

    const response = await postExternalVideoGenerations(
      jsonRequest(
        "/v1/videos/generations",
        {
          prompt: "slow camera movement",
          model: "firefly-sora2-8s-16x9",
          negative_prompt: "flicker",
          image: images,
          async: true,
        },
        "video-request-1"
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.enqueueGenerationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRequestId: "video-request-1",
        priority: "highest",
        userConcurrency: 2,
        request: expect.objectContaining({
          kind: "video",
          generationId: expect.any(String),
          input: {
            prompt: "slow camera movement",
            model: "firefly-sora2-8s-16x9",
            negativePrompt: "flicker",
          },
        }),
        mediaInputs: [
          expect.objectContaining({
            data: Buffer.from("first"),
            role: "first",
          }),
          expect.objectContaining({ data: Buffer.from("last"), role: "last" }),
          expect.objectContaining({
            data: Buffer.from("reference"),
            role: "reference",
          }),
        ],
      })
    );
    expect(mocks.runAdobeVideoGenerationForUser).not.toHaveBeenCalled();
  });

  it("同步文生图继续直达统一管线且不创建持久任务", async () => {
    const { postExternalImageGenerations } = await import(
      "./image-generations"
    );

    const response = await postExternalImageGenerations(
      jsonRequest(
        "/v1/images/generations",
        {
          prompt: "draw a poster",
          model: "gpt-image-2",
        },
        "x".repeat(256)
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.enqueueGenerationTask).not.toHaveBeenCalled();
    expect(mocks.runBatchImageGeneration).toHaveBeenCalledOnce();
  });

  it("三个 async handler 都在入队前拒绝非法 Idempotency-Key", async () => {
    const invalidKey = "x".repeat(256);
    const { postExternalImageGenerations } = await import(
      "./image-generations"
    );
    const { postExternalImageEdits } = await import("./image-edits");
    const { postExternalVideoGenerations } = await import(
      "./video-generations"
    );

    const responses = await Promise.all([
      postExternalImageGenerations(
        jsonRequest(
          "/v1/images/generations",
          { prompt: "draw", model: "gpt-image-2", async: true },
          invalidKey
        )
      ),
      postExternalImageEdits(
        jsonRequest(
          "/v1/images/edits",
          {
            prompt: "edit",
            model: "gpt-image-2",
            image: "https://assets.example.test/source.png",
            async: true,
          },
          invalidKey
        )
      ),
      postExternalVideoGenerations(
        jsonRequest(
          "/v1/videos/generations",
          {
            prompt: "animate",
            model: "firefly-sora2-8s-16x9",
            async: true,
          },
          invalidKey
        )
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_idempotency_key" },
      });
    }
    expect(mocks.fetchPublicImage).not.toHaveBeenCalled();
    expect(mocks.enqueueGenerationTask).not.toHaveBeenCalled();
  });

  it("三个 async handler 都把幂等内容冲突映射为 409", async () => {
    const { GenerationTaskConflictError } = await import(
      "../generation-task-idempotency"
    );
    mocks.enqueueGenerationTask.mockRejectedValue(
      new GenerationTaskConflictError()
    );
    const { postExternalImageGenerations } = await import(
      "./image-generations"
    );
    const { postExternalImageEdits } = await import("./image-edits");
    const { postExternalVideoGenerations } = await import(
      "./video-generations"
    );

    const responses = await Promise.all([
      postExternalImageGenerations(
        jsonRequest(
          "/v1/images/generations",
          { prompt: "draw", model: "gpt-image-2", async: true },
          "conflict-1"
        )
      ),
      postExternalImageEdits(
        jsonRequest(
          "/v1/images/edits",
          {
            prompt: "edit",
            model: "gpt-image-2",
            image: "https://assets.example.test/source.png",
            async: true,
          },
          "conflict-2"
        )
      ),
      postExternalVideoGenerations(
        jsonRequest(
          "/v1/videos/generations",
          {
            prompt: "animate",
            model: "firefly-sora2-8s-16x9",
            async: true,
          },
          "conflict-3"
        )
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "idempotency_key_conflict" },
      });
    }
  });
});
