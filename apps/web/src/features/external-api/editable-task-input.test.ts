/**
 * 可编辑文件持久任务输入对象边界测试。
 *
 * 使用方：PPT/PSD worker。DB-free storage mock 锁定 provider 读取上限和声明大小复核，
 * 防止对象在入队后被替换为超大正文。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => ({ getObject: vi.fn() }));

vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(async () => storageMock),
}));
vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: vi.fn(async () => "generations"),
}));

import { loadEditableTaskImages } from "./editable-task-input";

const reference = {
  bucket: "generations",
  key: "user-1/editable-task-inputs/task-1/1.png",
  name: "source.png",
  contentType: "image/png",
  size: 4,
};

describe("loadEditableTaskImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getObject.mockResolvedValue(Buffer.from("data"));
  });

  it("把声明大小加一作为 provider 读取上限并恢复图片", async () => {
    await expect(
      loadEditableTaskImages({
        userId: "user-1",
        taskId: "task-1",
        references: [reference],
      })
    ).resolves.toEqual([
      {
        data: Buffer.from("data"),
        name: "source.png",
        type: "image/png",
      },
    ]);
    expect(storageMock.getObject).toHaveBeenCalledWith(
      reference.key,
      reference.bucket,
      { maxBytes: 5 }
    );
  });

  it("对象实际大小与持久引用不一致时 fail-closed", async () => {
    storageMock.getObject.mockResolvedValue(Buffer.from("changed"));
    await expect(
      loadEditableTaskImages({
        userId: "user-1",
        taskId: "task-1",
        references: [reference],
      })
    ).rejects.toThrow("exceeds 25 MiB");
  });
});
