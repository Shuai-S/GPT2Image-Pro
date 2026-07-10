/**
 * storage.createDirectUpload UOL 契约测试。
 *
 * mock 套餐、运行时设置与 provider，覆盖会话/API Key 身份、套餐上限、local 降级和
 * 类型白名单；验证所有外部传输都必须经 invokeOperation 的输入/输出与权限网关。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getUserPlan: vi.fn(),
  getPlanUploadLimits: vi.fn(),
  getRuntimeSettingString: vi.fn(),
  getSignedUploadUrl: vi.fn(),
  getStorageProvider: vi.fn(),
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

/** 动态导入注册项与 invoke，确保每个测试共享同一份重置后的 registry。 */
async function loadOperation() {
  await import("../operations/storage");
  return await import("../invoke");
}

beforeEach(() => {
  vi.resetModules();
  storageMocks.getUserPlan.mockReset().mockResolvedValue({ plan: "pro" });
  storageMocks.getPlanUploadLimits.mockReset().mockResolvedValue({
    maxFileSizeBytes: 50 * 1024 * 1024,
    maxUploadBytes: 75 * 1024 * 1024,
  });
  storageMocks.getRuntimeSettingString.mockReset().mockImplementation(
    async (key: string) => {
      if (key === "STORAGE_ENDPOINT") return "https://storage.example";
      if (key === "NEXT_PUBLIC_GENERATIONS_BUCKET_NAME") {
        return "generations";
      }
      return "";
    }
  );
  storageMocks.getSignedUploadUrl
    .mockReset()
    .mockResolvedValue("https://storage.example/signed-put");
  storageMocks.getStorageProvider.mockReset().mockResolvedValue({
    getSignedUploadUrl: storageMocks.getSignedUploadUrl,
  });
});

describe("storage.createDirectUpload", () => {
  it("从会话 Principal 派生套餐与用户隔离 key", async () => {
    const { invokeOperation } = await loadOperation();

    const result = await invokeOperation<{
      uploadUrl: string;
      uploadContentType: string;
      reference: { bucket: string; key: string; purpose: string };
    }>(
      "storage.createDirectUpload",
      {
        purpose: "image-source",
        filename: "draft.png",
        contentType: "image/png",
        contentLength: 4096,
      },
      { type: "user", userId: "user-1", role: "user" }
    );

    expect(storageMocks.getUserPlan).toHaveBeenCalledWith("user-1");
    expect(storageMocks.getPlanUploadLimits).toHaveBeenCalledWith("pro");
    expect(result).toMatchObject({
      uploadUrl: "https://storage.example/signed-put",
      uploadContentType: "image/png",
      reference: { bucket: "generations", purpose: "image-source" },
    });
    expect(result.reference.key).toMatch(
      /^user-1\/requests\/image-source\/[A-Za-z0-9_-]+\.png$/
    );
    expect(storageMocks.getSignedUploadUrl).toHaveBeenCalledWith(
      result.reference.key,
      "generations",
      "image/png",
      600
    );
  });

  it("API Key 使用 Principal 套餐且不重复查询用户套餐", async () => {
    const { invokeOperation } = await loadOperation();

    await invokeOperation(
      "storage.createDirectUpload",
      {
        purpose: "chat-attachment",
        filename: "context.ts",
        contentType: "",
        contentLength: 100,
      },
      {
        type: "apiKey",
        userId: "user-2",
        apiKeyId: "key-1",
        plan: "enterprise",
        relayOnly: false,
      }
    );

    expect(storageMocks.getUserPlan).not.toHaveBeenCalled();
    expect(storageMocks.getPlanUploadLimits).toHaveBeenCalledWith("enterprise");
    expect(storageMocks.getSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^user-2\/requests\/chat-attachment\//),
      "generations",
      "application/octet-stream",
      600
    );
  });

  it("声明大小超过套餐上限时在签名前返回 413", async () => {
    storageMocks.getPlanUploadLimits.mockResolvedValue({
      maxFileSizeBytes: 1024,
      maxUploadBytes: 2048,
    });
    const { invokeOperation } = await loadOperation();

    await expect(
      invokeOperation(
        "storage.createDirectUpload",
        {
          purpose: "image-source",
          filename: "large.png",
          contentType: "image/png",
          contentLength: 1025,
        },
        { type: "user", userId: "user-1", role: "user" }
      )
    ).rejects.toMatchObject({
      code: "validation_error",
      httpStatus: 413,
    });
    expect(storageMocks.getStorageProvider).not.toHaveBeenCalled();
  });

  it("local 存储明确返回 not_implemented 且不生成伪 PUT URL", async () => {
    storageMocks.getRuntimeSettingString.mockResolvedValue("");
    const { invokeOperation } = await loadOperation();

    await expect(
      invokeOperation(
        "storage.createDirectUpload",
        {
          purpose: "document",
          filename: "notes.txt",
          contentType: "text/plain",
          contentLength: 20,
        },
        { type: "user", userId: "user-1", role: "user" }
      )
    ).rejects.toMatchObject({ code: "not_implemented", httpStatus: 501 });
    expect(storageMocks.getStorageProvider).not.toHaveBeenCalled();
  });

  it("非法用途 MIME 返回 validation_error", async () => {
    const { invokeOperation } = await loadOperation();

    await expect(
      invokeOperation(
        "storage.createDirectUpload",
        {
          purpose: "image-mask",
          filename: "mask.jpg",
          contentType: "image/jpeg",
          contentLength: 20,
        },
        { type: "user", userId: "user-1", role: "user" }
      )
    ).rejects.toMatchObject({ code: "validation_error", httpStatus: 400 });
    expect(storageMocks.getStorageProvider).not.toHaveBeenCalled();
  });
});
