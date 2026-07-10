/**
 * 外部 API 持久异步任务契约测试。
 *
 * 使用内存 store mock 保持 DB-free，覆盖创建/完成、公开字段、可编辑结果动态签名、
 * generation 回退映射与 callback 的 SSRF/超时错误语义。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  create: vi.fn<(input: unknown) => Promise<unknown>>(),
  get: vi.fn<(id: unknown) => Promise<unknown>>(),
  complete: vi.fn<(input: unknown) => Promise<unknown>>(),
}));
const materializerMocks = vi.hoisted(() => ({
  materialize: vi.fn(),
}));

vi.mock("./external-async-task-store", () => ({
  createExternalAsyncTask: storeMocks.create,
  getExternalAsyncTask: storeMocks.get,
  completeExternalAsyncTask: storeMocks.complete,
}));
vi.mock("./generation-task-materializer", () => ({
  materializeGenerationTask: materializerMocks.materialize,
}));

vi.mock("@repo/shared/security/dns-pin", () => ({
  fetchWithDnsPin: vi.fn(),
  SsrfBlockedError: class SsrfBlockedError extends Error {
    /** 构造测试用 SSRF 拒绝错误。 */
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
  getAsyncImageTask,
  toAsyncImageTask,
  toAsyncImageTaskResponse,
  toGenerationImageTaskResponse,
  toVideoGenerationTaskResponse,
  type VideoTaskRow,
  validateCallbackUrl,
} from "./async-image-tasks";
import type { ExternalAsyncTaskRow } from "./external-async-task-store";

type CreateStoreInput = {
  id: string;
  taskType: "image" | "video" | "editable_file";
  objectType: string;
  userId: string;
  apiKeyId?: string;
  kind?: "ppt" | "psd";
  model?: string;
  clientRequestId?: string;
  requestHash?: string;
  status: "queued" | "running";
  priority?: number;
  userConcurrency?: number;
  maxAttempts?: number;
  initialPayload: Record<string, unknown>;
  requestPayload?: Record<string, unknown>;
  callbackUrl?: string;
};

type CompleteStoreInput = {
  id: string;
  objectType: string;
  resultPayload?: unknown;
  errorPayload?: unknown;
};

const mockFetchWithDnsPin = vi.mocked(fetchWithDnsPin);
const previousSigningSecret = process.env.BETTER_AUTH_SECRET;

/** 从 create 输入构造完整数据库行，模拟 PostgreSQL 默认值。 */
function createStoreRow(input: CreateStoreInput): ExternalAsyncTaskRow {
  const now = new Date("2026-07-10T00:00:00.000Z");
  return {
    id: input.id,
    taskType: input.taskType,
    objectType: input.objectType,
    userId: input.userId,
    apiKeyId: input.apiKeyId ?? null,
    kind: input.kind ?? null,
    model: input.model ?? null,
    clientRequestId: input.clientRequestId ?? null,
    requestHash: input.requestHash ?? null,
    status: input.status,
    priority: input.priority ?? 0,
    userConcurrency: input.userConcurrency ?? 1,
    attemptCount: 0,
    maxAttempts: input.maxAttempts ?? 3,
    availableAt: now,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    initialPayload: input.initialPayload,
    requestPayload: input.requestPayload ?? null,
    resultPayload: null,
    errorPayload: null,
    callbackUrl: input.callbackUrl ?? null,
    callbackStatus: input.callbackUrl ? "waiting" : "none",
    callbackAttempts: 0,
    callbackNextAt: null,
    callbackLeaseOwner: null,
    callbackLeaseToken: null,
    callbackLeaseExpiresAt: null,
    callbackDeliveredAt: null,
    callbackError: null,
    startedAt: input.status === "running" ? now : null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  storeMocks.rows.clear();
  storeMocks.create.mockReset();
  storeMocks.get.mockReset();
  storeMocks.complete.mockReset();
  materializerMocks.materialize.mockReset();
  materializerMocks.materialize.mockResolvedValue(undefined);
  mockFetchWithDnsPin.mockReset();
  process.env.BETTER_AUTH_SECRET = "test-storage-signing-secret";

  storeMocks.create.mockImplementation(async (raw) => {
    const row = createStoreRow(raw as CreateStoreInput);
    storeMocks.rows.set(row.id, row);
    return row;
  });
  storeMocks.get.mockImplementation(async (rawId) => {
    return storeMocks.rows.get(String(rawId));
  });
  storeMocks.complete.mockImplementation(async (raw) => {
    const input = raw as CompleteStoreInput;
    const current = storeMocks.rows.get(input.id) as
      | ExternalAsyncTaskRow
      | undefined;
    if (
      !current ||
      current.status === "completed" ||
      current.status === "failed"
    ) {
      return undefined;
    }
    const row: ExternalAsyncTaskRow = {
      ...current,
      objectType: input.objectType,
      status: input.errorPayload === undefined ? "completed" : "failed",
      resultPayload: input.resultPayload ?? null,
      errorPayload: input.errorPayload ?? null,
      completedAt: new Date("2026-07-10T00:01:00.000Z"),
      updatedAt: new Date("2026-07-10T00:01:00.000Z"),
    };
    storeMocks.rows.set(row.id, row);
    return row;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (previousSigningSecret === undefined) {
    delete process.env.BETTER_AUTH_SECRET;
  } else {
    process.env.BETTER_AUTH_SECRET = previousSigningSecret;
  }
});

describe("external async tasks", () => {
  it("持久创建任务并从公开响应移除归属字段", async () => {
    const task = await createAsyncImageTask({
      userId: "user_1",
      apiKeyId: "key_1",
      model: "gpt-image-2",
      generationIds: ["gen_1"],
      clientRequestId: "request_1",
      requestHash: "hash_1",
    });

    const response = toAsyncImageTaskResponse(task);
    expect(response).toMatchObject({
      id: expect.stringMatching(/^task_/),
      object: "image.generation",
      model: "gpt-image-2",
      status: "processing",
      generation_id: "gen_1",
      generationId: "gen_1",
    });
    expect(response).not.toHaveProperty("userId");
    expect(response).not.toHaveProperty("apiKeyId");
    expect(storeMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRequestId: "request_1",
        requestHash: "hash_1",
      })
    );
  });

  it("完成任务时把结果字段平铺且重复完成保持首个终态", async () => {
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
    const replay = await completeAsyncImageTask(task.id, {
      error: { error: { message: "late error" } },
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
    expect(replay?.status).toBe("completed");
    expect(storeMocks.complete).toHaveBeenCalledOnce();
  });

  it("轮询普通终态时使用动态 generation 物化结果", async () => {
    const row = createStoreRow({
      id: "task_dynamic",
      taskType: "image",
      objectType: "image",
      userId: "user_1",
      status: "running",
      initialPayload: {
        id: "task_dynamic",
        object: "image.generation",
        status: "processing",
        generationId: "gen_1",
      },
    });
    row.status = "completed";
    row.resultPayload = { generationIds: ["gen_1"] };
    storeMocks.rows.set(row.id, row);
    materializerMocks.materialize.mockResolvedValueOnce({
      objectType: "image",
      status: "completed",
      payload: {
        data: [{ url: "https://runtime.example.com/image.png?sig=current" }],
        credits_consumed: 3.15,
      },
    });

    const task = await getAsyncImageTask(row.id);

    expect(materializerMocks.materialize).toHaveBeenCalledWith(row);
    expect(task).toMatchObject({
      id: row.id,
      object: "image",
      status: "completed",
      data: [{ url: "https://runtime.example.com/image.png?sig=current" }],
      credits_consumed: 3.15,
    });
    expect(task).not.toHaveProperty("generationIds");
  });

  it("可编辑终态仅持久化对象引用并在每次读取时重新签名", () => {
    const row = createStoreRow({
      id: "task_editable",
      taskType: "editable_file",
      objectType: "editable_file_task",
      userId: "user_1",
      apiKeyId: "key_1",
      kind: "ppt",
      clientRequestId: "client_1",
      requestHash: "hash_1",
      status: "running",
      initialPayload: {
        id: "task_editable",
        object: "editable_file_task",
        kind: "ppt",
        client_task_id: "client_1",
        status: "processing",
        created_at: "2026-07-10T00:00:00.000Z",
      },
    });
    row.status = "completed";
    row.completedAt = new Date("2026-07-10T00:01:00.000Z");
    row.resultPayload = {
      object: "editable_file_task",
      kind: "ppt",
      result: {
        conversation_id: "conversation_1",
        primary_storage: {
          bucket: "generations",
          key: "user_1/editable-file-results/hash/document.pptx",
          contentType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          size: 123,
        },
        zip_storage: null,
      },
      credits_charged: 25,
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T00:01:00.000Z"));
    const first = toAsyncImageTaskResponse(toAsyncImageTask(row));
    vi.setSystemTime(new Date("2026-07-10T00:01:02.000Z"));
    const second = toAsyncImageTaskResponse(toAsyncImageTask(row));

    expect(first).toMatchObject({
      object: "editable_file_task",
      status: "completed",
      result: {
        conversation_id: "conversation_1",
        primary_url: expect.stringContaining("/api/storage/generations/"),
        zip_url: null,
      },
      credits_charged: 25,
    });
    expect(first).not.toHaveProperty("result.primary_storage");
    expect(first.result).not.toEqual(second.result);
  });

  it("把已完成 generation 映射为带签名 URL 的任务响应", () => {
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
    const response = toGenerationImageTaskResponse(
      row,
      "/api/storage/generations/k?sig=x"
    );
    expect(response).toMatchObject({
      id: "gen_abc",
      object: "image",
      status: "completed",
      generation_id: "gen_abc",
      image_url: "/api/storage/generations/k?sig=x",
      data: [
        { url: "/api/storage/generations/k?sig=x", revised_prompt: "a cat" },
      ],
      credits_consumed: 3.15,
      completed_at: "2026-06-22T00:01:00.000Z",
    });
  });

  it("pending/failed generation 不泄露 URL", () => {
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

    const failed = toGenerationImageTaskResponse(
      { ...base, id: "gen_f", status: "failed", error: "boom" },
      null
    );
    expect(failed).toMatchObject({
      status: "failed",
      error: { message: "boom" },
    });
  });

  it("把已完成视频 generation 映射为带时长的任务响应", () => {
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
    const response = toVideoGenerationTaskResponse(
      row,
      "/api/storage/generations/v?sig=x"
    );
    expect(response).toMatchObject({
      id: "vid_1",
      object: "video",
      status: "completed",
      duration_seconds: 8,
      video_url: "/api/storage/generations/v?sig=x",
      data: [{ url: "/api/storage/generations/v?sig=x" }],
      credits_consumed: 240,
    });
  });

  it("running/failed video generation 不泄露 URL", () => {
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
    expect(toVideoGenerationTaskResponse(base, null)).toMatchObject({
      status: "processing",
      object: "video.generation",
    });
    const failed = toVideoGenerationTaskResponse(
      { ...base, id: "vid_f", status: "failed", error: "upstream 500" },
      null
    );
    expect(failed).toMatchObject({
      status: "failed",
      error: { message: "upstream 500" },
    });
  });

  it("拒绝私网和明文 callback URL", async () => {
    await expect(
      validateCallbackUrl("https://127.0.0.1/callback")
    ).rejects.toThrow("publicly reachable");
    await expect(
      validateCallbackUrl("http://example.com/callback")
    ).rejects.toThrow("https");
  });

  it("callback 使用稳定事件 ID，非 2xx 显式抛错", async () => {
    const task = await createAsyncImageTask({ userId: "user_1" });
    mockFetchWithDnsPin.mockResolvedValueOnce(new Response("ok"));
    await deliverAsyncImageCallback("https://example.com/callback", task);
    expect(mockFetchWithDnsPin).toHaveBeenCalledWith(
      expect.stringContaining("https://example.com/callback"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Tokens-Callback": "true",
          "X-Tokens-Callback-Event-Id": task.id,
        }),
      })
    );

    mockFetchWithDnsPin.mockResolvedValueOnce(
      new Response("unavailable", { status: 503 })
    );
    await expect(
      deliverAsyncImageCallback("https://example.com/callback", task)
    ).rejects.toThrow("HTTP 503");
  });

  it("callback 不跟随重定向进入私网", async () => {
    const task = await createAsyncImageTask({ userId: "user_1" });
    mockFetchWithDnsPin.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      })
    );

    await expect(
      deliverAsyncImageCallback("https://example.com/callback", task)
    ).rejects.toThrow();
    expect(mockFetchWithDnsPin).toHaveBeenCalledTimes(1);
  });
});
