/**
 * generation task 业务 resolver 的 DB-free 状态机测试。
 *
 * 职责：锁定“先对账、后执行、执行后重查”的不变量，以及 strict/legacy/exhausted
 * 对 pending 的不同处理。所有数据库、维护、鉴权、对象存储和上游调用均以内存替身注入。
 */

import type { Generation } from "@repo/database/schema";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(),
}));
vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: vi.fn(),
}));

import {
  createGenerationTaskResolvers,
  type GenerationTaskResolverDependencies,
  type VideoGenerationTaskExecutionRow,
} from "./generation-task-resolver";
import type { GenerationTaskWorkerRow } from "./generation-task-worker-core";

const taskRow: GenerationTaskWorkerRow = {
  id: "task-1",
  userId: "user-1",
  apiKeyId: "key-1",
  taskType: "image",
  initialPayload: { generationId: "gen-1" },
  requestPayload: null,
};

const sourceReference = {
  bucket: "generations",
  key: "user-1/async-task-inputs/task-1/0.png",
  name: "source.png",
  contentType: "image/png",
  size: 4,
  role: "source" as const,
};

const imageRequest = {
  kind: "image_edit" as const,
  relayOnly: false,
  generationIds: ["gen-1"],
  createdAtEpochSeconds: 1_788_000_000,
  responseFormat: "url" as const,
  input: { prompt: "移除背景", model: "gpt-image-2" },
  inputReferences: [sourceReference],
};

const videoRequest = {
  kind: "video" as const,
  relayOnly: false,
  generationId: "video-1",
  createdAtEpochSeconds: 1_788_000_000,
  input: { prompt: "海边日落", model: "firefly-sora2-8s-16x9" },
  inputReferences: [],
};

/** 构造一条图像业务行，调用方只覆盖当前状态场景。 */
function createImageRow(overrides: Partial<Generation> = {}): Generation {
  const now = new Date("2026-07-10T00:00:00.000Z");
  return {
    id: "gen-1",
    userId: "user-1",
    prompt: "移除背景",
    revisedPrompt: null,
    model: "gpt-image-2",
    size: "1024x1024",
    status: "completed",
    executionToken: "lease-token-1",
    storageKey: "user-1/final.png",
    storageBucket: "generations",
    fileSize: 4,
    creditsConsumed: 3.15,
    error: null,
    metadata: null,
    createdAt: now,
    completedAt: now,
    ...overrides,
  };
}

/**
 * 构造可变内存业务行与全部 resolver 依赖。
 *
 * @param options 初始行、鉴权结果及需覆盖的执行/恢复函数。
 * @returns resolver、依赖 mock 与业务行 setter，便于模拟执行后的数据库真相。
 * @sideEffects 无外部 I/O。
 */
function createHarness(options?: {
  imageRows?: Generation[];
  videoRow?: VideoGenerationTaskExecutionRow | null;
  authorized?: boolean;
  runImage?: (
    input: Parameters<GenerationTaskResolverDependencies["runImage"]>[0]
  ) => Promise<void>;
  runVideo?: (
    input: Parameters<GenerationTaskResolverDependencies["runVideo"]>[0]
  ) => Promise<void>;
  recoverVideo?: (
    input: Parameters<GenerationTaskResolverDependencies["recoverVideo"]>[0]
  ) => Promise<void>;
}) {
  let imageRows = options?.imageRows ?? [];
  let videoRow = options?.videoRow ?? null;
  const readImageRows = vi.fn(async () => imageRows);
  const readVideoRow = vi.fn(async () => videoRow);
  const expireStaleImages = vi.fn(async () => {});
  const recoverVideo = vi.fn(options?.recoverVideo ?? (async () => {}));
  const authorizeExecution = vi.fn(async () =>
    options?.authorized === false
      ? ({ ok: false, message: "API key is inactive" } as const)
      : ({
          ok: true,
          context: {
            plan: "pro" as const,
            moderationBlockRiskLevel: "low" as const,
          },
        } as const)
  );
  const loadInputs = vi.fn(async () => [
    { ...sourceReference, data: Buffer.from("data") },
  ]);
  const runImage = vi.fn(options?.runImage ?? (async () => {}));
  const runVideo = vi.fn(options?.runVideo ?? (async () => {}));
  const dependencies: GenerationTaskResolverDependencies = {
    readImageRows,
    expireStaleImages,
    readVideoRow,
    recoverVideo,
    authorizeExecution,
    loadInputs,
    runImage,
    runVideo,
    toErrorPayload: (error) => ({
      error: {
        message: error instanceof Error ? error.message : "unknown error",
      },
    }),
  };
  return {
    resolvers: createGenerationTaskResolvers(dependencies),
    readImageRows,
    readVideoRow,
    expireStaleImages,
    recoverVideo,
    authorizeExecution,
    loadInputs,
    runImage,
    runVideo,
    setImageRows(rows: Generation[]) {
      imageRows = rows;
    },
    setVideoRow(row: VideoGenerationTaskExecutionRow | null) {
      videoRow = row;
    },
  };
}

describe("generation task resolver", () => {
  it("已完成图像只对账终结，不重新鉴权或调用上游", async () => {
    const harness = createHarness({ imageRows: [createImageRow()] });

    const result = await harness.resolvers.resolveTask({
      row: taskRow,
      request: imageRequest,
      leaseToken: "lease-token-1",
      reconcileOnly: false,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "completed",
      objectType: "image",
      resultPayload: { generationIds: ["gen-1"] },
    });
    expect(harness.authorizeExecution).not.toHaveBeenCalled();
    expect(harness.runImage).not.toHaveBeenCalled();
  });

  it("缺失图像执行时透传 lease token/signal，并以重查终态为准", async () => {
    const controller = new AbortController();
    const harness = createHarness({
      runImage: async () => {
        harness.setImageRows([createImageRow()]);
      },
    });

    const result = await harness.resolvers.resolveTask({
      row: taskRow,
      request: imageRequest,
      leaseToken: "lease-token-1",
      reconcileOnly: false,
      signal: controller.signal,
    });

    expect(result).toMatchObject({ status: "completed" });
    expect(harness.loadInputs).toHaveBeenCalledOnce();
    expect(harness.runImage).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-1",
        executionToken: "lease-token-1",
        signal: controller.signal,
      })
    );
  });

  it("接管 pending 后业务仍 pending 时消耗本次 attempt 并重排", async () => {
    const pending = createImageRow({
      status: "pending",
      completedAt: null,
      storageKey: null,
      executionToken: "old-token",
    });
    const harness = createHarness({ imageRows: [pending] });

    const result = await harness.resolvers.resolveTask({
      row: taskRow,
      request: imageRequest,
      leaseToken: "lease-token-2",
      reconcileOnly: false,
      signal: new AbortController().signal,
    });

    expect(harness.expireStaleImages).toHaveBeenCalledWith("user-1");
    expect(harness.runImage).toHaveBeenCalledOnce();
    expect(result).toEqual({
      status: "requeue",
      consumeAttempt: true,
      delayMs: 2_000,
    });
  });

  it("legacy pending 只轮询并回退计数，绝不盲跑上游", async () => {
    const harness = createHarness({
      imageRows: [
        createImageRow({
          status: "pending",
          completedAt: null,
          storageKey: null,
        }),
      ],
    });

    const result = await harness.resolvers.resolveLegacyTask({
      row: taskRow,
      leaseToken: "lease-token-1",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "requeue",
      consumeAttempt: false,
      delayMs: 2_000,
    });
    expect(harness.authorizeExecution).not.toHaveBeenCalled();
    expect(harness.runImage).not.toHaveBeenCalled();
  });

  it("exhausted 对账缺失业务行时失败但不执行", async () => {
    const harness = createHarness();

    const result = await harness.resolvers.resolveTask({
      row: taskRow,
      request: imageRequest,
      leaseToken: "lease-token-1",
      reconcileOnly: true,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: "failed",
      objectType: "image",
      errorPayload: {
        error: {
          message: "Generation task could not be recovered after retries",
        },
      },
    });
    expect(harness.runImage).not.toHaveBeenCalled();
  });

  it("当前 API Key 不再允许执行时 fail-closed", async () => {
    const harness = createHarness({ authorized: false });

    const result = await harness.resolvers.resolveTask({
      row: taskRow,
      request: imageRequest,
      leaseToken: "lease-token-1",
      reconcileOnly: false,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: "failed",
      errorPayload: { error: { message: "API key is inactive" } },
    });
    expect(harness.loadInputs).not.toHaveBeenCalled();
    expect(harness.runImage).not.toHaveBeenCalled();
  });

  it("视频活动态先恢复，再以同一 token/signal 接管并重查完成行", async () => {
    const controller = new AbortController();
    const pendingVideo: VideoGenerationTaskExecutionRow = {
      id: "video-1",
      userId: "user-1",
      apiKeyId: "key-1",
      status: "running",
      error: null,
    };
    const harness = createHarness({
      videoRow: pendingVideo,
      runVideo: async () => {
        harness.setVideoRow({ ...pendingVideo, status: "completed" });
      },
    });

    const result = await harness.resolvers.resolveTask({
      row: { ...taskRow, taskType: "video" },
      request: videoRequest,
      leaseToken: "lease-token-2",
      reconcileOnly: false,
      signal: controller.signal,
    });

    expect(harness.recoverVideo).toHaveBeenCalledWith({
      generationId: "video-1",
      userId: "user-1",
      apiKeyId: "key-1",
      executionToken: "lease-token-2",
    });
    expect(harness.runVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        executionToken: "lease-token-2",
        signal: controller.signal,
      })
    );
    expect(result).toEqual({
      status: "completed",
      objectType: "video",
      resultPayload: { generationId: "video-1" },
    });
  });

  it("视频财务恢复异常向上抛，不伪造 task 失败终态", async () => {
    const harness = createHarness({
      videoRow: {
        id: "video-1",
        userId: "user-1",
        apiKeyId: "key-1",
        status: "recovering",
        error: null,
      },
      recoverVideo: async () => {
        throw new Error("refund ledger unavailable");
      },
    });

    await expect(
      harness.resolvers.resolveTask({
        row: { ...taskRow, taskType: "video" },
        request: videoRequest,
        leaseToken: "lease-token-2",
        reconcileOnly: false,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow("refund ledger unavailable");
    expect(harness.runVideo).not.toHaveBeenCalled();
  });
});
