/**
 * 内部任务租约编排核心。
 *
 * 本文件只定义状态机、心跳与 fencing 行为，不依赖数据库，供 PostgreSQL 适配器和
 * DB-free 单元测试复用。调用方负责提供原子租约存储与稳定的进程 ownerId。
 */

export type InternalJobLeaseSkipReason =
  | "already_running"
  | "interval_not_reached";

export type InternalJobLeaseAcquireInput = {
  jobName: string;
  ownerId: string;
  runId: string;
  intervalMs: number;
  leaseTtlMs: number;
  mode: "scheduled" | "manual";
};

export type InternalJobLeaseToken = {
  jobName: string;
  ownerId: string;
  runId: string;
};

export type InternalJobLeaseAcquireResult =
  | {
      acquired: true;
      leaseExpiresAt: Date;
    }
  | {
      acquired: false;
      reason: InternalJobLeaseSkipReason;
      retryAt?: Date;
    };

export type InternalJobLeaseStore = {
  acquire: (
    input: InternalJobLeaseAcquireInput
  ) => Promise<InternalJobLeaseAcquireResult>;
  heartbeat: (
    token: InternalJobLeaseToken,
    leaseTtlMs: number
  ) => Promise<boolean>;
  finalize: (
    token: InternalJobLeaseToken,
    outcome:
      | { status: "success" }
      | { status: "error"; error: string }
  ) => Promise<boolean>;
};

export type LeasedJobExecutionResult<T> =
  | {
      executed: true;
      result: T;
      leaseLost: boolean;
    }
  | {
      executed: false;
      reason: InternalJobLeaseSkipReason;
      retryAt?: Date;
    };

export type ExecuteLeasedJobInput<T> = {
  jobName: string;
  intervalMs: number;
  leaseTtlMs: number;
  heartbeatIntervalMs: number;
  mode: "scheduled" | "manual";
  run: () => Promise<T>;
};

export type ExecuteLeasedJobDependencies = {
  store: InternalJobLeaseStore;
  ownerId: string;
  createRunId: () => string;
  onHeartbeatError?: (error: unknown) => void;
  onLeaseLost?: () => void;
  onFinalizeError?: (error: unknown) => void;
};

/**
 * 将未知异常压缩为可持久化的有限长度文本。
 *
 * 参数为任务抛出的任意值；返回最多 2,000 字符，不包含额外副作用。非 Error 值
 * 使用稳定兜底文案，避免把不可控对象序列化进数据库或日志。
 */
export function describeInternalJobError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.slice(0, 2_000);
}

/**
 * 启动单个租约的递归心跳，并返回幂等停止函数。
 *
 * 心跳使用递归 setTimeout，保证慢数据库请求不会与下一次续租重叠。续租返回 false
 * 表示 fencing token 已失效，后续不再尝试；数据库异常只记录并等待自然过期。
 */
function startHeartbeat(
  token: InternalJobLeaseToken,
  input: ExecuteLeasedJobInput<unknown>,
  dependencies: ExecuteLeasedJobDependencies,
  markLeaseLost: () => void
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void heartbeat();
    }, input.heartbeatIntervalMs);
    timer.unref?.();
  };

  const heartbeat = async () => {
    if (stopped) return;
    try {
      const renewed = await dependencies.store.heartbeat(
        token,
        input.leaseTtlMs
      );
      if (!renewed) {
        markLeaseLost();
        return;
      }
    } catch (error) {
      dependencies.onHeartbeatError?.(error);
    }
    schedule();
  };

  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/**
 * 在可恢复分布式租约下执行一个后台任务。
 *
 * 抢租约与终态写入由存储适配器以短语句完成，任务主体始终在事务外运行。成功和
 * 失败终态都带 ownerId + runId fencing；旧执行者晚到时只能得到 leaseLost，不能
 * 覆盖新执行。任务异常会在尽力持久化失败状态后原样上抛。
 */
export async function executeLeasedJob<T>(
  input: ExecuteLeasedJobInput<T>,
  dependencies: ExecuteLeasedJobDependencies
): Promise<LeasedJobExecutionResult<T>> {
  const token = {
    jobName: input.jobName,
    ownerId: dependencies.ownerId,
    runId: dependencies.createRunId(),
  } satisfies InternalJobLeaseToken;
  const acquisition = await dependencies.store.acquire({
    ...token,
    intervalMs: input.intervalMs,
    leaseTtlMs: input.leaseTtlMs,
    mode: input.mode,
  });
  if (!acquisition.acquired) {
    return {
      executed: false,
      reason: acquisition.reason,
      retryAt: acquisition.retryAt,
    };
  }

  let leaseLost = false;
  const markLeaseLost = () => {
    if (leaseLost) return;
    leaseLost = true;
    dependencies.onLeaseLost?.();
  };
  const stopHeartbeat = startHeartbeat(
    token,
    input,
    dependencies,
    markLeaseLost
  );

  try {
    const result = await input.run();
    stopHeartbeat();
    try {
      const finalized = await dependencies.store.finalize(token, {
        status: "success",
      });
      if (!finalized) markLeaseLost();
    } catch (error) {
      markLeaseLost();
      dependencies.onFinalizeError?.(error);
    }
    return { executed: true, result, leaseLost };
  } catch (error) {
    stopHeartbeat();
    try {
      const finalized = await dependencies.store.finalize(token, {
        status: "error",
        error: describeInternalJobError(error),
      });
      if (!finalized) markLeaseLost();
    } catch (finalizeError) {
      markLeaseLost();
      dependencies.onFinalizeError?.(finalizeError);
    }
    throw error;
  }
}
