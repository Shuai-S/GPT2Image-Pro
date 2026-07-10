/**
 * 外部图像编辑 handler 的持久 async 入队测试。
 *
 * 使用 DB-free 依赖 mock 锁定严格 image_edit 标量、source/mask 媒体字节、套餐队列
 * 快照与 fail-closed 错误；async Route 不得再执行统一图像管线或进程内批处理。
 */

import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateExternalApiRequest: vi.fn(),
  canUsePlanCapability: vi.fn(),
  enqueueGenerationTask: vi.fn(),
  fetchPublicImage: vi.fn(),
  getPlanLimits: vi.fn(),
  getPlanUploadLimits: vi.fn(),
  getRuntimeImageEditMaxReferenceImages: vi.fn(),
  logError: vi.fn(),
  lookup: vi.fn(),
  runBatchImageGeneration: vi.fn(),
  runImageGenerationForUser: vi.fn(),
  uploadModerationImages: vi.fn(),
  validateCallbackUrl: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: mocks.lookup,
}));

vi.mock("@repo/shared/api-logger", () => ({
  withApiLogging: (handler: unknown) => handler,
}));

vi.mock("@repo/shared/logger", () => ({
  logError: mocks.logError,
}));

vi.mock("@repo/shared/subscription/services/plan-capabilities", () => ({
  canUsePlanCapability: mocks.canUsePlanCapability,
  getPlanLimits: mocks.getPlanLimits,
}));

vi.mock("@repo/shared/subscription/services/upload-limits", () => ({
  getPlanUploadLimits: mocks.getPlanUploadLimits,
}));

vi.mock("@/features/external-api/async-image-tasks", () => ({
  toAsyncImageTaskResponse: (task: Record<string, unknown>) => {
    const { apiKeyId: _apiKeyId, userId: _userId, ...publicTask } = task;
    return publicTask;
  },
  validateCallbackUrl: mocks.validateCallbackUrl,
}));

vi.mock("@/features/external-api/auth", () => ({
  authenticateExternalApiRequest: mocks.authenticateExternalApiRequest,
}));

vi.mock("@/features/external-api/generation-task-service", () => ({
  enqueueGenerationTask: mocks.enqueueGenerationTask,
}));

vi.mock("@/features/external-api/safe-image-fetch", () => ({
  fetchPublicImage: mocks.fetchPublicImage,
  readResponseBytesWithLimit: async (response: Response) =>
    Buffer.from(await response.arrayBuffer()),
}));

vi.mock("@/features/image-generation/batch-runner", () => ({
  runBatchImageGeneration: mocks.runBatchImageGeneration,
}));

vi.mock("@/features/image-generation/edit-reference-limits", () => ({
  getEffectiveImageEditMaxReferenceImages: (
    planLimit: number,
    runtimeLimit: number
  ) => Math.min(planLimit, runtimeLimit),
  getRuntimeImageEditMaxReferenceImages:
    mocks.getRuntimeImageEditMaxReferenceImages,
}));

vi.mock("@/features/image-generation/operations", () => ({
  runImageGenerationForUser: mocks.runImageGenerationForUser,
}));

vi.mock("@/features/image-generation/request-utils", () => ({
  DEFAULT_MAX_IMAGE_BYTES: 20 * 1024 * 1024,
  filesToImageInputs: vi.fn(),
  formatMegabytes: (bytes: number) => `${bytes / 1024 / 1024} MB`,
  getTotalUploadSize: (files: readonly File[], mask?: File) =>
    files.reduce((total, file) => total + file.size, mask?.size ?? 0),
  uploadModerationImages: mocks.uploadModerationImages,
  validateImageFile: vi.fn(),
}));

/**
 * 构造带 NextRequest.nextUrl 的 multipart 图像编辑请求。
 *
 * @param input 可覆盖 async 开关，默认走持久任务路径。
 * @returns 含一张 WebP source 和一张 PNG mask 的请求。
 * @sideEffects 在内存中构造 FormData/File，不触达网络或存储。
 */
function imageEditRequest(input?: { relayAsync?: boolean }): NextRequest {
  const formData = new FormData();
  formData.set("prompt", "remove the background");
  formData.set("model", "gpt-image-2");
  formData.set("n", "2");
  formData.set("response_format", "url");
  formData.set("quality", "high");
  formData.set("async", String(input?.relayAsync ?? true));
  formData.append(
    "image",
    new File([Uint8Array.from([1, 2, 3])], "source.webp", {
      type: "image/webp",
    })
  );
  formData.set(
    "mask",
    new File([Uint8Array.from([4, 5])], "mask.png", {
      type: "image/png",
    })
  );

  const request = new Request("https://example.test/v1/images/edits", {
    method: "POST",
    body: formData,
  });
  Object.defineProperty(request, "nextUrl", {
    value: new URL(request.url),
  });
  return request as NextRequest;
}

/**
 * 构造 JSON 图像编辑请求，验证 JSON 标量白名单与 multipart 语义一致。
 *
 * @param body 外部请求 JSON；测试负责提供必填 prompt 与 image_url。
 * @returns 带 NextRequest.nextUrl 的内存请求。
 * @sideEffects 序列化 JSON，不触达网络或存储。
 */
function jsonImageEditRequest(body: Record<string, unknown>): NextRequest {
  const request = new Request("https://example.test/v1/images/edits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "nextUrl", {
    value: new URL(request.url),
  });
  return request as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateExternalApiRequest.mockResolvedValue({
    userId: "user-1",
    apiKeyId: "key-1",
    plan: "ultra",
    moderationBlockRiskLevel: "medium",
    relayOnly: false,
  });
  mocks.canUsePlanCapability.mockResolvedValue(true);
  mocks.getPlanLimits.mockResolvedValue({
    maxBatchCount: 4,
    maxEditImages: 4,
    imageGenerationConcurrency: 3,
    queuePriority: "highest",
  });
  mocks.getPlanUploadLimits.mockResolvedValue({
    maxFileSizeBytes: 25 * 1024 * 1024,
    maxUploadBytes: 100 * 1024 * 1024,
  });
  mocks.getRuntimeImageEditMaxReferenceImages.mockResolvedValue(4);
  mocks.lookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
  mocks.fetchPublicImage.mockResolvedValue(
    new Response(Uint8Array.from([9, 8, 7]), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    })
  );
  mocks.validateCallbackUrl.mockImplementation(async (value: string) => value);
  mocks.enqueueGenerationTask.mockResolvedValue({
    id: "task-1",
    object: "image.generation",
    userId: "user-1",
    apiKeyId: "key-1",
    model: "gpt-image-2",
    status: "processing",
    created_at: "2026-07-10T00:00:00.000Z",
  });
});

describe("postExternalImageEdits async", () => {
  it("只入队严格标量和 source/mask 媒体，不在 Route 内执行生成", async () => {
    const { postExternalImageEdits } = await import("./image-edits");

    const response = await postExternalImageEdits(imageEditRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({ id: "task-1", status: "processing" })
    );
    expect(payload).not.toHaveProperty("userId");
    expect(payload).not.toHaveProperty("apiKeyId");
    expect(mocks.enqueueGenerationTask).toHaveBeenCalledOnce();
    const enqueueInput = mocks.enqueueGenerationTask.mock.calls[0]?.[0];
    expect(enqueueInput).toEqual(
      expect.objectContaining({
        userId: "user-1",
        apiKeyId: "key-1",
        relayOnly: false,
        priority: "highest",
        userConcurrency: 3,
        request: expect.objectContaining({
          kind: "image_edit",
          generationIds: [expect.any(String), expect.any(String)],
          createdAtEpochSeconds: expect.any(Number),
          responseFormat: "url",
          input: expect.objectContaining({
            prompt: "remove the background",
            model: "gpt-image-2",
            quality: "high",
            moderation: "auto",
            moderationBlockRiskLevel: "medium",
          }),
        }),
      })
    );
    expect(enqueueInput?.request).not.toHaveProperty("inputReferences");
    expect(enqueueInput?.mediaInputs).toEqual([
      {
        data: Buffer.from([1, 2, 3]),
        name: "source.webp",
        contentType: "image/webp",
        role: "source",
      },
      {
        data: Buffer.from([4, 5]),
        name: "mask.png",
        contentType: "image/png",
        role: "mask",
      },
    ]);
    expect(mocks.uploadModerationImages).not.toHaveBeenCalled();
    expect(mocks.runBatchImageGeneration).not.toHaveBeenCalled();
    expect(mocks.runImageGenerationForUser).not.toHaveBeenCalled();
  });

  it("relay-only async 在媒体持久化前返回明确错误", async () => {
    mocks.authenticateExternalApiRequest.mockResolvedValue({
      userId: "user-1",
      apiKeyId: "key-1",
      plan: "ultra",
      moderationBlockRiskLevel: "low",
      relayOnly: true,
    });
    const { postExternalImageEdits } = await import("./image-edits");

    const response = await postExternalImageEdits(imageEditRequest());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toEqual(
      expect.objectContaining({ code: "unsupported_async_mode" })
    );
    expect(mocks.enqueueGenerationTask).not.toHaveBeenCalled();
    expect(mocks.runImageGenerationForUser).not.toHaveBeenCalled();
  });

  it("入队失败返回可重试 503 且不启动后台生成", async () => {
    const queueError = new Error("database unavailable");
    mocks.enqueueGenerationTask.mockRejectedValueOnce(queueError);
    const { postExternalImageEdits } = await import("./image-edits");

    const response = await postExternalImageEdits(imageEditRequest());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toEqual(
      expect.objectContaining({ code: "queue_unavailable" })
    );
    expect(mocks.logError).toHaveBeenCalledWith(
      queueError,
      expect.objectContaining({
        source: "external-api-image-edit-enqueue",
        userId: "user-1",
      })
    );
    expect(mocks.runBatchImageGeneration).not.toHaveBeenCalled();
    expect(mocks.runImageGenerationForUser).not.toHaveBeenCalled();
  });

  it("JSON 修复字段别名与 multipart 一致进入严格任务载荷", async () => {
    const { postExternalImageEdits } = await import("./image-edits");

    const response = await postExternalImageEdits(
      jsonImageEditRequest({
        prompt: "restore the old photo",
        model: "gpt-image-2",
        image_url: "https://cdn.example/source.png",
        async: true,
        hd_repair: false,
        blockRepair: true,
        repair_prompt: "preserve the original lettering",
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.enqueueGenerationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          kind: "image_edit",
          input: expect.objectContaining({
            hdRepair: false,
            blockRepair: true,
            repairPrompt: "preserve the original lettering",
          }),
        }),
        mediaInputs: [
          expect.objectContaining({
            data: Buffer.from([9, 8, 7]),
            contentType: "image/png",
            role: "source",
          }),
        ],
      })
    );
    expect(mocks.runImageGenerationForUser).not.toHaveBeenCalled();
  });

  it("JSON 超长 repairPrompt 在远程媒体下载前返回 400", async () => {
    const { postExternalImageEdits } = await import("./image-edits");

    const response = await postExternalImageEdits(
      jsonImageEditRequest({
        prompt: "restore the old photo",
        model: "gpt-image-2",
        image_url: "https://cdn.example/source.png",
        async: true,
        repairPrompt: "x".repeat(8001),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toEqual(
      expect.objectContaining({
        message: "repairPrompt must be 8000 characters or less.",
      })
    );
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.fetchPublicImage).not.toHaveBeenCalled();
    expect(mocks.enqueueGenerationTask).not.toHaveBeenCalled();
  });
});
