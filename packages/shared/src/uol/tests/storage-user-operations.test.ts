/**
 * storage 用户面 UOL 操作的 DB-free 安全与资源边界测试。
 *
 * 覆盖头像上传/删除归属、生成对象读取归属、桶白名单、路径穿越，以及
 * readObject 对调用方预算和 provider 流式上限的双重约束。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_READ_HARD_LIMIT_BYTES = 25 * 1024 * 1024;

const storageMocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  getObject: vi.fn(),
  getPlanUploadLimits: vi.fn(),
  getRuntimeSettingString: vi.fn(),
  getSignedUploadUrl: vi.fn(),
  getStorageProvider: vi.fn(),
  getUserPlan: vi.fn(),
}));

vi.mock("../../subscription/services/user-plan", () => ({
  getUserPlan: storageMocks.getUserPlan,
}));

vi.mock("../../subscription/services/upload-limits", () => ({
  getPlanUploadLimits: storageMocks.getPlanUploadLimits,
}));

vi.mock("../../system-settings", () => ({
  getRuntimeSettingString: storageMocks.getRuntimeSettingString,
}));

vi.mock("../../storage/providers/index", () => ({
  getStorageProvider: storageMocks.getStorageProvider,
}));

/** 动态导入注册项与 invoke，使每项测试使用重置后的 UOL registry。 */
async function loadOperation() {
  await import("../operations/storage");
  return await import("../invoke");
}

beforeEach(() => {
  vi.resetModules();
  storageMocks.deleteObject.mockReset().mockResolvedValue(undefined);
  storageMocks.getObject.mockReset().mockResolvedValue(Buffer.from("image"));
  storageMocks.getPlanUploadLimits.mockReset().mockResolvedValue({
    maxFileSizeBytes: 50 * 1024 * 1024,
    maxUploadBytes: 75 * 1024 * 1024,
  });
  storageMocks.getRuntimeSettingString
    .mockReset()
    .mockImplementation(async (key: string) => {
      if (key === "NEXT_PUBLIC_AVATARS_BUCKET_NAME") return "avatars";
      if (key === "NEXT_PUBLIC_GENERATIONS_BUCKET_NAME") {
        return "generations";
      }
      return "";
    });
  storageMocks.getSignedUploadUrl
    .mockReset()
    .mockResolvedValue("https://storage.example/upload");
  storageMocks.getStorageProvider.mockReset().mockResolvedValue({
    deleteObject: storageMocks.deleteObject,
    getObject: storageMocks.getObject,
    getSignedUploadUrl: storageMocks.getSignedUploadUrl,
  });
  storageMocks.getUserPlan.mockReset().mockResolvedValue({ plan: "pro" });
});

describe("storage.readObject", () => {
  it("读取当前用户生成对象并把请求上限下推 provider", async () => {
    const { invokeOperation } = await loadOperation();

    const result = await invokeOperation<{
      data: Uint8Array;
      contentLength: number;
    }>(
      "storage.readObject",
      {
        bucket: "generations",
        key: "user-1/result.png",
        maxBytes: 4096,
      },
      { type: "user", userId: "user-1", role: "user" }
    );

    expect(result.contentLength).toBe(5);
    expect(storageMocks.getObject).toHaveBeenCalledWith(
      "user-1/result.png",
      "generations",
      { maxBytes: 4096 }
    );
  });

  it("未声明预算时使用 25 MiB 服务端硬上限", async () => {
    const { invokeOperation } = await loadOperation();

    await invokeOperation(
      "storage.readObject",
      { bucket: "generations", key: "user-1/result.png" },
      { type: "user", userId: "user-1", role: "user" }
    );

    expect(storageMocks.getObject).toHaveBeenCalledWith(
      "user-1/result.png",
      "generations",
      { maxBytes: STORAGE_READ_HARD_LIMIT_BYTES }
    );
  });

  it("允许读取公开头像桶中的安全对象", async () => {
    const { invokeOperation } = await loadOperation();

    await invokeOperation(
      "storage.readObject",
      { bucket: "avatars", key: "user-2-123.png", maxBytes: 1024 },
      { type: "user", userId: "user-1", role: "user" }
    );

    expect(storageMocks.getObject).toHaveBeenCalledWith(
      "user-2-123.png",
      "avatars",
      { maxBytes: 1024 }
    );
  });

  it("拒绝读取其他用户的生成对象", async () => {
    const { invokeOperation } = await loadOperation();

    await expect(
      invokeOperation(
        "storage.readObject",
        {
          bucket: "generations",
          key: "user-2/result.png",
          maxBytes: 4096,
        },
        { type: "user", userId: "user-1", role: "user" }
      )
    ).rejects.toMatchObject({ code: "ownership_violation", httpStatus: 403 });
    expect(storageMocks.getStorageProvider).not.toHaveBeenCalled();
  });

  it("生成桶只接受 userId/ 目录前缀", async () => {
    const { invokeOperation } = await loadOperation();

    await expect(
      invokeOperation(
        "storage.readObject",
        {
          bucket: "generations",
          key: "user-1-result.png",
          maxBytes: 4096,
        },
        { type: "user", userId: "user-1", role: "user" }
      )
    ).rejects.toMatchObject({ code: "ownership_violation", httpStatus: 403 });
    expect(storageMocks.getStorageProvider).not.toHaveBeenCalled();
  });

  it.each([
    { bucket: "private", key: "user-1/result.png" },
    { bucket: "generations", key: "user-1/../user-2/result.png" },
    { bucket: "generations", key: "user-1\\result.png" },
    { bucket: "generations", key: "/user-1/result.png" },
    { bucket: "generations", key: "user-1/%2e%2e/result.png" },
  ])("拒绝恶意桶或 key：$bucket/$key", async ({ bucket, key }) => {
    const { invokeOperation } = await loadOperation();

    await expect(
      invokeOperation(
        "storage.readObject",
        { bucket, key, maxBytes: 4096 },
        { type: "user", userId: "user-1", role: "user" }
      )
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(forbidden|validation_error)$/),
    });
    expect(storageMocks.getStorageProvider).not.toHaveBeenCalled();
  });

  it("请求超过 25 MiB 硬上限时在 provider 前拒绝", async () => {
    const { invokeOperation } = await loadOperation();

    await expect(
      invokeOperation(
        "storage.readObject",
        {
          bucket: "generations",
          key: "user-1/result.png",
          maxBytes: STORAGE_READ_HARD_LIMIT_BYTES + 1,
        },
        { type: "user", userId: "user-1", role: "user" }
      )
    ).rejects.toMatchObject({ code: "validation_error", httpStatus: 400 });
    expect(storageMocks.getStorageProvider).not.toHaveBeenCalled();
  });

  it("头像桶与生成桶配置重叠时 fail-closed", async () => {
    storageMocks.getRuntimeSettingString.mockImplementation(
      async (key: string) =>
        key.startsWith("NEXT_PUBLIC_") ? "shared-storage" : ""
    );
    const { invokeOperation } = await loadOperation();

    await expect(
      invokeOperation(
        "storage.readObject",
        { bucket: "shared-storage", key: "user-1/result.png" },
        { type: "user", userId: "user-1", role: "user" }
      )
    ).rejects.toMatchObject({ code: "internal_error", httpStatus: 500 });
    expect(storageMocks.getStorageProvider).not.toHaveBeenCalled();
  });

  it("provider 违反读取上限时 fail-closed", async () => {
    storageMocks.getObject.mockResolvedValue(Buffer.alloc(1025));
    const { invokeOperation } = await loadOperation();

    await expect(
      invokeOperation(
        "storage.readObject",
        {
          bucket: "generations",
          key: "user-1/result.png",
          maxBytes: 1024,
        },
        { type: "user", userId: "user-1", role: "user" }
      )
    ).rejects.toMatchObject({ code: "upstream_error", httpStatus: 502 });
  });

  it("provider 返回非字节对象时由 UOL 输出校验 fail-closed", async () => {
    storageMocks.getObject.mockResolvedValue({ length: 5 });
    const { invokeOperation } = await loadOperation();

    await expect(
      invokeOperation(
        "storage.readObject",
        {
          bucket: "generations",
          key: "user-1/result.png",
          maxBytes: 1024,
        },
        { type: "user", userId: "user-1", role: "user" }
      )
    ).rejects.toMatchObject({ code: "internal_error", httpStatus: 500 });
  });
});

describe("storage 用户文件写操作", () => {
  it("只为当前用户头像 key 签发上传 URL", async () => {
    const { invokeOperation } = await loadOperation();

    await invokeOperation(
      "storage.getSignedUploadUrl",
      {
        bucket: "avatars",
        key: "user-1-123.png",
        contentType: "image/png",
      },
      { type: "user", userId: "user-1", role: "user" }
    );

    expect(storageMocks.getSignedUploadUrl).toHaveBeenCalledWith(
      "user-1-123.png",
      "avatars",
      "image/png"
    );
  });

  it("只删除当前用户头像 key", async () => {
    const { invokeOperation } = await loadOperation();

    await invokeOperation(
      "storage.deleteFile",
      { bucket: "avatars", key: "user-1-123.png" },
      { type: "user", userId: "user-1", role: "user" }
    );

    expect(storageMocks.deleteObject).toHaveBeenCalledWith(
      "user-1-123.png",
      "avatars"
    );
  });

  it.each([
    {
      operation: "storage.getSignedUploadUrl",
      input: {
        bucket: "avatars",
        key: "user-2-123.png",
        contentType: "image/png",
      },
    },
    {
      operation: "storage.deleteFile",
      input: { bucket: "avatars", key: "user-2-123.png" },
    },
  ])("$operation 拒绝其他用户 key", async ({ operation, input }) => {
    const { invokeOperation } = await loadOperation();

    await expect(
      invokeOperation(operation, input, {
        type: "user",
        userId: "user-1",
        role: "user",
      })
    ).rejects.toMatchObject({ code: "ownership_violation", httpStatus: 403 });
    expect(storageMocks.getStorageProvider).not.toHaveBeenCalled();
  });

  it.each([
    {
      operation: "storage.getSignedUploadUrl",
      input: {
        bucket: "generations",
        key: "user-1/result.png",
        contentType: "image/png",
      },
    },
    {
      operation: "storage.deleteFile",
      input: { bucket: "generations", key: "user-1/result.png" },
    },
  ])("$operation 拒绝绕过生成桶专用管线", async ({ operation, input }) => {
    const { invokeOperation } = await loadOperation();

    await expect(
      invokeOperation(operation, input, {
        type: "user",
        userId: "user-1",
        role: "user",
      })
    ).rejects.toMatchObject({ code: "forbidden", httpStatus: 403 });
    expect(storageMocks.getStorageProvider).not.toHaveBeenCalled();
  });
});
