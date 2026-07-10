/**
 * 普通 generation worker 单任务状态机测试。
 *
 * 使用 DB-free 依赖覆盖严格请求、成功/失败、重排、心跳丢租、旧 token 和清理降级，
 * 证明媒体输入只会由成功提交终态的当前执行者删除。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(),
}));
vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: vi.fn(),
}));

import {
  type GenerationTaskResolution,
  type GenerationTaskWorkerDependencies,
  type GenerationTaskWorkerRow,
  processGenerationTaskClaim,
} from "./generation-task-worker-core";

const inputReference = {
  bucket: "generations",
  key: "user-1/async-task-inputs/task-1/1.png",
  name: "source.png",
  contentType: "image/png",
  size: 4,
  role: "source" as const,
};

const validRow: GenerationTaskWorkerRow = {
  id: "task-1",
  userId: "user-1",
  apiKeyId: "key-1",
  taskType: "image",
  requestPayload: {
    kind: "image_edit",
    relayOnly: false,
    generationIds: ["gen-1"],
    createdAtEpochSeconds: 1_788_000_000,
    responseFormat: "url",
    input: {
      prompt: "移除背景",
      model: "gpt-image-2",
    },
    inputReferences: [inputReference],
  },
};

/**
 * 构造 generation worker 的确定性内存依赖。
 *
 * @param options 控制业务决议、fencing、心跳和清理失败。
 * @returns 状态机依赖与关键副作用 mock，不访问数据库、对象存储或上游。
 * @sideEffects 无。
 */
function makeDependencies(options?: {
  resolution?: GenerationTaskResolution;
  resolveError?: Error;
  finalizeResult?: boolean;
  requeueResult?: boolean;
  heartbeat?: (id: string, token: string) => Promise<boolean>;
  cleanupError?: Error;
}) {
  type ResolveTaskInput = Parameters<
    GenerationTaskWorkerDependencies["resolveTask"]
  >[0];
  const resolveTask = vi.fn(
    async (_input: ResolveTaskInput): Promise<GenerationTaskResolution> => {
      if (options?.resolveError) throw options.resolveError;
      return (
        options?.resolution ?? {
          status: "completed",
          objectType: "image",
          resultPayload: { generationIds: ["gen-1"] },
        }
      );
    }
  );
  const finalizeTask = vi.fn(async () => options?.finalizeResult ?? true);
  const requeueTask = vi.fn(async () => options?.requeueResult ?? true);
  const cleanupInputs = vi.fn(async () => {
    if (options?.cleanupError) throw options.cleanupError;
  });
  const onCleanupError = vi.fn();
  const dependencies: GenerationTaskWorkerDependencies = {
    heartbeatTask: options?.heartbeat ?? (async () => true),
    requeueTask,
    finalizeTask,
    resolveTask,
    cleanupInputs,
    toErrorPayload: (error) => ({
      error: {
        message: error instanceof Error ? error.message : "unknown error",
      },
    }),
    heartbeatIntervalMs: 60_000,
    onCleanupError,
  };
  return {
    dependencies,
    resolveTask,
    finalizeTask,
    requeueTask,
    cleanupInputs,
    onCleanupError,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("processGenerationTaskClaim", () => {
  it("非法或 taskType 不匹配的 payload 直接 fencing 失败且不清理", async () => {
    const { dependencies, resolveTask, finalizeTask, cleanupInputs } =
      makeDependencies();

    await expect(
      processGenerationTaskClaim(
        {
          row: { ...validRow, taskType: "video" },
          leaseToken: "lease-token-1",
        },
        dependencies
      )
    ).resolves.toEqual({ status: "failed" });
    expect(resolveTask).not.toHaveBeenCalled();
    expect(finalizeTask).toHaveBeenCalledWith({
      id: validRow.id,
      leaseToken: "lease-token-1",
      objectType: "video",
      errorPayload: {
        error: { message: "Persisted generation task request is invalid" },
      },
    });
    expect(cleanupInputs).not.toHaveBeenCalled();
  });

  it("持久请求声明 relayOnly 时 fail-closed 且不调用业务", async () => {
    const { dependencies, resolveTask, finalizeTask } = makeDependencies();

    await expect(
      processGenerationTaskClaim(
        {
          row: {
            ...validRow,
            requestPayload: {
              ...validRow.requestPayload,
              relayOnly: true,
            },
          },
          leaseToken: "lease-token-1",
        },
        dependencies
      )
    ).resolves.toEqual({ status: "failed" });
    expect(resolveTask).not.toHaveBeenCalled();
    expect(finalizeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        errorPayload: {
          error: { message: "Persisted generation task request is invalid" },
        },
      })
    );
  });

  it("成功决议以紧凑 generationIds 终态并清理受控引用", async () => {
    const { dependencies, finalizeTask, cleanupInputs } = makeDependencies();

    await expect(
      processGenerationTaskClaim(
        { row: validRow, leaseToken: "lease-token-1" },
        dependencies
      )
    ).resolves.toEqual({ status: "completed" });
    expect(finalizeTask).toHaveBeenCalledWith({
      id: validRow.id,
      leaseToken: "lease-token-1",
      objectType: "image",
      resultPayload: { generationIds: ["gen-1"] },
    });
    expect(cleanupInputs).toHaveBeenCalledWith({
      userId: validRow.userId,
      taskId: validRow.id,
      references: [inputReference],
    });
  });

  it("业务异常映射为失败终态，清理失败不改变已提交结果", async () => {
    const { dependencies, finalizeTask, cleanupInputs, onCleanupError } =
      makeDependencies({
        resolveError: new Error("upstream failed"),
        cleanupError: new Error("delete failed"),
      });

    await expect(
      processGenerationTaskClaim(
        { row: validRow, leaseToken: "lease-token-1" },
        dependencies
      )
    ).resolves.toEqual({ status: "failed" });
    expect(finalizeTask).toHaveBeenCalledWith({
      id: validRow.id,
      leaseToken: "lease-token-1",
      objectType: "image",
      errorPayload: { error: { message: "upstream failed" } },
    });
    expect(cleanupInputs).toHaveBeenCalledOnce();
    expect(onCleanupError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("处理中决议只重排，不写终态也不清理输入", async () => {
    const { dependencies, finalizeTask, requeueTask, cleanupInputs } =
      makeDependencies({ resolution: { status: "requeue", delayMs: 5_000 } });

    await expect(
      processGenerationTaskClaim(
        { row: validRow, leaseToken: "lease-token-1" },
        dependencies
      )
    ).resolves.toEqual({ status: "requeued" });
    expect(requeueTask).toHaveBeenCalledWith(
      validRow.id,
      "lease-token-1",
      5_000
    );
    expect(finalizeTask).not.toHaveBeenCalled();
    expect(cleanupInputs).not.toHaveBeenCalled();
  });

  it("业务适配返回媒体正文时改写为失败而不落 resultPayload", async () => {
    const invalidResolution = {
      status: "completed",
      objectType: "image",
      resultPayload: {
        generationIds: ["gen-1"],
        data: [{ b64_json: "aGVsbG8=" }],
      },
    } as unknown as GenerationTaskResolution;
    const { dependencies, finalizeTask } = makeDependencies({
      resolution: invalidResolution,
    });

    await expect(
      processGenerationTaskClaim(
        { row: validRow, leaseToken: "lease-token-1" },
        dependencies
      )
    ).resolves.toEqual({ status: "failed" });
    expect(finalizeTask).toHaveBeenCalledWith({
      id: validRow.id,
      leaseToken: "lease-token-1",
      objectType: "image",
      errorPayload: {
        error: {
          message: "Generation task result contains invalid persisted data",
        },
      },
    });
  });

  it("旧 token 无法终态时不删除新 worker 仍需的输入", async () => {
    const { dependencies, cleanupInputs } = makeDependencies({
      finalizeResult: false,
    });

    await expect(
      processGenerationTaskClaim(
        { row: validRow, leaseToken: "stale-token" },
        dependencies
      )
    ).resolves.toEqual({ status: "lease_lost" });
    expect(cleanupInputs).not.toHaveBeenCalled();
  });

  it("心跳明确丢租时 abort 业务且不写终态或清理", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn(async () => false);
    const { dependencies, resolveTask, finalizeTask, cleanupInputs } =
      makeDependencies({ heartbeat });
    dependencies.heartbeatIntervalMs = 10;
    resolveTask.mockImplementationOnce(
      async ({ signal }): Promise<GenerationTaskResolution> =>
        await new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              resolve({
                status: "failed",
                objectType: "image",
                errorPayload: { error: { message: "aborted" } },
              });
            },
            { once: true }
          );
        })
    );

    const result = processGenerationTaskClaim(
      { row: validRow, leaseToken: "lease-token-1" },
      dependencies
    );
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toEqual({ status: "lease_lost" });
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(finalizeTask).not.toHaveBeenCalled();
    expect(cleanupInputs).not.toHaveBeenCalled();
  });
});
