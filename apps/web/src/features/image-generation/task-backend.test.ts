import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingBoolean: vi.fn(async () => false),
  getRuntimeSettingNumber: vi.fn(
    async (_key: string, fallback: number) => fallback
  ),
  getRuntimeSettingString: vi.fn(async () => ""),
}));

vi.mock("@repo/shared/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import type { ApiConfig, ImageInputFile } from "./types";

// task 后端适配测试：验证提交任务、轮询任务和图生图 image_urls 载荷。
describe("task image backend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("submits generation requests and polls completed task images", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { generateImage } = await import("./service");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/images/generations")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.model).toBe("gpt-image-2");
        expect(String(body.prompt)).toContain("cinematic castle");
        expect(body.size).toBe("16:9");
        expect(body.resolution).toBe("4k");
        expect(body.quality).toBe("high");
        return Response.json({
          code: 200,
          data: [{ status: "submitted", task_id: "task_1" }],
        });
      }
      expect(url).toBe("https://api.example.test/v1/tasks/task_1?language=en");
      return Response.json({
        code: 200,
        data: {
          id: "task_1",
          status: "completed",
          result: {
            images: [{ url: ["https://upload.example.test/image.png"] }],
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage(taskConfig(), {
      prompt: "cinematic castle",
      model: "gpt-image-2",
      size: "3840x2160",
      quality: "high",
    });

    expect(result.error).toBeUndefined();
    expect(result.imageUrl).toBe("https://upload.example.test/image.png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends edit inputs as task image_urls data URIs", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { editImage } = await import("./service");
    const image: ImageInputFile = {
      data: Buffer.from("reference-image"),
      type: "image/png",
      name: "reference.png",
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/images/generations")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.prompt).toBeTypeOf("string");
        expect(body.image_urls).toEqual([
          `data:image/png;base64,${Buffer.from("reference-image").toString(
            "base64"
          )}`,
        ]);
        return Response.json({ data: [{ task_id: "task_edit" }] });
      }
      return Response.json({
        data: {
          id: "task_edit",
          status: "completed",
          result: {
            images: [{ url: ["https://upload.example.test/edit.png"] }],
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await editImage(taskConfig(), {
      prompt: "make it watercolor",
      model: "gpt-image-2",
      images: [image],
      size: "1024x1024",
    });

    expect(result.error).toBeUndefined();
    expect(result.imageUrl).toBe("https://upload.example.test/edit.png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function taskConfig(): ApiConfig {
  return {
    baseUrl: "https://api.example.test/v1",
    apiKey: "task-key",
    model: "gpt-image-2",
    backend: {
      type: "pool-api",
      id: "api_task",
      requestKind: "image_generation",
      apiInterfaceMode: "task",
      reportResult: false,
    },
  };
}
