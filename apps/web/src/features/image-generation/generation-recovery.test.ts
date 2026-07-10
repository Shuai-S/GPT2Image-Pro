/**
 * 持久异步任务的 generation 终态恢复测试。
 *
 * 使用方：图像/视频统一管线与外部异步 worker。关键依赖：DB-free 恢复纯函数；
 * 测试锁定归属校验、pending 续跑和终态对账，避免接管时重复调用已完成上游任务。
 */

import { describe, expect, it, vi } from "vitest";
import {
  recoverImageGenerationResult,
  recoverVideoGenerationResult,
  videoGenerationNeedsRecovery,
} from "./generation-recovery";

const buildImageUrl = vi.fn(
  (storageKey: string, bucket: string | null) =>
    `https://app.example/${bucket ?? "generations"}/${storageKey}`
);

describe("recoverImageGenerationResult", () => {
  it("从完成行的受控 storage metadata 恢复多输出", () => {
    const result = recoverImageGenerationResult(
      {
        id: "generation-1",
        userId: "user-1",
        status: "completed",
        model: "gpt-image-1",
        size: "1024x1024",
        storageKey: "user-1/final.png",
        storageBucket: "generations",
        revisedPrompt: "revised",
        creditsConsumed: 12,
        error: null,
        metadata: {
          outputImage: {
            imageOutputs: [
              {
                generationId: "generation-1-draft",
                storageKey: "user-1/draft.png",
                size: "512x512",
                role: "agent_draft",
              },
              {
                generationId: "generation-1",
                storageKey: "user-1/final.png",
                size: "1024x1024",
                revisedPrompt: "output revised",
                role: "final",
                primary: true,
              },
            ],
          },
          moderationPromptRepair: {
            succeeded: true,
            notice: "prompt adjusted",
          },
        },
      },
      { expectedUserId: "user-1", buildImageUrl }
    );

    expect(result).toMatchObject({
      generationId: "generation-1",
      imageUrl: "https://app.example/generations/user-1/final.png",
      promptRepairNotice: "prompt adjusted",
      creditsConsumed: 12,
      imageOutputs: [
        {
          generationId: "generation-1-draft",
          imageUrl: "https://app.example/generations/user-1/draft.png",
          outputRole: "agent_draft",
        },
        {
          generationId: "generation-1",
          imageUrl: "https://app.example/generations/user-1/final.png",
          outputRole: "final",
        },
      ],
    });
  });

  it("pending 行交给当前租约继续，失败行直接恢复错误", () => {
    const base = {
      id: "generation-1",
      userId: "user-1",
      model: "gpt-image-1",
      size: "1024x1024",
      storageKey: null,
      storageBucket: "generations",
      revisedPrompt: null,
      creditsConsumed: 0,
      metadata: null,
    };

    expect(
      recoverImageGenerationResult(
        { ...base, status: "pending", error: null },
        { expectedUserId: "user-1", buildImageUrl }
      )
    ).toBeUndefined();
    expect(
      recoverImageGenerationResult(
        { ...base, status: "failed", error: "upstream failed" },
        { expectedUserId: "user-1", buildImageUrl }
      )
    ).toMatchObject({
      generationId: "generation-1",
      error: "upstream failed",
    });
  });

  it("拒绝复用其他用户的 generation ID", () => {
    expect(() =>
      recoverImageGenerationResult(
        {
          id: "generation-1",
          userId: "other-user",
          status: "pending",
          model: "gpt-image-1",
          size: "1024x1024",
          storageKey: null,
          storageBucket: "generations",
          revisedPrompt: null,
          creditsConsumed: 0,
          error: null,
          metadata: null,
        },
        { expectedUserId: "user-1", buildImageUrl }
      )
    ).toThrow("does not belong to the requesting user");
  });
});

describe("recoverVideoGenerationResult", () => {
  it("完成视频直接恢复 storage key，pending 继续执行", () => {
    const base = {
      id: "video-1",
      userId: "user-1",
      apiKeyId: "key-1",
      status: "pending",
      storageKey: null,
      creditsConsumed: 0,
      error: null,
    };

    expect(
      recoverVideoGenerationResult(base, {
        expectedUserId: "user-1",
        expectedApiKeyId: "key-1",
      })
    ).toBeUndefined();
    expect(
      recoverVideoGenerationResult(
        {
          ...base,
          status: "completed",
          storageKey: "user-1/video.mp4",
          creditsConsumed: 45,
        },
        { expectedUserId: "user-1", expectedApiKeyId: "key-1" }
      )
    ).toEqual({
      videoGenerationId: "video-1",
      storageKey: "user-1/video.mp4",
      creditsConsumed: 45,
    });
  });

  it("拒绝其他 API Key 的视频行并恢复失败终态", () => {
    const row = {
      id: "video-1",
      userId: "user-1",
      apiKeyId: "key-2",
      status: "failed",
      storageKey: null,
      creditsConsumed: 0,
      error: "video failed",
    };
    expect(() =>
      recoverVideoGenerationResult(row, {
        expectedUserId: "user-1",
        expectedApiKeyId: "key-1",
      })
    ).toThrow("does not belong to the requesting API key");
    expect(
      recoverVideoGenerationResult(row, {
        expectedUserId: "user-1",
      })
    ).toEqual({ error: "video failed", videoGenerationId: "video-1" });
  });

  it("只领取超时执行态，并允许 recovering 补偿重入", () => {
    const now = new Date("2026-07-10T10:30:00.000Z").getTime();
    const timeoutMs = 20 * 60_000;

    expect(
      videoGenerationNeedsRecovery(
        {
          status: "running",
          updatedAt: new Date("2026-07-10T10:00:00.000Z"),
        },
        { nowMs: now, timeoutMs }
      )
    ).toBe(true);
    expect(
      videoGenerationNeedsRecovery(
        {
          status: "pending",
          updatedAt: new Date("2026-07-10T10:20:00.000Z"),
        },
        { nowMs: now, timeoutMs }
      )
    ).toBe(false);
    expect(
      videoGenerationNeedsRecovery(
        { status: "recovering", updatedAt: new Date(now) },
        { nowMs: now, timeoutMs }
      )
    ).toBe(true);
    expect(
      videoGenerationNeedsRecovery(
        { status: "completed", updatedAt: new Date(0) },
        { nowMs: now, timeoutMs }
      )
    ).toBe(false);
  });
});
