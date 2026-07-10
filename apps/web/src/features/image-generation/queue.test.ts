/**
 * 图像生成本地等待队列测试。
 *
 * 注入共享内存协调器模拟多副本共用的用户/全局 semaphore，验证集群上限、本地
 * 优先级、许可释放、等待超时与协调器故障 fail-closed；不连接数据库。
 */

import { describe, expect, it, vi } from "vitest";

import {
  createImageGenerationQueue,
  type ImageGenerationConcurrencyCoordinator,
  type ImageGenerationConcurrencyLease,
} from "./queue-core";

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

/** 等待当前宏任务中的队列调度与 Promise 回调推进。 */
async function flushTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 创建跨多个 queue 实例共享的内存 semaphore。
 *
 * acquire 原子检查用户和全局计数，runWithLease 在 finally 释放，模拟生产协调器契约。
 */
function createMemoryCoordinator(options?: { failAcquire?: boolean }) {
  let running = 0;
  let sequence = 0;
  const runningByUser = new Map<string, number>();

  const coordinator: ImageGenerationConcurrencyCoordinator = {
    async acquire(input) {
      if (options?.failAcquire) throw new Error("database unavailable");
      if ((runningByUser.get(input.userId) ?? 0) >= input.userConcurrency) {
        return { acquired: false, reason: "user_limit" };
      }
      if (running >= input.globalConcurrency) {
        return { acquired: false, reason: "global_limit" };
      }
      running += 1;
      runningByUser.set(
        input.userId,
        (runningByUser.get(input.userId) ?? 0) + 1
      );
      return {
        acquired: true,
        lease: {
          leaseId: `lease-${++sequence}`,
          taskId: input.taskId,
          userId: input.userId,
        },
      };
    },
    async runWithLease<T>(
      lease: ImageGenerationConcurrencyLease,
      run: (signal: AbortSignal) => Promise<T>
    ) {
      try {
        return await run(new AbortController().signal);
      } finally {
        running -= 1;
        const userRunning = (runningByUser.get(lease.userId) ?? 1) - 1;
        if (userRunning > 0) {
          runningByUser.set(lease.userId, userRunning);
        } else {
          runningByUser.delete(lease.userId);
        }
      }
    },
  };

  return coordinator;
}

/** 创建使用指定共享协调器的独立副本队列。 */
function createQueue(
  coordinator: ImageGenerationConcurrencyCoordinator,
  options?: { globalConcurrency?: number; taskPrefix?: string }
) {
  let taskSequence = 0;
  return createImageGenerationQueue({
    coordinator,
    getGlobalConcurrency: async () => options?.globalConcurrency ?? 500,
    getQueueTimeoutMs: () => 20 * 60_000,
    createTaskId: () => `${options?.taskPrefix ?? "task"}-${++taskSequence}`,
    pollIntervalMs: 5,
  });
}

describe("createImageGenerationQueue", () => {
  it("两个副本共用同一全局并发上限", async () => {
    const coordinator = createMemoryCoordinator();
    const queueA = createQueue(coordinator, {
      globalConcurrency: 1,
      taskPrefix: "a",
    });
    const queueB = createQueue(coordinator, {
      globalConcurrency: 1,
      taskPrefix: "b",
    });
    const blocker = deferred<string>();
    const started: string[] = [];

    const first = queueA(
      { userId: "user-a", priority: "normal", userConcurrency: 10 },
      async () => {
        started.push("a");
        return await blocker.promise;
      }
    );
    const second = queueB(
      { userId: "user-b", priority: "normal", userConcurrency: 10 },
      async () => {
        started.push("b");
        return "b";
      }
    );

    await flushTasks();
    expect(started).toEqual(["a"]);

    blocker.resolve("a");
    await first;
    await second;
    expect(started).toEqual(["a", "b"]);
  });

  it("两个副本共用同一用户并发上限", async () => {
    const coordinator = createMemoryCoordinator();
    const queueA = createQueue(coordinator, { taskPrefix: "a" });
    const queueB = createQueue(coordinator, { taskPrefix: "b" });
    const blocker = deferred<string>();
    const started: string[] = [];

    const first = queueA(
      { userId: "shared", priority: "normal", userConcurrency: 1 },
      async () => {
        started.push("a");
        return await blocker.promise;
      }
    );
    const second = queueB(
      { userId: "shared", priority: "normal", userConcurrency: 1 },
      async () => {
        started.push("b");
        return "b";
      }
    );

    await flushTasks();
    expect(started).toEqual(["a"]);
    blocker.resolve("a");
    await first;
    await second;
    expect(started).toEqual(["a", "b"]);
  });

  it("单副本内高优先级早于先入队的普通任务", async () => {
    const coordinator = createMemoryCoordinator();
    const queue = createQueue(coordinator, { globalConcurrency: 1 });
    const blocker = deferred<string>();
    const started: string[] = [];

    const blockingRun = queue(
      { userId: "blocker", priority: "normal", userConcurrency: 10 },
      async () => {
        started.push("blocker");
        return await blocker.promise;
      }
    );
    await flushTasks();

    const normal = queue(
      { userId: "normal", priority: "normal", userConcurrency: 10 },
      async () => {
        started.push("normal");
        return "normal";
      }
    );
    const highest = queue(
      { userId: "highest", priority: "highest", userConcurrency: 10 },
      async () => {
        started.push("highest");
        return "highest";
      }
    );

    blocker.resolve("blocker");
    await blockingRun;
    await Promise.all([highest, normal]);
    expect(started).toEqual(["blocker", "highest", "normal"]);
  });

  it("任务完成后释放许可供后续任务使用", async () => {
    const queue = createQueue(createMemoryCoordinator());
    const started: string[] = [];

    await queue(
      { userId: "user", priority: "normal", userConcurrency: 1 },
      async () => {
        started.push("first");
        return "first";
      }
    );
    await queue(
      { userId: "user", priority: "normal", userConcurrency: 1 },
      async () => {
        started.push("second");
        return "second";
      }
    );

    expect(started).toEqual(["first", "second"]);
  });

  it("用户槽持续不可用时返回套餐并发错误", async () => {
    const queue = createQueue(createMemoryCoordinator());
    const blocker = deferred<string>();
    const first = queue(
      { userId: "user", priority: "normal", userConcurrency: 1 },
      async () => await blocker.promise
    );
    await flushTasks();

    const queued = queue(
      {
        userId: "user",
        priority: "normal",
        userConcurrency: 1,
        timeoutMs: 20,
      },
      async () => "never"
    );
    await expect(queued).rejects.toThrow(/concurrency limit reached/i);

    blocker.resolve("done");
    await first;
  });

  it("全局槽持续不可用时返回队列繁忙错误", async () => {
    const queue = createQueue(createMemoryCoordinator(), {
      globalConcurrency: 1,
    });
    const blocker = deferred<string>();
    const first = queue(
      { userId: "a", priority: "normal", userConcurrency: 10 },
      async () => await blocker.promise
    );
    await flushTasks();

    const queued = queue(
      {
        userId: "b",
        priority: "normal",
        userConcurrency: 10,
        timeoutMs: 20,
      },
      async () => "never"
    );
    await expect(queued).rejects.toThrow(/queue is busy/i);

    blocker.resolve("done");
    await first;
  });

  it("协调器故障时 fail-closed 而不运行闭包", async () => {
    const queue = createQueue(createMemoryCoordinator({ failAcquire: true }));
    const run = vi.fn(async () => "unexpected");

    await expect(
      queue({ userId: "user", priority: "normal", userConcurrency: 1 }, run)
    ).rejects.toThrow("temporarily unavailable");
    expect(run).not.toHaveBeenCalled();
  });

  it("等待用户槽时收到外部中止会立即移除且不运行闭包", async () => {
    const queue = createQueue(createMemoryCoordinator());
    const blocker = deferred<string>();
    const first = queue(
      { userId: "user", priority: "normal", userConcurrency: 1 },
      async () => await blocker.promise
    );
    await flushTasks();

    const controller = new AbortController();
    const aborted = new Error("task lease lost");
    const run = vi.fn(async () => "unexpected");
    const waiting = queue(
      {
        userId: "user",
        priority: "normal",
        userConcurrency: 1,
        signal: controller.signal,
      },
      run
    );
    await flushTasks();
    controller.abort(aborted);

    await expect(waiting).rejects.toBe(aborted);
    blocker.resolve("done");
    await first;
    await flushTasks();
    expect(run).not.toHaveBeenCalled();
  });

  it("acquire 往返期间超时只释放晚到许可而不执行任务", async () => {
    const acquisition =
      deferred<
        Awaited<ReturnType<ImageGenerationConcurrencyCoordinator["acquire"]>>
      >();
    const releasedLeaseIds: string[] = [];
    const runWithLease: ImageGenerationConcurrencyCoordinator["runWithLease"] =
      async <T>(
        lease: ImageGenerationConcurrencyLease,
        run: (signal: AbortSignal) => Promise<T>
      ) => {
        releasedLeaseIds.push(lease.leaseId);
        return await run(new AbortController().signal);
      };
    const queue = createQueue({
      acquire: async () => await acquisition.promise,
      runWithLease,
    });
    const run = vi.fn(async () => "unexpected");
    const waiting = queue(
      {
        userId: "user",
        priority: "normal",
        userConcurrency: 1,
        timeoutMs: 10,
      },
      run
    );

    await expect(waiting).rejects.toThrow(/queue is busy/i);
    acquisition.resolve({
      acquired: true,
      lease: { leaseId: "late", taskId: "task", userId: "user" },
    });
    await flushTasks();

    expect(run).not.toHaveBeenCalled();
    expect(releasedLeaseIds).toEqual(["late"]);
  });
});
