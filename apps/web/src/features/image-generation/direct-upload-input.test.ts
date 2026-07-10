/**
 * 生图直传引用加载测试。
 *
 * mock provider 与运行时桶设置，覆盖控制字段解析、IDOR 拒绝、套餐总量、有限读取参数
 * 和声明/实际大小不一致；不访问数据库或真实对象存储。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectUploadReference } from "@repo/shared/storage/direct-upload";

const inputMocks = vi.hoisted(() => ({
  getObject: vi.fn(),
  getSignedUrl: vi.fn(),
  getStorageProvider: vi.fn(),
  getRuntimeSettingString: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: inputMocks.getStorageProvider,
}));

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: inputMocks.getRuntimeSettingString,
}));

vi.mock("@repo/shared/logger", () => ({ logWarn: inputMocks.logWarn }));

import {
  loadDirectUploadedInputs,
  parseDirectUploadReferences,
} from "./direct-upload-input";

/** 构造当前用户的合法源图引用。 */
function sourceReference(
  overrides: Partial<DirectUploadReference> = {}
): DirectUploadReference {
  return {
    bucket: "generations",
    key: "user-1/requests/image-source/source.png",
    filename: "source.png",
    contentType: "image/png",
    contentLength: 4,
    purpose: "image-source",
    ...overrides,
  };
}

beforeEach(() => {
  inputMocks.getObject.mockReset().mockResolvedValue(Buffer.from([1, 2, 3, 4]));
  inputMocks.getSignedUrl
    .mockReset()
    .mockResolvedValue("https://storage.example/read");
  inputMocks.getStorageProvider.mockReset().mockResolvedValue({
    getObject: inputMocks.getObject,
    getSignedUrl: inputMocks.getSignedUrl,
  });
  inputMocks.getRuntimeSettingString
    .mockReset()
    .mockResolvedValue("generations");
  inputMocks.logWarn.mockReset();
});

describe("parseDirectUploadReferences", () => {
  it("解析单个 JSON 数组字段", () => {
    const formData = new FormData();
    formData.set("image_refs", JSON.stringify([sourceReference()]));

    expect(parseDirectUploadReferences(formData, "image_refs", 2)).toEqual([
      sourceReference(),
    ]);
  });

  it("拒绝重复字段、非法 JSON 和超出数量上限", () => {
    const duplicate = new FormData();
    duplicate.append("image_refs", "[]");
    duplicate.append("image_refs", "[]");
    expect(() =>
      parseDirectUploadReferences(duplicate, "image_refs", 2)
    ).toThrow("Invalid image_refs");

    const malformed = new FormData();
    malformed.set("image_refs", "{");
    expect(() =>
      parseDirectUploadReferences(malformed, "image_refs", 2)
    ).toThrow("image_refs must be valid JSON");

    const excessive = new FormData();
    excessive.set(
      "image_refs",
      JSON.stringify([sourceReference(), sourceReference()])
    );
    expect(() =>
      parseDirectUploadReferences(excessive, "image_refs", 1)
    ).toThrow("Invalid image_refs");
  });
});

describe("loadDirectUploadedInputs", () => {
  it("在剩余总量内有限读取并构造管线输入", async () => {
    const loaded = await loadDirectUploadedInputs({
      userId: "user-1",
      purpose: "image-source",
      references: [sourceReference()],
      maxFileSizeBytes: 8,
      maxTotalBytes: 10,
      existingBytes: 2,
    });

    expect(inputMocks.getObject).toHaveBeenCalledWith(
      sourceReference().key,
      "generations",
      { maxBytes: 8 }
    );
    expect(inputMocks.getSignedUrl).toHaveBeenCalledWith(
      sourceReference().key,
      "generations",
      900
    );
    expect(loaded.totalBytes).toBe(4);
    expect(loaded.imageInputs[0]).toMatchObject({
      name: "source.png",
      type: "image/png",
      storageBucket: "generations",
      storageKey: sourceReference().key,
      url: "https://storage.example/read",
    });
  });

  it("归属或声明总量非法时不访问 provider", async () => {
    await expect(
      loadDirectUploadedInputs({
        userId: "user-1",
        purpose: "image-source",
        references: [
          sourceReference({
            key: "user-10/requests/image-source/source.png",
          }),
        ],
        maxFileSizeBytes: 8,
        maxTotalBytes: 10,
      })
    ).rejects.toThrow("Direct upload reference is not owned");
    await expect(
      loadDirectUploadedInputs({
        userId: "user-1",
        purpose: "image-source",
        references: [sourceReference({ contentLength: 9 })],
        maxFileSizeBytes: 10,
        maxTotalBytes: 10,
        existingBytes: 2,
      })
    ).rejects.toThrow("Direct uploads exceed the request size limit");
    expect(inputMocks.getStorageProvider).not.toHaveBeenCalled();
  });

  it("实际对象大小与授权不一致时 fail-closed", async () => {
    inputMocks.getObject.mockResolvedValue(Buffer.from([1, 2, 3]));

    await expect(
      loadDirectUploadedInputs({
        userId: "user-1",
        purpose: "image-source",
        references: [sourceReference()],
        maxFileSizeBytes: 8,
        maxTotalBytes: 10,
      })
    ).rejects.toThrow(
      "Direct upload object size does not match its authorization"
    );
  });

  it("provider 错误被固定文案包装且不泄露详情", async () => {
    inputMocks.getObject.mockRejectedValue(
      new Error("s3://secret-bucket/internal credential")
    );

    await expect(
      loadDirectUploadedInputs({
        userId: "user-1",
        purpose: "image-source",
        references: [sourceReference()],
        maxFileSizeBytes: 8,
        maxTotalBytes: 10,
      })
    ).rejects.toThrow("Failed to read direct upload object");
    expect(JSON.stringify(inputMocks.logWarn.mock.calls)).not.toContain(
      "secret-bucket"
    );
  });
});
