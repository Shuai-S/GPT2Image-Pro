/**
 * 创作页直传客户端测试。
 *
 * mock fetch 覆盖授权、无凭据 PUT、WeakMap 复用与 local/CORS multipart 回退；不依赖
 * 浏览器或真实 S3，确保控制请求不会意外携带文件正文或站内 Cookie。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectUploadAuthorization } from "@repo/shared/storage/direct-upload";
import { appendDirectUploadsOrFiles } from "./direct-upload-client";

/** 构造与指定 File 匹配的合法授权响应。 */
function authorizationFor(file: File): DirectUploadAuthorization {
  return {
    uploadUrl: "https://storage.example/signed-put",
    uploadContentType: file.type,
    expiresIn: 600,
    reference: {
      bucket: "generations",
      key: "user-1/requests/image-source/random.png",
      filename: file.name,
      contentType: file.type,
      contentLength: file.size,
      purpose: "image-source",
    },
  };
}

/** 把源图授权改为蒙版用途，模拟服务端提交后删除的临时对象。 */
function maskAuthorizationFor(file: File): DirectUploadAuthorization {
  const authorization = authorizationFor(file);
  return {
    ...authorization,
    reference: {
      ...authorization.reference,
      key: "user-1/requests/image-mask/random.png",
      purpose: "image-mask",
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("appendDirectUploadsOrFiles", () => {
  it("授权成功时 PUT 不携带凭据且控制表单只含引用", async () => {
    const file = new File([Uint8Array.from([1, 2])], "source.png", {
      type: "image/png",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(authorizationFor(file)))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const formData = new FormData();

    await expect(
      appendDirectUploadsOrFiles({
        formData,
        files: [file],
        purpose: "image-source",
        referenceField: "image_refs",
        fileField: () => "image",
      })
    ).resolves.toBe("direct");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/upload/presigned",
      expect.objectContaining({ credentials: "same-origin", method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://storage.example/signed-put",
      expect.objectContaining({
        credentials: "omit",
        method: "PUT",
        body: file,
        headers: { "Content-Type": "image/png" },
      })
    );
    expect(formData.getAll("image")).toEqual([]);
    expect(JSON.parse(String(formData.get("image_refs")))).toEqual([
      authorizationFor(file).reference,
    ]);
  });

  it("同一 File 和用途复用已完成的直传", async () => {
    const file = new File([Uint8Array.from([1])], "source.png", {
      type: "image/png",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(authorizationFor(file)))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    for (let index = 0; index < 2; index++) {
      await appendDirectUploadsOrFiles({
        formData: new FormData(),
        files: [file],
        purpose: "image-source",
        referenceField: "image_refs",
        fileField: () => "image",
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("蒙版对象不缓存，重复提交会重新上传", async () => {
    const file = new File([Uint8Array.from([1])], "mask.png", {
      type: "image/png",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(maskAuthorizationFor(file)))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json(maskAuthorizationFor(file)))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    for (let index = 0; index < 2; index++) {
      await appendDirectUploadsOrFiles({
        formData: new FormData(),
        files: [file],
        purpose: "image-mask",
        referenceField: "mask_refs",
        fileField: () => "mask",
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([501, 503])("授权端点返回 %s 时回退 multipart", async (status) => {
    const file = new File([Uint8Array.from([1])], "source.png", {
      type: "image/png",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status })
    );
    const formData = new FormData();

    await expect(
      appendDirectUploadsOrFiles({
        formData,
        files: [file],
        purpose: "image-source",
        referenceField: "image_refs",
        fileField: () => "image",
      })
    ).resolves.toBe("multipart");
    expect(formData.get("image")).toBe(file);
    expect(formData.has("image_refs")).toBe(false);
  });

  it("对象存储 PUT 失败时回退 multipart", async () => {
    const file = new File([Uint8Array.from([1])], "source.png", {
      type: "image/png",
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(authorizationFor(file)))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const formData = new FormData();

    await expect(
      appendDirectUploadsOrFiles({
        formData,
        files: [file],
        purpose: "image-source",
        referenceField: "image_refs",
        fileField: () => "image",
      })
    ).resolves.toBe("multipart");
    expect(formData.get("image")).toBe(file);
  });

  it("非法授权响应 fail-closed，不上传也不回退", async () => {
    const file = new File([Uint8Array.from([1])], "source.png", {
      type: "image/png",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        ...authorizationFor(file),
        uploadUrl: "javascript:alert(1)",
      })
    );

    await expect(
      appendDirectUploadsOrFiles({
        formData: new FormData(),
        files: [file],
        purpose: "image-source",
        referenceField: "image_refs",
        fileField: () => "image",
      })
    ).rejects.toThrow("invalid response");
  });
});
