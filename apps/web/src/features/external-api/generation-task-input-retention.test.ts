/**
 * 普通 generation 任务输入严格清理测试。
 *
 * 验证 retention 在任何对象删除前校验完整引用集合，并将对象删除失败显式上抛，
 * 使数据库任务行保留到下一轮重试。
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

import { cleanupGenerationTaskInputsStrict } from "./generation-task-input";

const reference = {
  bucket: "generations",
  key: "user-1/async-task-inputs/task-1/1.png",
  name: "source.png",
  contentType: "image/png",
  size: 4,
  role: "source" as const,
};

beforeEach(() => {
  storageMocks.deleteObject.mockReset().mockResolvedValue(undefined);
});

describe("cleanupGenerationTaskInputsStrict", () => {
  it("对象删除失败时抛错供 retention 保留任务行", async () => {
    storageMocks.deleteObject.mockRejectedValue(new Error("delete failed"));

    await expect(
      cleanupGenerationTaskInputsStrict({
        userId: "user-1",
        taskId: "task-1",
        references: [reference],
      })
    ).rejects.toThrow("Failed to delete 1 generation task input object(s)");
  });

  it("完整集合含越权引用时不删除其中任何对象", async () => {
    await expect(
      cleanupGenerationTaskInputsStrict({
        userId: "user-1",
        taskId: "task-1",
        references: [
          reference,
          {
            ...reference,
            key: "user-2/async-task-inputs/task-1/2.png",
          },
        ],
      })
    ).rejects.toThrow("Invalid generation task input reference");
    expect(storageMocks.deleteObject).not.toHaveBeenCalled();
  });
});
