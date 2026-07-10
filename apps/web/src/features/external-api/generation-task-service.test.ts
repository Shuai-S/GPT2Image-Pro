/**
 * 普通 generation 持久任务入队服务测试。
 *
 * 使用 DB-free 对象存储和任务 store mock，锁定二进制只写对象存储、数据库 JSON 只含
 * 严格引用，以及任务插入失败时清理已写对象。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAsyncImageTask: vi.fn(),
  deleteObject: vi.fn(),
  putObject: vi.fn(),
}));

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
}));
vi.mock("./async-image-tasks", () => ({
  createAsyncImageTask: mocks.createAsyncImageTask,
}));
vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(async () => ({
    deleteObject: mocks.deleteObject,
    putObject: mocks.putObject,
  })),
}));
vi.mock("@repo/shared/system-settings", () => {
  return {
    getRuntimeSettingString: vi.fn(async () => "generations"),
  };
});

import { enqueueGenerationTask } from "./generation-task-service";

const sourceReference = {
  bucket: "generations",
  key: "user-1/async-task-inputs/task_00000000000040008000000000000001/1.png",
  name: "source.png",
  contentType: "image/png",
  size: 4,
  role: "source" as const,
};

const editRequest = {
  kind: "image_edit" as const,
  generationIds: ["generation-1"],
  createdAtEpochSeconds: 1_788_000_000,
  responseFormat: "url" as const,
  input: {
    prompt: "remove background",
    model: "gpt-image-2",
    size: "1024x1024",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.putObject.mockResolvedValue(undefined);
  mocks.deleteObject.mockResolvedValue(undefined);
  mocks.createAsyncImageTask.mockImplementation(async (input) => ({
    ...input,
    object: "image.generation",
    status: "processing",
    created_at: "2026-07-10T00:00:00.000Z",
  }));
});

describe("enqueueGenerationTask", () => {
  it("把媒体写成对象引用且 requestPayload 不包含二进制", async () => {
    const media = Buffer.from("data");
    await enqueueGenerationTask({
      userId: "user-1",
      apiKeyId: "key-1",
      relayOnly: false,
      callbackUrl: "https://example.com/callback",
      priority: "highest",
      userConcurrency: 3,
      request: editRequest,
      mediaInputs: [
        {
          data: media,
          name: "source.png",
          contentType: "image/png",
          role: "source",
        },
      ],
    });

    expect(mocks.putObject).toHaveBeenCalledWith(
      sourceReference.key,
      "generations",
      media,
      "image/png"
    );
    expect(mocks.createAsyncImageTask).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "queued",
        priority: 2,
        userConcurrency: 3,
        maxAttempts: 3,
        requestPayload: {
          ...editRequest,
          relayOnly: false,
          inputReferences: [sourceReference],
        },
      })
    );
    const createInput = mocks.createAsyncImageTask.mock.calls[0]?.[0];
    expect(JSON.stringify(createInput?.requestPayload)).not.toContain("data");
    expect(createInput?.requestPayload).not.toHaveProperty("mediaInputs");
  });

  it("数据库入队失败时清理同一任务的已写对象并保留原错误", async () => {
    const databaseError = new Error("database unavailable");
    mocks.createAsyncImageTask.mockRejectedValueOnce(databaseError);

    await expect(
      enqueueGenerationTask({
        userId: "user-1",
        apiKeyId: "key-1",
        relayOnly: false,
        priority: "normal",
        userConcurrency: 2,
        request: editRequest,
        mediaInputs: [
          {
            data: Buffer.from("data"),
            name: "source.png",
            contentType: "image/png",
            role: "source",
          },
        ],
      })
    ).rejects.toBe(databaseError);
    expect(mocks.deleteObject).toHaveBeenCalledWith(
      sourceReference.key,
      sourceReference.bucket
    );
  });

  it("relay-only 身份在写对象前即 fail-closed", async () => {
    await expect(
      enqueueGenerationTask({
        userId: "user-1",
        apiKeyId: "key-1",
        relayOnly: true,
        priority: "normal",
        userConcurrency: 2,
        request: editRequest,
        mediaInputs: [
          {
            data: Buffer.from("data"),
            name: "source.png",
            contentType: "image/png",
            role: "source",
          },
        ],
      })
    ).rejects.toThrow("Relay-only identities cannot enqueue");
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.createAsyncImageTask).not.toHaveBeenCalled();
  });
});
