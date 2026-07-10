/**
 * PostgreSQL 图像并发租约的中止契约测试。
 *
 * 使用方：统一生图队列。DB-free mock 锁定明确丢租与心跳故障超过 TTL 时必须 abort
 * 业务闭包，防止槽位被新副本接管后旧上游仍继续占用真实并发。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMock = vi.hoisted(() => ({ execute: vi.fn() }));
const loggerMock = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("@repo/database", () => ({ db: databaseMock }));
vi.mock("@repo/shared/logger", () => ({
  createContextLogger: vi.fn(() => loggerMock),
}));

const lease = {
  leaseId: "lease-1",
  taskId: "task-1",
  userId: "user-1",
};

/** 返回一个只会在 signal abort 后拒绝的业务闭包。 */
function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

describe("postgresImageGenerationConcurrencyCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T10:00:00.000Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("心跳明确返回未续租时中止旧业务并条件释放", async () => {
    databaseMock.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const {
      ImageGenerationConcurrencyLeaseLostError,
      postgresImageGenerationConcurrencyCoordinator,
    } = await import("./distributed-concurrency");

    const execution =
      postgresImageGenerationConcurrencyCoordinator.runWithLease(
        lease,
        waitForAbort
      );
    const rejected = expect(execution).rejects.toBeInstanceOf(
      ImageGenerationConcurrencyLeaseLostError
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;

    expect(databaseMock.execute).toHaveBeenCalledTimes(2);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ leaseId: "lease-1", taskId: "task-1" }),
      "Image generation concurrency lease was lost"
    );
  });

  it("心跳持续异常超过本地 TTL 时同样中止旧业务", async () => {
    databaseMock.execute.mockRejectedValue(new Error("database unavailable"));
    const {
      ImageGenerationConcurrencyLeaseLostError,
      postgresImageGenerationConcurrencyCoordinator,
    } = await import("./distributed-concurrency");

    const execution =
      postgresImageGenerationConcurrencyCoordinator.runWithLease(
        lease,
        waitForAbort
      );
    const rejected = expect(execution).rejects.toBeInstanceOf(
      ImageGenerationConcurrencyLeaseLostError
    );
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await rejected;

    expect(databaseMock.execute).toHaveBeenCalledTimes(5);
  });
});
