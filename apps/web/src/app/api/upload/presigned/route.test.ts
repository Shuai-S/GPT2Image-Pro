/**
 * 直传 HTTP 适配器测试。
 *
 * mock 会话与 invokeOperation，验证未认证短路、新旧字段归一、Principal 构造和 UOL
 * 错误状态编码；套餐、key 与 provider 安全规则由 shared 操作测试覆盖。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const routeMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  invokeOperation: vi.fn(),
}));

vi.mock("@repo/shared/api-logger", () => ({
  withApiLogging: <T>(handler: T) => handler,
}));

vi.mock("@repo/shared/auth", () => ({
  auth: { api: { getSession: routeMocks.getSession } },
}));

vi.mock("@repo/shared/uol/operations/storage", () => ({}));

vi.mock("@repo/shared/uol", async () => {
  const actual = await vi.importActual<typeof import("@repo/shared/uol")>(
    "@repo/shared/uol"
  );
  return { ...actual, invokeOperation: routeMocks.invokeOperation };
});

import { OperationError } from "@repo/shared/uol";
import { POST } from "./route";

/** 构造 JSON 直传请求。 */
function uploadRequest(body: unknown): NextRequest {
  return new NextRequest("https://example.com/api/upload/presigned", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": "request-1",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  routeMocks.getSession.mockReset().mockResolvedValue({
    user: { id: "user-1", role: "bogus-role" },
  });
  routeMocks.invokeOperation.mockReset().mockResolvedValue({
    uploadUrl: "https://storage.example/put",
    uploadContentType: "image/png",
    expiresIn: 600,
    reference: {
      bucket: "generations",
      key: "user-1/requests/image-source/random.png",
      filename: "source.png",
      contentType: "image/png",
      contentLength: 10,
      purpose: "image-source",
    },
  });
});

describe("POST /api/upload/presigned", () => {
  it("未认证时返回 401 且不调用 UOL", async () => {
    routeMocks.getSession.mockResolvedValue(null);

    const response = await POST(uploadRequest({}));

    expect(response.status).toBe(401);
    expect(routeMocks.invokeOperation).not.toHaveBeenCalled();
  });

  it("把新字段和会话身份交给统一操作层", async () => {
    const response = await POST(
      uploadRequest({
        purpose: "image-source",
        filename: "source.png",
        contentType: "image/png",
        contentLength: 10,
        bucket: "attacker-controlled",
        key: "attacker-controlled",
      })
    );

    expect(response.status).toBe(200);
    expect(routeMocks.invokeOperation).toHaveBeenCalledWith(
      "storage.createDirectUpload",
      {
        purpose: "image-source",
        filename: "source.png",
        contentType: "image/png",
        contentLength: 10,
      },
      { type: "user", userId: "user-1", role: "user" },
      { requestId: "request-1" }
    );
    await expect(response.json()).resolves.toMatchObject({
      uploadUrl: "https://storage.example/put",
      presignedUrl: "https://storage.example/put",
      fileKey: "user-1/requests/image-source/random.png",
    });
  });

  it("兼容旧 fileSize 字段并默认 document 用途", async () => {
    await POST(
      uploadRequest({
        filename: "notes.txt",
        contentType: "text/plain",
        fileSize: 20,
      })
    );

    expect(routeMocks.invokeOperation).toHaveBeenCalledWith(
      "storage.createDirectUpload",
      expect.objectContaining({ purpose: "document", contentLength: 20 }),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it("按 UOL 错误状态和稳定错误码编码响应", async () => {
    routeMocks.invokeOperation.mockRejectedValue(
      new OperationError(
        "not_implemented",
        "Direct upload requires S3-compatible storage",
        undefined,
        501
      )
    );

    const response = await POST(uploadRequest({ filename: "a.txt" }));

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "Direct upload requires S3-compatible storage",
      code: "not_implemented",
    });
  });
});
