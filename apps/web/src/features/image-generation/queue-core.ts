/**
 * 图像生成本地等待队列核心。
 *
 * 职责：在单个副本内按套餐优先级/FIFO 排序等待请求，并通过注入的分布式协调器
 * 获取集群级用户与全局许可。闭包任务不可序列化，因此只在当前请求进程执行。
 */

import type { QueuePriority } from "@repo/shared/config/subscription-plan";

export type ImageGenerationConcurrencyBlockReason =
  | "user_limit"
  | "global_limit";

export type ImageGenerationConcurrencyLease = {
  leaseId: string;
  taskId: string;
  userId: string;
};

export type ImageGenerationConcurrencyCoordinator = {
  acquire: (input: {
    taskId: string;
    userId: string;
    userConcurrency: number;
    globalConcurrency: number;
  }) => Promise<
    | { acquired: true; lease: ImageGenerationConcurrencyLease }
    | { acquired: false; reason: ImageGenerationConcurrencyBlockReason }
  >;
  runWithLease: <T>(
    lease: ImageGenerationConcurrencyLease,
    run: (signal: AbortSignal) => Promise<T>
  ) => Promise<T>;
};

type QueueTask<T> = {
  id: number;
  taskId: string;
  userId: string;
  priority: QueuePriority;
  userConcurrency: number;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  run: (signal: AbortSignal) => Promise<T>;
  blockedReason?: ImageGenerationConcurrencyBlockReason;
  timeout?: ReturnType<typeof setTimeout>;
};

export type ImageGenerationQueueDependencies = {
  coordinator: ImageGenerationConcurrencyCoordinator;
  getGlobalConcurrency: () => Promise<number>;
  getQueueTimeoutMs: () => number;
  createTaskId: () => string;
  pollIntervalMs?: number;
};

const PRIORITY_WEIGHT: Record<QueuePriority, number> = {
  normal: 0,
  priority: 1,
  highest: 2,
};

/** 将秒数格式化为面向外部 API 错误的稳定时长文本。 */
function formatDuration(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60} minute(s)`;
  return `${seconds} second(s)`;
}

/**
 * 构造排队超时错误。
 *
 * 使用协调器最近一次阻塞原因区分用户套餐并发与全局繁忙；未完成首次领取时保守按
 * 全局繁忙返回。函数无副作用。
 */
function getQueuedTaskTimeoutError(
  task: Pick<QueueTask<unknown>, "userConcurrency" | "blockedReason">,
  timeoutMs: number
): Error {
  const timeoutSeconds = Math.ceil(timeoutMs / 1000);
  if (task.blockedReason === "user_limit") {
    return new Error(
      `Image generation concurrency limit reached for this plan. Your plan allows ${task.userConcurrency} concurrent image generation task(s); this queued request waited ${formatDuration(timeoutSeconds)} without a free slot.`
    );
  }
  return new Error(
    `Image generation queue is busy. This queued request waited ${formatDuration(timeoutSeconds)} without a free global slot. Please retry shortly.`
  );
}

/**
 * 创建一个进程内等待队列实例。
 *
 * 队列仅保存不可序列化的 Promise 闭包；真正的运行许可由 coordinator 在数据库中
 * 判定。跨副本只承诺并发上限，不承诺全局优先级全序；优先级/FIFO 在每个副本内成立。
 */
export function createImageGenerationQueue(
  dependencies: ImageGenerationQueueDependencies
) {
  let nextTaskId = 1;
  let scheduling = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const queue: QueueTask<unknown>[] = [];
  const pollIntervalMs = Math.max(25, dependencies.pollIntervalMs ?? 500);

  /** 按优先级降序、同优先级 FIFO 对本副本等待任务排序。 */
  function sortQueue(): void {
    queue.sort((left, right) => {
      const priorityDelta =
        PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
      return priorityDelta || left.id - right.id;
    });
  }

  /** 从等待数组移除任务；任务已启动或已移除时返回 false。 */
  function removeQueuedTask(task: QueueTask<unknown>): boolean {
    const index = queue.indexOf(task);
    if (index === -1) return false;
    queue.splice(index, 1);
    return true;
  }

  /** 安排下一次许可轮询，保证同一队列最多只有一个 poll timer。 */
  function schedulePoll(): void {
    if (pollTimer || queue.length === 0) return;
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      void scheduleQueue();
    }, pollIntervalMs);
    pollTimer.unref?.();
  }

  /**
   * 在已获得集群许可后执行闭包，并在终态后唤醒本副本等待队列。
   *
   * coordinator 负责心跳和 finally 释放；成功值与原异常均透传给请求 Promise。
   */
  function startTask<T>(
    task: QueueTask<T>,
    lease: ImageGenerationConcurrencyLease
  ): void {
    if (task.timeout) clearTimeout(task.timeout);
    dependencies.coordinator
      .runWithLease(lease, task.run)
      .then(task.resolve, task.reject)
      .finally(() => {
        void scheduleQueue();
      });
  }

  /**
   * 尝试按本地优先级为等待任务领取集群许可。
   *
   * 用户槽不足时继续尝试其他用户；全局槽不足意味着本轮无任务可启动，立即停止并
   * 等待轮询。数据库错误 fail-closed，拒绝该任务而不退回进程内并发计数。
   */
  async function scheduleQueue(): Promise<void> {
    if (scheduling) return;
    scheduling = true;
    try {
      sortQueue();
      const globalConcurrency = Math.max(
        1,
        Math.floor(await dependencies.getGlobalConcurrency())
      );

      for (let index = 0; index < queue.length; index += 1) {
        const task = queue[index];
        if (!task) continue;

        let acquisition: Awaited<
          ReturnType<ImageGenerationConcurrencyCoordinator["acquire"]>
        >;
        try {
          acquisition = await dependencies.coordinator.acquire({
            taskId: task.taskId,
            userId: task.userId,
            userConcurrency: task.userConcurrency,
            globalConcurrency,
          });
        } catch (error) {
          queue.splice(index, 1);
          index -= 1;
          if (task.timeout) clearTimeout(task.timeout);
          task.reject(
            new Error("Image generation queue is temporarily unavailable.", {
              cause: error,
            })
          );
          continue;
        }

        if (!acquisition.acquired) {
          task.blockedReason = acquisition.reason;
          if (acquisition.reason === "global_limit") break;
          continue;
        }

        queue.splice(index, 1);
        index -= 1;
        startTask(task, acquisition.lease);
      }
    } finally {
      scheduling = false;
      schedulePoll();
    }
  }

  /**
   * 将一个图像生成闭包加入本副本等待队列。
   *
   * 参数声明用户、优先级、套餐并发和可选超时；返回闭包最终结果。等待期间不创建
   * generation、不扣费，超时则从队列移除并拒绝。
   */
  return async function withImageGenerationQueue<T>(
    options: {
      userId: string;
      priority: QueuePriority;
      userConcurrency: number;
      timeoutMs?: number;
    },
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? dependencies.getQueueTimeoutMs();
      let task: QueueTask<T>;
      task = {
        id: nextTaskId++,
        taskId: dependencies.createTaskId(),
        userId: options.userId,
        priority: options.priority,
        userConcurrency: Math.max(1, Math.floor(options.userConcurrency)),
        resolve,
        reject,
        run,
        timeout: setTimeout(() => {
          if (removeQueuedTask(task as QueueTask<unknown>)) {
            reject(getQueuedTaskTimeoutError(task, timeoutMs));
          }
        }, timeoutMs),
      };

      queue.push(task as QueueTask<unknown>);
      void scheduleQueue();
    });
  };
}
