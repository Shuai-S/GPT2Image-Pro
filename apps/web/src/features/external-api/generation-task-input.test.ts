/**
 * 普通 generation 持久任务请求与输入对象契约测试。
 *
 * 使用内存存储 mock 保持 DB-free，覆盖严格 payload、媒体正文隔离、对象归属/大小复核、
 * 部分写入回滚和终态尽力清理，防止 worker 从任务 JSON 恢复不可信字节。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  putObject: vi.fn(),
  getObject: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(async () => storageMocks),
}));

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: vi.fn(async () => "generations"),
}));

import {
  cleanupGenerationTaskInputs,
  generationTaskRequestPayloadSchema,
  loadGenerationTaskInputs,
  storeGenerationTaskInputs,
} from "./generation-task-input";

const sourceReference = {
  bucket: "generations",
  key: "user-1/async-task-inputs/task-1/1.png",
  name: "source.png",
  contentType: "image/png",
  size: 4,
  role: "source" as const,
};

/**
 * 递归断言任务 JSON 不含内存二进制或内联媒体正文。
 *
 * @param value Zod 解析后的持久 payload。
 * @throws 发现 Buffer、File、Blob、typed array 或 data URL 时使测试失败。
 * @sideEffects 无。
 */
function expectMediaBodyFree(value: unknown): void {
  expect(Buffer.isBuffer(value)).toBe(false);
  expect(value instanceof ArrayBuffer).toBe(false);
  expect(ArrayBuffer.isView(value)).toBe(false);
  if (typeof Blob !== "undefined") expect(value instanceof Blob).toBe(false);
  if (typeof File !== "undefined") expect(value instanceof File).toBe(false);
  if (typeof value === "string") {
    expect(value).not.toMatch(/^data:[^;,]+;base64,/i);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) expectMediaBodyFree(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      expectMediaBodyFree(item);
    }
  }
}

beforeEach(() => {
  storageMocks.putObject.mockReset();
  storageMocks.getObject.mockReset();
  storageMocks.deleteObject.mockReset();
  storageMocks.putObject.mockResolvedValue(undefined);
  storageMocks.getObject.mockResolvedValue(Buffer.from("data"));
  storageMocks.deleteObject.mockResolvedValue(undefined);
});

describe("generation task request payload", () => {
  it("接受三类严格标量与引用协议且不保留媒体正文", () => {
    const payloads = [
      {
        kind: "image_generate",
        generationIds: ["gen-1", "gen-2"],
        createdAtEpochSeconds: 1_788_000_000,
        responseFormat: "b64_json",
        input: {
          prompt: "生成一张海报",
          model: "gpt-image-2",
          outputFormat: "png",
          moderationBlockRiskLevel: "medium",
        },
      },
      {
        kind: "image_edit",
        generationIds: ["gen-edit-1"],
        createdAtEpochSeconds: 1_788_000_001,
        responseFormat: "url",
        input: {
          prompt: "移除背景",
          model: "gpt-image-2",
          background: "transparent",
        },
        inputReferences: [sourceReference],
      },
      {
        kind: "video",
        generationId: "video-1",
        createdAtEpochSeconds: 1_788_000_002,
        input: {
          prompt: "镜头缓慢向前",
          model: "firefly-sora2-8s-16x9",
          negativePrompt: "闪烁",
        },
        inputReferences: [
          {
            ...sourceReference,
            role: "first",
          },
        ],
      },
    ];

    for (const payload of payloads) {
      const parsed = generationTaskRequestPayloadSchema.parse(payload);
      expectMediaBodyFree(parsed);
    }
  });

  it("拒绝额外 base64、Buffer、非法 role 和额外身份字段", () => {
    expect(
      generationTaskRequestPayloadSchema.safeParse({
        kind: "image_generate",
        generationIds: ["gen-1"],
        createdAtEpochSeconds: 1,
        responseFormat: "url",
        input: {
          prompt: "prompt",
          model: "gpt-image-2",
          userId: "attacker",
        },
      }).success
    ).toBe(false);
    expect(
      generationTaskRequestPayloadSchema.safeParse({
        kind: "image_edit",
        generationIds: ["gen-1"],
        createdAtEpochSeconds: 1,
        responseFormat: "url",
        input: { prompt: "prompt", model: "gpt-image-2" },
        inputReferences: [
          {
            ...sourceReference,
            role: "source",
            data: Buffer.from("media"),
          },
        ],
      }).success
    ).toBe(false);
    expect(
      generationTaskRequestPayloadSchema.safeParse({
        kind: "video",
        generationId: "video-1",
        createdAtEpochSeconds: 1,
        input: { prompt: "prompt", model: "firefly-sora2-8s-16x9" },
        inputReferences: [{ ...sourceReference, role: "source" }],
        image: "data:image/png;base64,aGVsbG8=",
      }).success
    ).toBe(false);
  });
});

describe("generation task input storage", () => {
  it("只把媒体写入任务隔离对象并返回 JSON 引用", async () => {
    const references = await storeGenerationTaskInputs({
      userId: "user-1",
      taskId: "task-1",
      inputs: [
        {
          data: Buffer.from("data"),
          name: "source.png",
          contentType: "image/png",
          role: "source",
        },
      ],
    });

    expect(storageMocks.putObject).toHaveBeenCalledWith(
      sourceReference.key,
      sourceReference.bucket,
      Buffer.from("data"),
      sourceReference.contentType
    );
    expect(references).toEqual([sourceReference]);
    expectMediaBodyFree(references);
  });

  it("存储中途失败时尽力删除已写对象", async () => {
    storageMocks.putObject
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(
      storeGenerationTaskInputs({
        userId: "user-1",
        taskId: "task-1",
        inputs: [
          {
            data: Buffer.from("data"),
            name: "source.png",
            contentType: "image/png",
            role: "source",
          },
          {
            data: Buffer.from("mask"),
            name: "mask.png",
            contentType: "image/png",
            role: "mask",
          },
        ],
      })
    ).rejects.toThrow("storage unavailable");
    expect(storageMocks.deleteObject).toHaveBeenCalledWith(
      sourceReference.key,
      sourceReference.bucket
    );
  });

  it("读取时复核 bucket、前缀、声明大小和正文上限", async () => {
    await expect(
      loadGenerationTaskInputs({
        userId: "user-1",
        taskId: "task-1",
        references: [sourceReference],
      })
    ).resolves.toEqual([{ ...sourceReference, data: Buffer.from("data") }]);
    expect(storageMocks.getObject).toHaveBeenCalledWith(
      sourceReference.key,
      sourceReference.bucket,
      { maxBytes: 5 }
    );

    await expect(
      loadGenerationTaskInputs({
        userId: "user-1",
        taskId: "task-1",
        references: [
          {
            ...sourceReference,
            key: "user-2/async-task-inputs/task-1/1.png",
          },
        ],
      })
    ).rejects.toThrow("Invalid generation task input reference");

    storageMocks.getObject.mockResolvedValueOnce(Buffer.from("changed"));
    await expect(
      loadGenerationTaskInputs({
        userId: "user-1",
        taskId: "task-1",
        references: [sourceReference],
      })
    ).rejects.toThrow("size does not match");
  });

  it("清理只删除本任务合法引用且吞掉单对象删除失败", async () => {
    storageMocks.deleteObject.mockRejectedValueOnce(new Error("delete failed"));
    await expect(
      cleanupGenerationTaskInputs({
        userId: "user-1",
        taskId: "task-1",
        references: [
          sourceReference,
          {
            ...sourceReference,
            key: "user-2/async-task-inputs/task-1/1.png",
          },
        ],
      })
    ).resolves.toBeUndefined();
    expect(storageMocks.deleteObject).toHaveBeenCalledTimes(1);
    expect(storageMocks.deleteObject).toHaveBeenCalledWith(
      sourceReference.key,
      sourceReference.bucket
    );
  });
});
