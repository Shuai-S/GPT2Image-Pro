/**
 * 可编辑文件持久任务幂等服务测试。
 *
 * 使用 DB-free store/storage mock 覆盖首次入队、同内容重放、异内容冲突与并发唯一
 * 冲突 winner 收敛，确保 clientRequestId 不会重复执行或清理其他 worker 的输入。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExternalAsyncTask: vi.fn(),
  findEditableTaskByClientRequest: vi.fn(),
  cleanupEditableTaskInputs: vi.fn(),
  decodeEditableTaskImages: vi.fn(),
  hashEditableTaskRequest: vi.fn(),
  storeEditableTaskImages: vi.fn(),
}));

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
}));

vi.mock("./external-async-task-store", () => ({
  createExternalAsyncTask: mocks.createExternalAsyncTask,
  findEditableTaskByClientRequest: mocks.findEditableTaskByClientRequest,
}));

vi.mock("./editable-task-input", () => ({
  cleanupEditableTaskInputs: mocks.cleanupEditableTaskInputs,
  decodeEditableTaskImages: mocks.decodeEditableTaskImages,
  hashEditableTaskRequest: mocks.hashEditableTaskRequest,
  storeEditableTaskImages: mocks.storeEditableTaskImages,
}));

import {
  EditableTaskConflictError,
  enqueueEditableFileTask,
} from "./editable-task-service";

const storedReference = {
  bucket: "generations",
  key: "user-1/editable-task-inputs/task-1/1.png",
  name: "input.png",
  contentType: "image/png",
  size: 4,
};

const existingRow = {
  id: "task-existing",
  status: "running",
  requestHash: "request-hash-1",
  createdAt: new Date("2026-07-10T00:00:00.000Z"),
};

const enqueueInput = {
  userId: "user-1",
  apiKeyId: "key-1",
  kind: "ppt" as const,
  clientRequestId: " client-request-1 ",
  prompt: " quarterly report ",
  base64Images: ["aW1hZ2U="],
  callbackUrl: "https://example.com/callback",
  priority: "highest" as const,
  userConcurrency: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decodeEditableTaskImages.mockReturnValue([
    {
      data: Buffer.from("data"),
      name: "input.png",
      type: "image/png",
    },
  ]);
  mocks.hashEditableTaskRequest.mockReturnValue("request-hash-1");
  mocks.storeEditableTaskImages.mockResolvedValue([storedReference]);
  mocks.cleanupEditableTaskInputs.mockResolvedValue(undefined);
  mocks.findEditableTaskByClientRequest.mockResolvedValue(undefined);
  mocks.createExternalAsyncTask.mockResolvedValue({
    id: "task_00000000000040008000000000000001",
    createdAt: new Date("2026-07-10T00:01:00.000Z"),
  });
});

describe("enqueueEditableFileTask", () => {
  it("首次请求先保存受控输入引用再写 queued 任务", async () => {
    await expect(enqueueEditableFileTask(enqueueInput)).resolves.toEqual({
      taskId: "task_00000000000040008000000000000001",
      status: "queued",
      kind: "ppt",
      createdAt: "2026-07-10T00:01:00.000Z",
    });
    expect(mocks.hashEditableTaskRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "ppt",
        prompt: "quarterly report",
      })
    );
    expect(mocks.createExternalAsyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        apiKeyId: "key-1",
        clientRequestId: "client-request-1",
        requestHash: "request-hash-1",
        status: "queued",
        priority: 2,
        userConcurrency: 3,
        requestPayload: {
          prompt: "quarterly report",
          inputReferences: [storedReference],
        },
      })
    );
  });

  it("同一 clientRequestId 和内容重放直接返回已有任务", async () => {
    mocks.findEditableTaskByClientRequest.mockResolvedValue(existingRow);

    await expect(enqueueEditableFileTask(enqueueInput)).resolves.toEqual({
      taskId: "task-existing",
      status: "running",
      kind: "ppt",
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    expect(mocks.storeEditableTaskImages).not.toHaveBeenCalled();
    expect(mocks.createExternalAsyncTask).not.toHaveBeenCalled();
  });

  it("同一 clientRequestId 但内容不同返回幂等冲突", async () => {
    mocks.findEditableTaskByClientRequest.mockResolvedValue({
      ...existingRow,
      requestHash: "different-hash",
    });

    await expect(enqueueEditableFileTask(enqueueInput)).rejects.toBeInstanceOf(
      EditableTaskConflictError
    );
    expect(mocks.storeEditableTaskImages).not.toHaveBeenCalled();
  });

  it("并发插入唯一冲突时清理 loser 输入并返回同内容 winner", async () => {
    mocks.createExternalAsyncTask.mockRejectedValueOnce(
      new Error("unique constraint violation")
    );
    mocks.findEditableTaskByClientRequest
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(existingRow);

    await expect(enqueueEditableFileTask(enqueueInput)).resolves.toEqual({
      taskId: "task-existing",
      status: "running",
      kind: "ppt",
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    expect(mocks.cleanupEditableTaskInputs).toHaveBeenCalledWith({
      userId: "user-1",
      taskId: "task_00000000000040008000000000000001",
      references: [storedReference],
    });
  });

  it("插入失败且没有 winner 时清理输入并保留原错误", async () => {
    const databaseError = new Error("database unavailable");
    mocks.createExternalAsyncTask.mockRejectedValueOnce(databaseError);

    await expect(enqueueEditableFileTask(enqueueInput)).rejects.toBe(
      databaseError
    );
    expect(mocks.cleanupEditableTaskInputs).toHaveBeenCalledOnce();
  });
});
