/**
 * 无限画布图生图直传接线测试。
 *
 * mock 共享预上传器与同源 fetch，验证单张/批量画布请求都会先把节点图片交给直传层，
 * 再向 `/api/images/edit` 发送引用控制表单，而非在此模块绕回裸 multipart。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "@/features/infinite-canvas/canvas-state";

const canvasUploadMocks = vi.hoisted(() => ({ append: vi.fn() }));

vi.mock("@/features/image-generation/components/direct-upload-client", () => ({
  appendDirectUploadsOrFiles: canvasUploadMocks.append,
}));

import { runImageEdit, runImageEditBatch } from "./canvas-generators";

const generationNode = { size: "1024x1024" } as CanvasNode;
const imageNodes = [
  { imageUrl: "https://example.com/source.png" } as CanvasNode,
];

beforeEach(() => {
  canvasUploadMocks.append.mockReset().mockImplementation(
    async (input: { formData: FormData; referenceField: string }) => {
      input.formData.set(input.referenceField, "[]");
      return "direct";
    }
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "https://example.com/source.png") {
      return new Response(Uint8Array.from([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      });
    }
    if (url === "/api/images/edit") {
      const formData = init?.body;
      if (!(formData instanceof FormData)) {
        throw new Error("Expected edit FormData");
      }
      expect(formData.get("image_refs")).toBe("[]");
      expect(formData.getAll("image")).toEqual([]);
      const generationIds = formData.get("generationIds");
      const parsedGenerationIds: unknown = generationIds
        ? JSON.parse(String(generationIds))
        : null;
      if (
        generationIds &&
        (!Array.isArray(parsedGenerationIds) ||
          !parsedGenerationIds.every((id): id is string => typeof id === "string"))
      ) {
        throw new Error("Expected string generation IDs");
      }
      return Response.json(
        Array.isArray(parsedGenerationIds)
          ? {
              results: parsedGenerationIds.map((id) => ({
                generationId: id,
                status: "completed",
                imageUrl: `https://example.com/${id}.png`,
              })),
            }
          : {
              generationId: String(formData.get("generationId")),
              status: "completed",
              imageUrl: "https://example.com/output.png",
            }
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

describe("canvas direct upload", () => {
  it("单张编辑使用 image-source 直传引用", async () => {
    const result = await runImageEdit(
      "edit",
      generationNode,
      imageNodes,
      "generation-1"
    );

    expect(result).toMatchObject({ generationId: "generation-1" });
    expect(canvasUploadMocks.append).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "image-source",
        referenceField: "image_refs",
        files: [expect.objectContaining({ name: "canvas-0.png" })],
      })
    );
  });

  it("批量编辑复用同一组预上传输入", async () => {
    const result = await runImageEditBatch(
      "edit",
      generationNode,
      imageNodes,
      ["generation-1", "generation-2"]
    );

    expect(result).toHaveLength(2);
    expect(canvasUploadMocks.append).toHaveBeenCalledOnce();
    expect(canvasUploadMocks.append).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "image-source" })
    );
  });
});
