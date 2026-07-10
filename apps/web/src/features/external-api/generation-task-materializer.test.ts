/**
 * 普通 generation task 动态结果物化器的 DB-free 契约测试。
 *
 * 职责：锁定图像重签、base64 有限读取、视频桶快照与归属校验，并证明 legacy
 * payload 不会形成无界数据库查询。数据库、对象存储和站点配置均由内存依赖注入。
 */

import type { Generation } from "@repo/database/schema";
import { DEFAULT_IMAGE_RESPONSE_MAX_BYTES } from "@repo/shared/http/fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(),
}));
vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: vi.fn(),
}));

import type { ExternalAsyncTaskRow } from "./external-async-task-store";
import {
  type GenerationTaskMaterializerDependencies,
  materializeGenerationTask,
} from "./generation-task-materializer";

const MAX_LEGACY_GENERATION_IDS = 10_000;

/** 构造一条完整 external_async_task 行，调用方只覆盖当前场景字段。 */
function createTaskRow(
  overrides: Partial<ExternalAsyncTaskRow> = {}
): ExternalAsyncTaskRow {
  const now = new Date("2026-07-10T00:00:00.000Z");
  return {
    id: "task-1",
    taskType: "image",
    objectType: "image",
    userId: "user-1",
    apiKeyId: "key-1",
    kind: null,
    model: "gpt-image-2",
    clientRequestId: null,
    requestHash: null,
    status: "completed",
    priority: 0,
    userConcurrency: 1,
    attemptCount: 1,
    maxAttempts: 3,
    availableAt: now,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    initialPayload: {
      id: "task-1",
      object: "image.generation",
      status: "processing",
      generationId: "gen-1",
    },
    requestPayload: {
      kind: "image_generate",
      relayOnly: false,
      generationIds: ["gen-1"],
      createdAtEpochSeconds: 1_788_000_000,
      responseFormat: "url",
      input: { prompt: "一只猫", model: "gpt-image-2" },
    },
    resultPayload: { generationIds: ["gen-1"] },
    errorPayload: null,
    callbackUrl: null,
    callbackStatus: "none",
    callbackAttempts: 0,
    callbackNextAt: null,
    callbackLeaseOwner: null,
    callbackLeaseToken: null,
    callbackLeaseExpiresAt: null,
    callbackDeliveredAt: null,
    callbackError: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** 构造一条完整图像 generation 行，调用方可切换状态、桶或输出 metadata。 */
function createImageRow(overrides: Partial<Generation> = {}): Generation {
  const now = new Date("2026-07-10T00:00:00.000Z");
  return {
    id: "gen-1",
    userId: "user-1",
    prompt: "一只猫",
    revisedPrompt: "一只白猫",
    model: "gpt-image-2",
    size: "1024x1024",
    status: "completed",
    executionToken: null,
    storageKey: "user-1/final.png",
    storageBucket: "generation-archive",
    fileSize: 4,
    creditsConsumed: 3.15,
    error: null,
    metadata: null,
    createdAt: now,
    completedAt: now,
    ...overrides,
  };
}

/** 构造可断言调用次数与上限的物化依赖，不访问真实数据库或对象存储。 */
function createDependencies(options?: {
  imageRows?: Generation[];
  videoRow?: Awaited<
    ReturnType<GenerationTaskMaterializerDependencies["readVideoRow"]>
  >;
  objectData?: Buffer;
}) {
  const readImageRows = vi.fn(
    async (_ids: readonly string[]) => options?.imageRows ?? [createImageRow()]
  );
  const readVideoRow = vi.fn(async (_id: string) => options?.videoRow ?? null);
  const readObject = vi.fn(
    async (_key: string, _bucket: string, _maxBytes: number) =>
      options?.objectData ?? Buffer.from("image")
  );
  const dependencies: GenerationTaskMaterializerDependencies = {
    readImageRows,
    readVideoRow,
    readObject,
    getRuntimeSiteUrl: async () => "https://runtime.example.com",
  };
  return { dependencies, readImageRows, readVideoRow, readObject };
}

const previousSigningSecret = process.env.BETTER_AUTH_SECRET;

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "materializer-test-signing-secret";
});

afterEach(() => {
  if (previousSigningSecret === undefined) {
    delete process.env.BETTER_AUTH_SECRET;
  } else {
    process.env.BETTER_AUTH_SECRET = previousSigningSecret;
  }
});

describe("materializeGenerationTask", () => {
  it("按 generation 桶快照重签完成图像 URL", async () => {
    const { dependencies, readImageRows, readObject } = createDependencies();

    const result = await materializeGenerationTask(
      createTaskRow(),
      dependencies
    );

    expect(readImageRows).toHaveBeenCalledWith(["gen-1"]);
    expect(readObject).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      objectType: "image",
      status: "completed",
      payload: {
        created: 1_788_000_000,
        data: [
          {
            url: expect.stringContaining(
              "https://runtime.example.com/api/storage/generation-archive/user-1/final.png"
            ),
            revised_prompt: "一只白猫",
          },
        ],
        credits_consumed: 3.15,
      },
    });
  });

  it("仅在物化 b64_json 时有限读取对象", async () => {
    const { dependencies, readObject } = createDependencies({
      objectData: Buffer.from("bounded-image"),
    });
    const task = createTaskRow({
      requestPayload: {
        kind: "image_generate",
        relayOnly: false,
        generationIds: ["gen-1"],
        createdAtEpochSeconds: 1_788_000_000,
        responseFormat: "b64_json",
        input: { prompt: "一只猫", model: "gpt-image-2" },
      },
    });

    const result = await materializeGenerationTask(task, dependencies);

    expect(readObject).toHaveBeenCalledWith(
      "user-1/final.png",
      "generation-archive",
      DEFAULT_IMAGE_RESPONSE_MAX_BYTES
    );
    expect(result).toMatchObject({
      status: "completed",
      payload: {
        data: [{ b64_json: Buffer.from("bounded-image").toString("base64") }],
      },
    });
    expect(task.resultPayload).toEqual({ generationIds: ["gen-1"] });
  });

  it("累计 base64 达 100 MiB 后不再读取后续输出", async () => {
    const largeObject = Buffer.from("bounded");
    Object.defineProperty(largeObject, "byteLength", {
      value: DEFAULT_IMAGE_RESPONSE_MAX_BYTES,
    });
    const imageRows = [
      createImageRow({
        metadata: {
          outputImage: {
            imageOutputs: Array.from({ length: 5 }, (_, index) => ({
              storageKey: `user-1/output-${index}.png`,
              role: "final",
            })),
          },
        },
      }),
    ];
    const { dependencies, readObject } = createDependencies({
      imageRows,
      objectData: largeObject,
    });

    const result = await materializeGenerationTask(
      createTaskRow({
        requestPayload: {
          kind: "image_generate",
          relayOnly: false,
          generationIds: ["gen-1"],
          createdAtEpochSeconds: 1_788_000_000,
          responseFormat: "b64_json",
          input: { prompt: "一只猫", model: "gpt-image-2" },
        },
      }),
      dependencies
    );

    expect(readObject).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({
      status: "failed",
      payload: {
        error: { message: "Materialized image response exceeds 100 MiB" },
      },
    });
  });

  it("视频只使用完成行持久化的桶快照", async () => {
    const { dependencies } = createDependencies({
      videoRow: {
        id: "video-1",
        userId: "user-1",
        apiKeyId: "key-1",
        model: "firefly-sora2-8s-16x9",
        status: "completed",
        storageKey: "user-1/final.mp4",
        creditsConsumed: 240,
        error: null,
        metadata: { storageBucket: "video-archive" },
      },
    });
    const task = createTaskRow({
      taskType: "video",
      objectType: "video",
      initialPayload: { generationId: "video-1" },
      requestPayload: {
        kind: "video",
        relayOnly: false,
        generationId: "video-1",
        createdAtEpochSeconds: 1_788_000_000,
        input: { prompt: "海边日落", model: "firefly-sora2-8s-16x9" },
        inputReferences: [],
      },
      resultPayload: { generationId: "video-1" },
    });

    const result = await materializeGenerationTask(task, dependencies);

    expect(result).toMatchObject({
      objectType: "video",
      status: "completed",
      payload: {
        video_url: expect.stringContaining(
          "https://runtime.example.com/api/storage/video-archive/user-1/final.mp4"
        ),
        credits_consumed: 240,
      },
    });
  });

  it("视频缺失桶快照时 fail-closed，归属不符时拒绝物化", async () => {
    const task = createTaskRow({
      taskType: "video",
      requestPayload: {
        kind: "video",
        relayOnly: false,
        generationId: "video-1",
        createdAtEpochSeconds: 1_788_000_000,
        input: { prompt: "海边日落", model: "firefly-sora2-8s-16x9" },
        inputReferences: [],
      },
    });
    const baseVideo = {
      id: "video-1",
      userId: "user-1",
      apiKeyId: "key-1",
      model: "firefly-sora2-8s-16x9",
      status: "completed",
      storageKey: "user-1/final.mp4",
      creditsConsumed: 240,
      error: null,
      metadata: null,
    };
    const missingBucket = createDependencies({ videoRow: baseVideo });

    await expect(
      materializeGenerationTask(task, missingBucket.dependencies)
    ).resolves.toMatchObject({
      status: "failed",
      payload: {
        error: { message: "Completed video output bucket is unavailable" },
      },
    });

    const wrongOwner = createDependencies({
      videoRow: { ...baseVideo, userId: "user-2" },
    });
    await expect(
      materializeGenerationTask(task, wrongOwner.dependencies)
    ).rejects.toThrow("ownership does not match task");
  });

  it("pending 或完成但缺失输出的图像都 fail-closed", async () => {
    const pending = createDependencies({
      imageRows: [createImageRow({ status: "pending" })],
    });
    await expect(
      materializeGenerationTask(createTaskRow(), pending.dependencies)
    ).resolves.toMatchObject({
      status: "failed",
      payload: {
        error: { message: "Generation task result is still processing" },
      },
    });

    const missingOutput = createDependencies({
      imageRows: [
        createImageRow({
          storageBucket: null,
          metadata: null,
        }),
      ],
    });
    await expect(
      materializeGenerationTask(createTaskRow(), missingOutput.dependencies)
    ).resolves.toMatchObject({
      status: "failed",
      payload: {
        error: { message: "Completed generation output is unavailable" },
      },
    });
  });

  it("legacy ID 会 trim 去重且超过 10,000 项时拒绝数据库查询", async () => {
    const bounded = createDependencies();
    await materializeGenerationTask(
      createTaskRow({
        requestPayload: null,
        initialPayload: { generationIds: [" gen-1 ", "gen-1"] },
      }),
      bounded.dependencies
    );
    expect(bounded.readImageRows).toHaveBeenCalledWith(["gen-1"]);

    const oversized = createDependencies();
    const result = await materializeGenerationTask(
      createTaskRow({
        requestPayload: null,
        initialPayload: {
          generationIds: Array.from(
            { length: MAX_LEGACY_GENERATION_IDS + 1 },
            (_, index) => `gen-${index}`
          ),
        },
      }),
      oversized.dependencies
    );
    expect(result).toBeUndefined();
    expect(oversized.readImageRows).not.toHaveBeenCalled();
  });
});
