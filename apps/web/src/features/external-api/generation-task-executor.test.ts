/**
 * generation task 生产执行参数映射测试。
 *
 * 职责：锁定严格 payload 到单一图像/视频管线的 executionToken、AbortSignal、当前身份
 * 与对象引用映射。业务管线全部 mock，不访问数据库、对象存储、积分或上游。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const operationMocks = vi.hoisted(() => ({
  runImage: vi.fn(async () => ({ generationId: "gen-1" })),
  runVideo: vi.fn(async () => ({
    videoGenerationId: "video-1",
    storageKey: "user-1/final.mp4",
    creditsConsumed: 10,
  })),
}));

vi.mock("@/features/image-generation/operations", () => ({
  runImageGenerationForUser: operationMocks.runImage,
}));
vi.mock("@/features/image-generation/video-operations", () => ({
  runAdobeVideoGenerationForUser: operationMocks.runVideo,
}));

import {
  runGenerationTaskImage,
  runGenerationTaskVideo,
} from "./generation-task-executor";

const row = {
  id: "task-1",
  userId: "user-1",
  apiKeyId: "key-1",
  taskType: "image" as const,
  userConcurrency: 2,
  initialPayload: { generationId: "gen-1" },
  requestPayload: null,
};

const context = {
  plan: "pro" as const,
  moderationBlockRiskLevel: "low" as const,
};

beforeEach(() => {
  operationMocks.runImage.mockClear();
  operationMocks.runVideo.mockClear();
});

describe("generation task executor", () => {
  it("图像生成强制透传当前 lease token、signal 与权限上下文", async () => {
    const controller = new AbortController();

    await runGenerationTaskImage({
      row,
      request: {
        kind: "image_generate",
        relayOnly: false,
        generationIds: ["gen-1"],
        createdAtEpochSeconds: 1_788_000_000,
        responseFormat: "url",
        input: {
          prompt: "一只猫",
          model: "gpt-image-2",
          moderationBlockRiskLevel: "high",
        },
      },
      generationId: "gen-1",
      executionToken: "lease-token-1",
      context,
      inputs: [],
      signal: controller.signal,
    });

    expect(operationMocks.runImage).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "generate",
        backendRequestKind: "image_generation",
        userId: "user-1",
        apiKeyId: "key-1",
        generationId: "gen-1",
        executionToken: "lease-token-1",
        signal: controller.signal,
        resolvedUserPlan: "pro",
        relayOnly: false,
        moderationBlockRiskLevel: "low",
      })
    );
  });

  it("图像编辑恢复 source/mask 的字节与 storage 引用", async () => {
    const source = {
      bucket: "generations",
      key: "user-1/async-task-inputs/task-1/source.png",
      name: "source.png",
      contentType: "image/png",
      size: 4,
      role: "source" as const,
      data: Buffer.from("source"),
    };
    const mask = {
      ...source,
      key: "user-1/async-task-inputs/task-1/mask.png",
      name: "mask.png",
      role: "mask" as const,
      data: Buffer.from("mask"),
    };

    await runGenerationTaskImage({
      row,
      request: {
        kind: "image_edit",
        relayOnly: false,
        generationIds: ["gen-1"],
        createdAtEpochSeconds: 1_788_000_000,
        responseFormat: "url",
        input: { prompt: "移除背景", model: "gpt-image-2" },
        inputReferences: [source, mask],
      },
      generationId: "gen-1",
      executionToken: "lease-token-2",
      context,
      inputs: [source, mask],
      signal: new AbortController().signal,
    });

    expect(operationMocks.runImage).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "edit",
        executionToken: "lease-token-2",
        images: [
          expect.objectContaining({
            data: source.data,
            type: "image/png",
            storageBucket: "generations",
            storageKey: source.key,
          }),
        ],
        mask: expect.objectContaining({
          data: mask.data,
          storageKey: mask.key,
        }),
        n: 1,
      })
    );
  });

  it("视频执行透传 token/signal 并保留输入角色引用", async () => {
    const controller = new AbortController();
    const firstFrame = {
      bucket: "generations",
      key: "user-1/async-task-inputs/task-1/first.png",
      name: "first.png",
      contentType: "image/png",
      size: 4,
      role: "first" as const,
      data: Buffer.from("frame"),
    };

    await runGenerationTaskVideo({
      row: { ...row, taskType: "video" },
      request: {
        kind: "video",
        relayOnly: false,
        generationId: "video-1",
        createdAtEpochSeconds: 1_788_000_000,
        input: {
          prompt: "海边日落",
          model: "firefly-sora2-8s-16x9",
          negativePrompt: "文字",
        },
        inputReferences: [firstFrame],
      },
      executionToken: "lease-token-3",
      context,
      inputs: [firstFrame],
      signal: controller.signal,
    });

    expect(operationMocks.runVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        apiKeyId: "key-1",
        videoGenerationId: "video-1",
        executionToken: "lease-token-3",
        signal: controller.signal,
        inputImages: [{ data: firstFrame.data, type: "image/png" }],
        inputImageRefs: [{ storageKey: firstFrame.key, role: "first" }],
      })
    );
  });
});
