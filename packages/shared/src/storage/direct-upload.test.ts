/**
 * 用户直传纯契约测试。
 *
 * 覆盖用途 MIME 白名单、文件名净化、用户隔离 key 和稳定引用归属校验；测试不访问
 * 数据库或对象存储，确保安全边界可在 shared 的 DB-free Vitest 中回归。
 */

import { describe, expect, it } from "vitest";
import {
  assertDirectUploadReference,
  createDirectUploadKey,
  DirectUploadInputError,
  resolveDirectUploadMetadata,
  type DirectUploadReference,
} from "./direct-upload";

/** 构造归属 user-1 的合法源图引用，供各负向用例覆写单一字段。 */
function sourceReference(
  overrides: Partial<DirectUploadReference> = {}
): DirectUploadReference {
  return {
    bucket: "generations",
    key: "user-1/requests/image-source/random.png",
    filename: "source.png",
    contentType: "image/png",
    contentLength: 1024,
    purpose: "image-source",
    ...overrides,
  };
}

describe("resolveDirectUploadMetadata", () => {
  it("按图片 MIME 派生扩展名并净化展示文件名", () => {
    expect(
      resolveDirectUploadMetadata({
        purpose: "image-source",
        filename: "../draft.JPG",
        contentType: "IMAGE/JPEG",
      })
    ).toEqual({
      filename: ".._draft.JPG",
      contentType: "image/jpeg",
      uploadContentType: "image/jpeg",
      storageExtension: "jpg",
    });
  });

  it("蒙版只接受 PNG", () => {
    expect(() =>
      resolveDirectUploadMetadata({
        purpose: "image-mask",
        filename: "mask.webp",
        contentType: "image/webp",
      })
    ).toThrow("Mask must be a PNG file");
  });

  it("文本代码与 PDF 附件以 octet-stream 存储", () => {
    expect(
      resolveDirectUploadMetadata({
        purpose: "chat-attachment",
        filename: "config.ts",
        contentType: "",
      })
    ).toMatchObject({
      contentType: "text/plain",
      uploadContentType: "application/octet-stream",
      storageExtension: "bin",
    });
    expect(
      resolveDirectUploadMetadata({
        purpose: "chat-attachment",
        filename: "report.pdf",
        contentType: "application/octet-stream",
      })
    ).toMatchObject({ contentType: "application/pdf" });
  });

  it("文档 MIME 只从扩展名派生", () => {
    expect(
      resolveDirectUploadMetadata({
        purpose: "document",
        filename: "notes.md",
        contentType: "text/html",
      })
    ).toMatchObject({
      contentType: "text/markdown",
      uploadContentType: "application/octet-stream",
    });
    expect(() =>
      resolveDirectUploadMetadata({
        purpose: "document",
        filename: "payload.svg",
        contentType: "image/svg+xml",
      })
    ).toThrow("Unsupported document type");
  });
});

describe("createDirectUploadKey", () => {
  it("编码用户 ID 并隔离用途目录", () => {
    const key = createDirectUploadKey("tenant/user", "image-source", "png");

    expect(key).toMatch(
      /^tenant%2Fuser\/requests\/image-source\/[A-Za-z0-9_-]+\.png$/
    );
  });
});

describe("assertDirectUploadReference", () => {
  it("接受同用户、同桶、同用途且在套餐上限内的引用", () => {
    expect(
      assertDirectUploadReference({
        reference: sourceReference(),
        userId: "user-1",
        bucket: "generations",
        purpose: "image-source",
        maxFileSizeBytes: 2048,
      })
    ).toEqual(sourceReference());
  });

  it.each([
    ["其他用户前缀", { key: "user-10/requests/image-source/a.png" }],
    ["其他存储桶", { bucket: "avatars" }],
    ["其他用途", { purpose: "image-mask" as const }],
    ["路径穿越", { key: "user-1/requests/image-source/../a.png" }],
  ])("拒绝%s", (_label, overrides) => {
    expect(() =>
      assertDirectUploadReference({
        reference: sourceReference(overrides),
        userId: "user-1",
        bucket: "generations",
        purpose: "image-source",
        maxFileSizeBytes: 2048,
      })
    ).toThrow(DirectUploadInputError);
  });

  it("拒绝声明大小超过套餐限制或 MIME 被篡改", () => {
    expect(() =>
      assertDirectUploadReference({
        reference: sourceReference({ contentLength: 4096 }),
        userId: "user-1",
        bucket: "generations",
        purpose: "image-source",
        maxFileSizeBytes: 2048,
      })
    ).toThrow("Direct upload exceeds the plan limit");
    expect(() =>
      assertDirectUploadReference({
        reference: sourceReference({ contentType: "image/gif" }),
        userId: "user-1",
        bucket: "generations",
        purpose: "image-source",
        maxFileSizeBytes: 2048,
      })
    ).toThrow("Source images must be PNG, JPEG, or WebP files");
  });
});
