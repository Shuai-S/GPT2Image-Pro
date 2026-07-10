/**
 * 内部任务租约编排核心测试。
 *
 * 使用可控时钟的内存原子存储验证双副本竞争、心跳、崩溃接管、fencing、调度
 * 间隔以及成功/失败终态；不连接数据库。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeLeasedJob,
  type InternalJobLeaseAcquireInput,
  type InternalJobLeaseAcquireResult,
  type InternalJobLeaseStore,
  type InternalJobLeaseToken,
} from "./internal-job-lease-core";

type LeaseState = {
  ownerId: string;
  runId: string;
  status: "running" | "success" | "error";
  leaseExpiresAt: number;
  lastStartedAt: number;
  lastError?: string;
};

/** 创建可从测试侧完成的 Promise。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

/**
 * 构造带可控数据库时钟的内存租约存储。
 *
 * acquire/heartbeat/finalize 完整模拟生产 SQL 的原子条件，便于确定性验证状态机。
 */
function createMemoryLeaseStore() {
  let now = 0;
  const states = new Map<string, LeaseState>();

  const acquire = async (
    input: InternalJobLeaseAcquireInput
  ): Promise<InternalJobLeaseAcquireResult> => {
    const current = states.get(input.jobName);
    const expired =
      current?.status === "running" && current.leaseExpiresAt <= now;
    const intervalReached =
      current?.status !== "running" &&
      (input.mode === "manual" ||
        !current ||
        current.lastStartedAt + input.intervalMs <= now);
    if (!current || expired || intervalReached) {
      const leaseExpiresAt = now + input.leaseTtlMs;
      states.set(input.jobName, {
        ownerId: input.ownerId,
        runId: input.runId,
        status: "running",
        leaseExpiresAt,
        lastStartedAt: now,
      });
      return { acquired: true, leaseExpiresAt: new Date(leaseExpiresAt) };
    }
    if (current.status === "running") {
      return {
        acquired: false,
        reason: "already_running",
        retryAt: new Date(current.leaseExpiresAt),
      };
    }
    return {
      acquired: false,
      reason: "interval_not_reached",
      retryAt: new Date(current.lastStartedAt + input.intervalMs),
    };
  };

  const heartbeat = async (
    token: InternalJobLeaseToken,
    leaseTtlMs: number
  ) => {
    const current = states.get(token.jobName);
    if (
      !current ||
      current.ownerId !== token.ownerId ||
      current.runId !== token.runId ||
      current.status !== "running" ||
      current.leaseExpiresAt <= now
    ) {
      return false;
    }
    current.leaseExpiresAt = now + leaseTtlMs;
    return true;
  };

  const finalize: InternalJobLeaseStore["finalize"] = async (
    token,
    outcome
  ) => {
    const current = states.get(token.jobName);
    if (
      !current ||
      current.ownerId !== token.ownerId ||
      current.runId !== token.runId ||
      current.status !== "running"
    ) {
      return false;
    }
    current.status = outcome.status;
    current.leaseExpiresAt = now;
    current.lastError =
      outcome.status === "error" ? outcome.error : undefined;
    return true;
  };

  return {
    store: { acquire, heartbeat, finalize } satisfies InternalJobLeaseStore,
    state(jobName: string) {
      return states.get(jobName);
    },
    setNow(value: number) {
      now = value;
    },
  };
}

/** 创建单调递增的测试 runId 工厂。 */
function createRunIdFactory(prefix: string) {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("executeLeasedJob", () => {
  it("双副本并发触发时只执行一个任务", async () => {
    const memory = createMemoryLeaseStore();
    const blocker = deferred<string>();
    const firstRun = vi.fn(async () => await blocker.promise);
    const secondRun = vi.fn(async () => "second");
    const input = {
      jobName: "job",
      intervalMs: 100,
      leaseTtlMs: 50,
      heartbeatIntervalMs: 10,
      mode: "scheduled" as const,
    };

    const first = executeLeasedJob(
      { ...input, run: firstRun },
      {
        store: memory.store,
        ownerId: "owner-a",
        createRunId: createRunIdFactory("a"),
      }
    );
    await Promise.resolve();
    const second = await executeLeasedJob(
      { ...input, run: secondRun },
      {
        store: memory.store,
        ownerId: "owner-b",
        createRunId: createRunIdFactory("b"),
      }
    );

    expect(second).toMatchObject({
      executed: false,
      reason: "already_running",
    });
    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(secondRun).not.toHaveBeenCalled();

    blocker.resolve("first");
    await expect(first).resolves.toMatchObject({
      executed: true,
      result: "first",
      leaseLost: false,
    });
  });

  it("心跳续租后在原始过期点仍不可接管", async () => {
    vi.useFakeTimers();
    const memory = createMemoryLeaseStore();
    const blocker = deferred<string>();
    const input = {
      jobName: "job",
      intervalMs: 100,
      leaseTtlMs: 50,
      heartbeatIntervalMs: 20,
      mode: "scheduled" as const,
    };
    const first = executeLeasedJob(
      { ...input, run: async () => await blocker.promise },
      {
        store: memory.store,
        ownerId: "owner-a",
        createRunId: createRunIdFactory("a"),
      }
    );
    await Promise.resolve();

    memory.setNow(20);
    await vi.advanceTimersByTimeAsync(20);
    expect(memory.state("job")?.leaseExpiresAt).toBe(70);

    memory.setNow(55);
    const takeover = await executeLeasedJob(
      { ...input, run: async () => "takeover" },
      {
        store: memory.store,
        ownerId: "owner-b",
        createRunId: createRunIdFactory("b"),
      }
    );
    expect(takeover).toMatchObject({
      executed: false,
      reason: "already_running",
    });

    blocker.resolve("done");
    await first;
  });

  it("租约过期后新 owner 可接管且旧 owner 不能覆盖终态", async () => {
    const memory = createMemoryLeaseStore();
    const oldBlocker = deferred<string>();
    const input = {
      jobName: "job",
      intervalMs: 100,
      leaseTtlMs: 50,
      heartbeatIntervalMs: 10_000,
      mode: "scheduled" as const,
    };
    const oldExecution = executeLeasedJob(
      { ...input, run: async () => await oldBlocker.promise },
      {
        store: memory.store,
        ownerId: "owner-old",
        createRunId: createRunIdFactory("old"),
      }
    );
    await Promise.resolve();

    memory.setNow(51);
    const newExecution = await executeLeasedJob(
      { ...input, run: async () => "new" },
      {
        store: memory.store,
        ownerId: "owner-new",
        createRunId: createRunIdFactory("new"),
      }
    );
    expect(newExecution).toMatchObject({
      executed: true,
      result: "new",
      leaseLost: false,
    });
    expect(memory.state("job")).toMatchObject({
      ownerId: "owner-new",
      runId: "new-1",
      status: "success",
    });

    oldBlocker.resolve("old");
    await expect(oldExecution).resolves.toMatchObject({
      executed: true,
      result: "old",
      leaseLost: true,
    });
    expect(memory.state("job")).toMatchObject({
      ownerId: "owner-new",
      runId: "new-1",
      status: "success",
    });
  });

  it("任务失败时先持久化 error 终态再原样上抛", async () => {
    const memory = createMemoryLeaseStore();
    const failure = new Error("upstream failed");

    await expect(
      executeLeasedJob(
        {
          jobName: "job",
          intervalMs: 100,
          leaseTtlMs: 50,
          heartbeatIntervalMs: 10,
          mode: "scheduled",
          run: async () => {
            throw failure;
          },
        },
        {
          store: memory.store,
          ownerId: "owner",
          createRunId: createRunIdFactory("run"),
        }
      )
    ).rejects.toBe(failure);
    expect(memory.state("job")).toMatchObject({
      status: "error",
      lastError: "upstream failed",
    });
  });

  it("scheduled 尊重间隔而 manual 可绕过间隔", async () => {
    const memory = createMemoryLeaseStore();
    const createRunId = createRunIdFactory("run");
    const dependencies = {
      store: memory.store,
      ownerId: "owner",
      createRunId,
    };
    const base = {
      jobName: "job",
      intervalMs: 100,
      leaseTtlMs: 50,
      heartbeatIntervalMs: 10,
      run: async () => "done",
    };

    await executeLeasedJob({ ...base, mode: "scheduled" }, dependencies);
    memory.setNow(10);
    await expect(
      executeLeasedJob({ ...base, mode: "scheduled" }, dependencies)
    ).resolves.toMatchObject({
      executed: false,
      reason: "interval_not_reached",
    });
    await expect(
      executeLeasedJob({ ...base, mode: "manual" }, dependencies)
    ).resolves.toMatchObject({ executed: true, result: "done" });
  });

  it("终态写入故障不丢失已成功的任务结果", async () => {
    const memory = createMemoryLeaseStore();
    const finalizeError = new Error("database unavailable");
    const onFinalizeError = vi.fn();

    const result = await executeLeasedJob(
      {
        jobName: "job",
        intervalMs: 100,
        leaseTtlMs: 50,
        heartbeatIntervalMs: 10,
        mode: "scheduled",
        run: async () => "done",
      },
      {
        store: {
          ...memory.store,
          finalize: async () => {
            throw finalizeError;
          },
        },
        ownerId: "owner",
        createRunId: createRunIdFactory("run"),
        onFinalizeError,
      }
    );

    expect(result).toEqual({
      executed: true,
      result: "done",
      leaseLost: true,
    });
    expect(onFinalizeError).toHaveBeenCalledWith(finalizeError);
  });
});
