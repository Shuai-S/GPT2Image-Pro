import { describe, expect, it, vi } from "vitest";

import { downloadWebHistoryImageReference } from "./web-history-references";

// 守护审计 S-H2：客户端提交的历史 storage 引用越权/IDOR 防护。
describe("downloadWebHistoryImageReference storage 引用校验", () => {
  const baseRef = (imageUrl: string) => ({
    imageUrl,
    fileName: "web-history-assistant-1",
    sourceId: imageUrl,
  });

  it("拒绝非 generations 桶（封堵跨桶任意读）", async () => {
    const readStorageImage = vi.fn();
    await expect(
      downloadWebHistoryImageReference(
        baseRef("/api/storage/avatars/victim/secret.png"),
        { readStorageImage }
      )
    ).rejects.toThrow(/bucket is not allowed/);
    expect(readStorageImage).not.toHaveBeenCalled();
  });

  it("拒绝路径穿越的 key", async () => {
    const readStorageImage = vi.fn();
    await expect(
      downloadWebHistoryImageReference(
        baseRef("/api/storage/generations/..%2f..%2fsecret/key.png"),
        { readStorageImage }
      )
    ).rejects.toThrow(/key is not allowed/);
    expect(readStorageImage).not.toHaveBeenCalled();
  });

  it("允许 generations 桶下的合法 key", async () => {
    const readStorageImage = vi
      .fn()
      .mockResolvedValue(Buffer.from("img-bytes"));
    const file = await downloadWebHistoryImageReference(
      baseRef("/api/storage/generations/user-123/abc123.png"),
      { readStorageImage }
    );
    expect(readStorageImage).toHaveBeenCalledTimes(1);
    expect(file.type).toBe("image/png");
    expect(file.data.toString()).toBe("img-bytes");
  });
});
