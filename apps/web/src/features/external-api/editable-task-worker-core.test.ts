/**
 * 可编辑文件持久 worker 单任务状态机测试。
 *
 * 使用内存租约和 semaphore 依赖覆盖非法请求、集群限流重排、成功/失败终态与
 * fencing token 丢失，确保重启接管路径不会双执行终态或错误清理输入对象。
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(),
}));
vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: vi.fn(),
}));

import type {
  ImageGenerationConcurrencyCoordinator,
  ImageGenerationConcurrencyLease,
} from "@/features/image-generation/queue-core";
import {
  type EditableTaskWorkerDependencies,
  type EditableTaskWorkerRow,
  processEditableTaskClaim,
} from "./editable-task-worker-core";

const lease: ImageGenerationConcurrencyLease = {
  leaseId: "generation-lease-1",
  taskId: "task-1",
  userId: "user-1",
};

const inputReference = {
  bucket: "generations",
  key: "user-1/editable-task-inputs/task-1/1.png",
  name: "reference.png",
  contentType: "image/png",
  size: 4,
};

const validRow: EditableTaskWorkerRow = {
  id: "task-1",
  userId: "user-1",
  apiKeyId: "key-1",
  kind: "ppt",
  clientRequestId: "client-request-1",
  requestPayload: {
    prompt: "生成季度汇报",
    inputReferences: [inputReference],
  },
  userConcurrency: 2,
};

/**
 * 构造可编辑文件 worker 的测试依赖与 mock 集合。
 *
 * @param options 控制并发领取、业务执行和终态 fencing 结果。
 * @returns 状态机依赖及关键副作用 mock，不访问数据库、存储或上游。
 */
function makeDependencies(options?: {
  acquisition?:
    | { acquired: true; lease: ImageGenerationConcurrencyLease }
    | { acquired: false; reason: "user_limit" | "global_limit" };
  runError?: Error;
  finalizeResult?: boolean;
}) {
  const acquisition = options?.acquisition ?? {
    acquired: true as const,
    lease,
  };
  const acquire = vi.fn(async () => acquisition);
  const runWithLeaseCall = vi.fn();
  const runWithLease = async <T>(
    activeLease: ImageGenerationConcurrencyLease,
    run: () => Promise<T>
  ): Promise<T> => {
    runWithLeaseCall(activeLease);
    return await run();
  };
  const coordinator: ImageGenerationConcurrencyCoordinator = {
    acquire,
    runWithLease,
  };
  const requeueTask = vi.fn(async () => true);
  const finalizeTask = vi.fn(async () => options?.finalizeResult ?? true);
  const loadImages = vi.fn(async () => [
    {
      data: Buffer.from("data"),
      name: "reference.png",
      type: "image/png",
    },
  ]);
  const runEditableFile = vi.fn(async () => {
    if (options?.runError) throw options.runError;
    return { storageKey: "user-1/results/task-1.pptx" };
  });
  const cleanupInputs = vi.fn(async () => {});
  const dependencies: EditableTaskWorkerDependencies = {
    coordinator,
    getGlobalConcurrency: async () => 8,
    heartbeatTask: async () => true,
    requeueTask,
    finalizeTask,
    loadImages,
    runEditableFile,
    cleanupInputs,
    toErrorPayload: (error) => ({
      error: {
        message: error instanceof Error ? error.message : "unknown error",
      },
    }),
    heartbeatIntervalMs: 60_000,
    requeueDelayMs: 250,
  };
  return {
    acquire,
    runWithLeaseCall,
    requeueTask,
    finalizeTask,
    loadImages,
    runEditableFile,
    cleanupInputs,
    dependencies,
  };
}

describe("processEditableTaskClaim", () => {
  it("持久请求非法时用当前 token 写失败终态", async () => {
    const { dependencies, acquire, finalizeTask } = makeDependencies();

    await expect(
      processEditableTaskClaim(
        {
          row: { ...validRow, requestPayload: null },
          leaseToken: "task-token-1",
        },
        dependencies
      )
    ).resolves.toEqual({ status: "failed" });
    expect(acquire).not.toHaveBeenCalled();
    expect(finalizeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: validRow.id,
        leaseToken: "task-token-1",
        errorPayload: {
          error: { message: "Persisted editable task request is invalid" },
        },
      })
    );
  });

  it("用户并发槽不足时不运行上游并短暂重排", async () => {
    const { dependencies, requeueTask, runEditableFile } = makeDependencies({
      acquisition: { acquired: false, reason: "user_limit" },
    });

    await expect(
      processEditableTaskClaim(
        { row: validRow, leaseToken: "task-token-1" },
        dependencies
      )
    ).resolves.toEqual({ status: "requeued", reason: "user_limit" });
    expect(requeueTask).toHaveBeenCalledWith(validRow.id, "task-token-1", 250);
    expect(runEditableFile).not.toHaveBeenCalled();
  });

  it("获得集群许可后成功写终态并清理输入", async () => {
    const {
      dependencies,
      acquire,
      finalizeTask,
      runEditableFile,
      cleanupInputs,
    } = makeDependencies();

    await expect(
      processEditableTaskClaim(
        { row: validRow, leaseToken: "task-token-1" },
        dependencies
      )
    ).resolves.toEqual({ status: "completed" });
    expect(acquire).toHaveBeenCalledWith({
      taskId: validRow.id,
      userId: validRow.userId,
      userConcurrency: 2,
      globalConcurrency: 8,
    });
    expect(runEditableFile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: validRow.userId,
        apiKeyId: validRow.apiKeyId,
        kind: "ppt",
        taskId: validRow.clientRequestId,
      })
    );
    expect(finalizeTask).toHaveBeenCalledWith({
      id: validRow.id,
      leaseToken: "task-token-1",
      resultPayload: { storageKey: "user-1/results/task-1.pptx" },
    });
    expect(cleanupInputs).toHaveBeenCalledOnce();
  });

  it("业务失败时记录错误终态并在成功 fencing 后清理输入", async () => {
    const { dependencies, finalizeTask, cleanupInputs } = makeDependencies({
      runError: new Error("upstream failed"),
    });

    await expect(
      processEditableTaskClaim(
        { row: validRow, leaseToken: "task-token-1" },
        dependencies
      )
    ).resolves.toEqual({ status: "failed" });
    expect(finalizeTask).toHaveBeenCalledWith({
      id: validRow.id,
      leaseToken: "task-token-1",
      errorPayload: { error: { message: "upstream failed" } },
    });
    expect(cleanupInputs).toHaveBeenCalledOnce();
  });

  it("终态 fencing token 已失时不清理新 worker 仍需的输入", async () => {
    const { dependencies, cleanupInputs } = makeDependencies({
      finalizeResult: false,
    });

    await expect(
      processEditableTaskClaim(
        { row: validRow, leaseToken: "stale-token" },
        dependencies
      )
    ).resolves.toEqual({ status: "lease_lost" });
    expect(cleanupInputs).not.toHaveBeenCalled();
  });
});
