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
  findGenerationTaskByClientRequest: vi.fn(),
  materializeAsyncImageTask: vi.fn(),
  putObject: vi.fn(),
}));

vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
}));
vi.mock("./async-image-tasks", () => ({
  createAsyncImageTask: mocks.createAsyncImageTask,
  materializeAsyncImageTask: mocks.materializeAsyncImageTask,
}));
vi.mock("./external-async-task-store", () => ({
  findGenerationTaskByClientRequest: mocks.findGenerationTaskByClientRequest,
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

import { GenerationTaskConflictError } from "./generation-task-idempotency";
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

const existingRow = {
  id: "task-existing",
  taskType: "image",
  requestHash: "",
};

const existingTask = {
  id: "task-existing",
  object: "image.generation",
  userId: "user-1",
  apiKeyId: "key-1",
  model: "gpt-image-2",
  status: "processing",
  created_at: "2026-07-10T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.putObject.mockResolvedValue(undefined);
  mocks.deleteObject.mockResolvedValue(undefined);
  mocks.findGenerationTaskByClientRequest.mockResolvedValue(undefined);
  mocks.materializeAsyncImageTask.mockResolvedValue(existingTask);
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
    expect(mocks.findGenerationTaskByClientRequest).not.toHaveBeenCalled();
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

  it("首次 API Key 幂等请求在写对象前查重并持久化身份/key/hash", async () => {
    await enqueueGenerationTask({
      userId: "user-1",
      apiKeyId: "key-1",
      relayOnly: false,
      clientRequestId: "request-1",
      callbackUrl: "https://example.com/callback",
      priority: "highest",
      userConcurrency: 3,
      request: editRequest,
      mediaInputs: [
        {
          data: Buffer.from("data"),
          name: "source.png",
          contentType: "image/png",
          role: "source",
        },
      ],
    });

    expect(mocks.findGenerationTaskByClientRequest).toHaveBeenCalledWith({
      userId: "user-1",
      apiKeyId: "key-1",
      taskType: "image",
      clientRequestId: "request-1",
    });
    expect(
      mocks.findGenerationTaskByClientRequest.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.putObject.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.createAsyncImageTask).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: "key-1",
        clientRequestId: "request-1",
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    );
  });

  it("同 key 同内容串行重放动态物化已有终态且不写对象", async () => {
    const firstLookupHash = await captureRequestHash();
    vi.clearAllMocks();
    mocks.findGenerationTaskByClientRequest.mockResolvedValue({
      ...existingRow,
      requestHash: firstLookupHash,
    });
    mocks.materializeAsyncImageTask.mockResolvedValue({
      ...existingTask,
      object: "image",
      status: "completed",
      data: [{ url: "/api/storage/generations/final.png?sig=current" }],
    });

    await expect(
      enqueueGenerationTask(idempotentInput())
    ).resolves.toMatchObject({
      id: "task-existing",
      status: "completed",
      data: [{ url: expect.stringContaining("sig=current") }],
    });
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.createAsyncImageTask).not.toHaveBeenCalled();
    expect(mocks.materializeAsyncImageTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-existing" })
    );
  });

  it("同 key 异内容在写对象前返回专用冲突", async () => {
    mocks.findGenerationTaskByClientRequest.mockResolvedValue({
      ...existingRow,
      requestHash: "different-hash",
    });

    await expect(
      enqueueGenerationTask(idempotentInput())
    ).rejects.toBeInstanceOf(GenerationTaskConflictError);
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.createAsyncImageTask).not.toHaveBeenCalled();
  });

  it("并发唯一冲突先清理 loser 输入，再动态物化同内容 winner", async () => {
    const requestHash = await captureRequestHash();
    vi.clearAllMocks();
    mocks.putObject.mockResolvedValue(undefined);
    mocks.deleteObject.mockResolvedValue(undefined);
    mocks.findGenerationTaskByClientRequest
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...existingRow, requestHash });
    mocks.createAsyncImageTask.mockRejectedValueOnce(
      Object.assign(new Error("unique violation"), { code: "23505" })
    );
    mocks.materializeAsyncImageTask.mockResolvedValue(existingTask);

    await expect(enqueueGenerationTask(idempotentInput())).resolves.toEqual(
      existingTask
    );
    expect(mocks.deleteObject).toHaveBeenCalledWith(
      sourceReference.key,
      sourceReference.bucket
    );
    expect(mocks.deleteObject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.findGenerationTaskByClientRequest.mock.invocationCallOrder[1] ?? 0
    );
    expect(mocks.materializeAsyncImageTask).toHaveBeenCalledOnce();
  });

  it("并发 loser 输入清理失败显式抛 AggregateError 且不读取 winner", async () => {
    const insertError = Object.assign(new Error("unique violation"), {
      code: "23505",
    });
    const cleanupError = new Error("delete failed");
    mocks.createAsyncImageTask.mockRejectedValueOnce(insertError);
    mocks.deleteObject.mockRejectedValueOnce(cleanupError);

    const promise = enqueueGenerationTask(idempotentInput());
    await expect(promise).rejects.toBeInstanceOf(AggregateError);
    await expect(promise).rejects.toMatchObject({
      errors: [insertError, expect.any(AggregateError)],
    });
    expect(mocks.findGenerationTaskByClientRequest).toHaveBeenCalledOnce();
    expect(mocks.materializeAsyncImageTask).not.toHaveBeenCalled();
  });
});

/**
 * 构造带媒体的标准幂等 image_edit 入队输入。
 *
 * @returns 每次调用均含新 Buffer 的标准 service 输入。
 * @sideEffects 仅分配测试对象与内存 Buffer。
 */
function idempotentInput() {
  return {
    userId: "user-1",
    apiKeyId: "key-1",
    relayOnly: false,
    clientRequestId: "request-1",
    callbackUrl: "https://example.com/callback",
    priority: "highest" as const,
    userConcurrency: 3,
    request: editRequest,
    mediaInputs: [
      {
        data: Buffer.from("data"),
        name: "source.png",
        contentType: "image/png",
        role: "source" as const,
      },
    ],
  };
}

/**
 * 首次调用 service 后读取其传给持久层的稳定 requestHash。
 *
 * @returns createAsyncImageTask mock 捕获的十六进制请求摘要。
 * @throws service 失败或 mock 未捕获字符串摘要时抛错。
 * @sideEffects 调用被测 service，并触发当前测试配置的 mock。
 */
async function captureRequestHash(): Promise<string> {
  await enqueueGenerationTask(idempotentInput());
  const requestHash =
    mocks.createAsyncImageTask.mock.calls[0]?.[0]?.requestHash;
  if (typeof requestHash !== "string") {
    throw new Error("Expected generation request hash");
  }
  return requestHash;
}
