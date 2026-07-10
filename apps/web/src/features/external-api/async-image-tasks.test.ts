/**
 * 外部异步任务公开契约测试。
 *
 * 使用内存 store mock 验证 PostgreSQL 持久任务的异步创建、终态映射与归属字段剥离，
 * 同时覆盖 callback 的 HTTPS、SSRF、事件 ID 和重定向失败边界。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const taskStoreState = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
}));

vi.mock("./external-async-task-store", () => ({
  createExternalAsyncTask: vi.fn(
    async (input: {
      id: string;
      taskType: string;
      objectType: string;
      userId: string;
      apiKeyId?: string;
      model?: string;
      status: string;
      initialPayload: Record<string, unknown>;
    }) => {
      const now = new Date("2026-07-10T00:00:00.000Z");
      const row = {
        ...input,
        apiKeyId: input.apiKeyId ?? null,
        model: input.model ?? null,
        initialPayload: input.initialPayload,
        resultPayload: null,
        errorPayload: null,
        completedAt: null,
        createdAt: now,
      };
      taskStoreState.rows.set(input.id, row);
      return row;
    }
  ),
  getExternalAsyncTask: vi.fn(async (id: string) =>
    taskStoreState.rows.get(id)
  ),
  completeExternalAsyncTask: vi.fn(
    async (input: {
      id: string;
      objectType: string;
      resultPayload?: unknown;
      errorPayload?: unknown;
    }) => {
      const existing = taskStoreState.rows.get(input.id);
      if (!existing) return undefined;
      const row = {
        ...existing,
        objectType: input.objectType,
        status: input.errorPayload === undefined ? "completed" : "failed",
        resultPayload: input.resultPayload ?? null,
        errorPayload: input.errorPayload ?? null,
        completedAt: new Date("2026-07-10T00:01:00.000Z"),
      };
      taskStoreState.rows.set(input.id, row);
      return row;
    }
  ),
}));

vi.mock("@repo/shared/security/dns-pin", () => ({
  fetchWithDnsPin: vi.fn(),
  SsrfBlockedError: class SsrfBlockedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SsrfBlockedError";
    }
  },
}));

import { fetchWithDnsPin } from "@repo/shared/security/dns-pin";
import {
  completeAsyncImageTask,
  createAsyncImageTask,
  deliverAsyncImageCallback,
  type GenerationTaskRow,
  toAsyncImageTaskResponse,
  toGenerationImageTaskResponse,
  toVideoGenerationTaskResponse,
  type VideoTaskRow,
  validateCallbackUrl,
} from "./async-image-tasks";

const mockFetchWithDnsPin = vi.mocked(fetchWithDnsPin);

beforeEach(() => {
  taskStoreState.rows.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetchWithDnsPin.mockReset();
});

describe("external async image tasks", () => {
  it("持久化创建公开 processing 响应且不泄露归属字段", async () => {
    const task = await createAsyncImageTask({
      userId: "user_1",
      apiKeyId: "key_1",
      model: "gpt-image-2",
      generationIds: ["gen_1"],
    });

    expect(toAsyncImageTaskResponse(task)).toMatchObject({
      id: expect.stringMatching(/^task_/),
      object: "image.generation",
      model: "gpt-image-2",
      status: "processing",
      generation_id: "gen_1",
      generationId: "gen_1",
    });
    expect(toAsyncImageTaskResponse(task)).not.toHaveProperty("userId");
    expect(toAsyncImageTaskResponse(task)).not.toHaveProperty("apiKeyId");
  });

  it("把持久化完成结果平铺到任务响应", async () => {
    const task = await createAsyncImageTask({
      userId: "user_1",
      model: "gpt-image-2",
      generationIds: ["gen_1", "gen_2"],
    });

    const completed = await completeAsyncImageTask(task.id, {
      result: {
        created: 123,
        data: [{ url: "https://cdn.example.com/image.png" }],
        credits_consumed: 1.2,
      },
    });

    expect(completed && toAsyncImageTaskResponse(completed)).toMatchObject({
      id: task.id,
      object: "image",
      status: "completed",
      created: 123,
      data: [{ url: "https://cdn.example.com/image.png" }],
      credits_consumed: 1.2,
      generation_ids: ["gen_1", "gen_2"],
    });
  });

  it("maps a completed generation row to a task response with url + image_url", () => {
    const row: GenerationTaskRow = {
      id: "gen_abc",
      model: "gpt-image-2",
      status: "completed",
      revisedPrompt: "a cat",
      creditsConsumed: "3.15",
      error: null,
      createdAt: new Date("2026-06-22T00:00:00Z"),
      completedAt: new Date("2026-06-22T00:01:00Z"),
    };
    const res = toGenerationImageTaskResponse(
      row,
      "/api/storage/generations/k?sig=x"
    );
    expect(res).toMatchObject({
      id: "gen_abc",
      object: "image",
      status: "completed",
      generation_id: "gen_abc",
      generationId: "gen_abc",
      image_url: "/api/storage/generations/k?sig=x",
      data: [
        { url: "/api/storage/generations/k?sig=x", revised_prompt: "a cat" },
      ],
      credits_consumed: 3.15, // numeric 字符串转 number
      completed_at: "2026-06-22T00:01:00.000Z",
    });
  });

  it("maps pending/failed generations without leaking a url", () => {
    const base: GenerationTaskRow = {
      id: "gen_p",
      model: "gpt-image-2",
      status: "pending",
      revisedPrompt: null,
      creditsConsumed: null,
      error: null,
      createdAt: new Date("2026-06-22T00:00:00Z"),
      completedAt: null,
    };
    const pending = toGenerationImageTaskResponse(base, null);
    expect(pending).toMatchObject({
      status: "processing",
      object: "image.generation",
    });
    expect(pending).not.toHaveProperty("data");
    expect(pending).not.toHaveProperty("image_url");

    const failed = toGenerationImageTaskResponse(
      { ...base, id: "gen_f", status: "failed", error: "boom" },
      null
    );
    expect(failed).toMatchObject({
      status: "failed",
      error: { message: "boom" },
    });
    expect(failed).not.toHaveProperty("data");
  });

  it("maps a completed video generation to a task response with video_url + duration", () => {
    const row: VideoTaskRow = {
      id: "vid_1",
      model: "firefly-sora2-8s-16x9",
      status: "completed",
      durationSeconds: 8,
      creditsConsumed: "240",
      error: null,
      createdAt: new Date("2026-06-22T00:00:00Z"),
      updatedAt: new Date("2026-06-22T00:03:00Z"),
    };
    const res = toVideoGenerationTaskResponse(
      row,
      "/api/storage/generations/v?sig=x"
    );
    expect(res).toMatchObject({
      id: "vid_1",
      object: "video",
      status: "completed",
      duration_seconds: 8,
      generation_id: "vid_1",
      video_url: "/api/storage/generations/v?sig=x",
      data: [{ url: "/api/storage/generations/v?sig=x" }],
      credits_consumed: 240,
      completed_at: "2026-06-22T00:03:00.000Z",
    });
  });

  it("maps running/failed video generations without leaking a url", () => {
    const base: VideoTaskRow = {
      id: "vid_r",
      model: "firefly-sora2-8s-16x9",
      status: "running",
      durationSeconds: 8,
      creditsConsumed: "240",
      error: null,
      createdAt: new Date("2026-06-22T00:00:00Z"),
      updatedAt: null,
    };
    const running = toVideoGenerationTaskResponse(base, null);
    expect(running).toMatchObject({
      status: "processing",
      object: "video.generation",
    });
    expect(running).not.toHaveProperty("video_url");
    expect(running).not.toHaveProperty("data");

    const failed = toVideoGenerationTaskResponse(
      { ...base, id: "vid_f", status: "failed", error: "upstream 500" },
      null
    );
    expect(failed).toMatchObject({
      status: "failed",
      error: { message: "upstream 500" },
    });
  });

  it("rejects private callback URLs", async () => {
    await expect(
      validateCallbackUrl("https://127.0.0.1/callback")
    ).rejects.toThrow("publicly reachable");
  });

  it("rejects http callback URLs to keep results off plaintext", async () => {
    await expect(
      validateCallbackUrl("http://example.com/callback")
    ).rejects.toThrow("https");
  });

  it("posts callback payloads with the callback marker header", async () => {
    mockFetchWithDnsPin.mockResolvedValueOnce(new Response("ok"));
    const task = await createAsyncImageTask({ userId: "user_1" });

    await deliverAsyncImageCallback("https://example.com/callback", task);

    expect(mockFetchWithDnsPin).toHaveBeenCalledWith(
      expect.stringContaining("https://example.com/callback"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Tokens-Callback": "true",
          "X-Tokens-Callback-Event-Id": task.id,
        }),
      })
    );
  });

  it("does not follow a callback redirect into a private address", async () => {
    mockFetchWithDnsPin.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      })
    );
    const task = await createAsyncImageTask({ userId: "user_1" });

    await expect(
      deliverAsyncImageCallback("https://example.com/callback", task)
    ).rejects.toThrow("https");

    expect(mockFetchWithDnsPin).toHaveBeenCalledTimes(1);
  });
});
