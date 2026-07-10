/**
 * 外部异步任务终态保留编排测试。
 *
 * 通过 DB-free 依赖验证严格输入 GC：成功或无输入的任务才进入删除集合，合法对象清理
 * 失败和非法旧载荷任务保留到下一轮，且非法载荷不会触发对象删除。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCandidates: vi.fn(),
  deleteBatch: vi.fn(),
  cleanupGeneration: vi.fn(),
  cleanupEditableStrict: vi.fn(),
  getRuntimeSettingNumber: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@repo/shared/logger", () => ({
  createContextLogger: vi.fn(() => ({ warn: mocks.warn })),
}));

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingNumber: mocks.getRuntimeSettingNumber,
  getRuntimeSettingString: vi.fn(),
}));

vi.mock("./external-async-task-store", () => ({
  listExternalAsyncTaskTerminalRetentionCandidates: mocks.listCandidates,
  deleteExternalAsyncTaskTerminalBatch: mocks.deleteBatch,
}));

vi.mock("./generation-task-input", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./generation-task-input")>()),
  cleanupGenerationTaskInputs: mocks.cleanupGeneration,
}));

vi.mock("./editable-task-input", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./editable-task-input")>()),
  cleanupEditableTaskInputsStrict: mocks.cleanupEditableStrict,
}));

import { runExternalAsyncTaskRetention } from "./external-async-task-retention";

const generationReference = {
  bucket: "generations",
  key: "user-1/async-task-inputs/task-edit/1.png",
  name: "source.png",
  contentType: "image/png",
  size: 4,
  role: "source" as const,
};

const editableReference = {
  bucket: "generations",
  key: "user-1/editable-task-inputs/task-editable/1.png",
  name: "source.png",
  contentType: "image/png",
  size: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRuntimeSettingNumber.mockImplementation(
    async (key: string, fallback: number) =>
      key === "EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE" ? 10 : fallback
  );
  mocks.deleteBatch.mockResolvedValue(2);
  mocks.cleanupEditableStrict.mockResolvedValue(undefined);
  mocks.cleanupGeneration.mockRejectedValue(new Error("storage unavailable"));
  mocks.listCandidates.mockResolvedValue([
    {
      id: "task-generate",
      taskType: "image",
      userId: "user-1",
      requestPayload: {
        kind: "image_generate",
        relayOnly: false,
        generationIds: ["generation-1"],
        createdAtEpochSeconds: 1_788_000_000,
        responseFormat: "url",
        input: { prompt: "mountain", model: "gpt-image-2" },
      },
    },
    {
      id: "task-edit",
      taskType: "image",
      userId: "user-1",
      requestPayload: {
        kind: "image_edit",
        relayOnly: false,
        generationIds: ["generation-2"],
        createdAtEpochSeconds: 1_788_000_000,
        responseFormat: "url",
        input: { prompt: "remove background", model: "gpt-image-2" },
        inputReferences: [generationReference],
      },
    },
    {
      id: "task-editable",
      taskType: "editable_file",
      userId: "user-1",
      requestPayload: {
        prompt: "quarterly report",
        inputReferences: [editableReference],
      },
    },
    {
      id: "task-legacy-invalid",
      taskType: "image",
      userId: "user-1",
      requestPayload: { inputReferences: [generationReference] },
    },
  ]);
});

describe("runExternalAsyncTaskRetention", () => {
  it("对象清理失败或载荷非法时保留任务行，成功和合法无输入任务才交给 CAS 删除", async () => {
    await expect(runExternalAsyncTaskRetention()).resolves.toMatchObject({
      candidateCount: 4,
      cleanupFailedCount: 2,
      deletedCount: 2,
    });

    expect(mocks.cleanupGeneration).toHaveBeenCalledWith({
      userId: "user-1",
      taskId: "task-edit",
      references: [generationReference],
    });
    expect(mocks.cleanupEditableStrict).toHaveBeenCalledWith({
      userId: "user-1",
      taskId: "task-editable",
      references: [editableReference],
    });
    expect(mocks.deleteBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateIds: ["task-generate", "task-editable"],
        batchSize: 10,
      })
    );
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-edit" }),
      "External async task retention input cleanup failed"
    );
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-legacy-invalid" }),
      "External async task retention input cleanup failed"
    );
  });

  it("可编辑任务严格对象清理失败时同样保留数据库行", async () => {
    mocks.listCandidates.mockResolvedValue([
      {
        id: "task-editable",
        taskType: "editable_file",
        userId: "user-1",
        requestPayload: {
          prompt: "quarterly report",
          inputReferences: [editableReference],
        },
      },
    ]);
    mocks.cleanupEditableStrict.mockRejectedValue(
      new Error("editable cleanup unavailable")
    );
    mocks.deleteBatch.mockResolvedValue(0);

    await expect(runExternalAsyncTaskRetention()).resolves.toMatchObject({
      candidateCount: 1,
      cleanupFailedCount: 1,
      deletedCount: 0,
    });
    expect(mocks.deleteBatch).toHaveBeenCalledWith(
      expect.objectContaining({ candidateIds: [] })
    );
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-editable" }),
      "External async task retention input cleanup failed"
    );
  });
});
