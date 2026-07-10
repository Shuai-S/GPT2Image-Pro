/**
 * 可编辑任务输入严格清理测试。
 *
 * 验证 retention 使用的严格入口会汇总合法对象删除失败，同时仍忽略越权引用；不访问
 * 真实对象存储。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({ deleteObject: vi.fn() }));

vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(async () => ({
    deleteObject: storageMocks.deleteObject,
  })),
}));
vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: vi.fn(),
}));

import { cleanupEditableTaskInputsStrict } from "./editable-task-input";

const reference = {
  bucket: "generations",
  key: "user-1/editable-task-inputs/task-1/1.png",
  name: "source.png",
  contentType: "image/png",
  size: 4,
};

beforeEach(() => {
  storageMocks.deleteObject.mockReset();
  storageMocks.deleteObject.mockResolvedValue(undefined);
});

describe("cleanupEditableTaskInputsStrict", () => {
  it("合法对象删除失败时抛错供 retention 保留任务行", async () => {
    storageMocks.deleteObject.mockRejectedValue(new Error("delete failed"));
    await expect(
      cleanupEditableTaskInputsStrict({
        userId: "user-1",
        taskId: "task-1",
        references: [reference],
      })
    ).rejects.toThrow("Failed to delete 1 editable task input object(s)");
  });

  it("越权前缀不会触发任意对象删除", async () => {
    await expect(
      cleanupEditableTaskInputsStrict({
        userId: "user-1",
        taskId: "task-1",
        references: [
          {
            ...reference,
            key: "user-2/editable-task-inputs/task-1/1.png",
          },
        ],
      })
    ).resolves.toBeUndefined();
    expect(storageMocks.deleteObject).not.toHaveBeenCalled();
  });
});
