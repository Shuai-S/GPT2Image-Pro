/**
 * 内置后台任务定时器。
 *
 * 职责：在单个进程内安排任务 tick；跨副本互斥、恢复与 UOL 调用统一委托给
 * internal-job-runner。定时器本身不持有数据库事务或连接。
 */

import { createContextLogger } from "@repo/shared/logger";
import { getRuntimeSettingBoolean } from "@repo/shared/system-settings";

import {
  getInternalJobIntervalMs,
  INTERNAL_JOBS,
  runInternalJob,
} from "./internal-job-runner";

type SchedulerState = {
  started: boolean;
};

type SchedulerGlobal = typeof globalThis & {
  __gpt2imageInternalJobScheduler?: SchedulerState;
};

const schedulerGlobal = globalThis as SchedulerGlobal;
const log = createContextLogger({ component: "internal-job-scheduler" });

/**
 * 获取进程级调度状态。
 *
 * globalThis 只防止开发热重载或重复 instrumentation 在同一进程安装重复定时器；
 * 跨副本互斥由数据库租约负责。
 */
function getSchedulerState(): SchedulerState {
  if (!schedulerGlobal.__gpt2imageInternalJobScheduler) {
    schedulerGlobal.__gpt2imageInternalJobScheduler = { started: false };
  }
  return schedulerGlobal.__gpt2imageInternalJobScheduler;
}

/**
 * 执行一次已到时的任务 tick。
 *
 * 未获得租约或全局间隔未到均为正常跳过；任务错误被记录后留给下一 tick 重试，
 * 不产生未处理 Promise。
 */
async function runJob(job: (typeof INTERNAL_JOBS)[number]): Promise<void> {
  const enabled = await getRuntimeSettingBoolean(
    "INTERNAL_JOB_SCHEDULER_ENABLED",
    true
  );
  if (!enabled) return;

  const startedAt = Date.now();
  try {
    const execution = await runInternalJob(job.name, { mode: "scheduled" });
    if (!execution.executed) return;
    log.info(
      {
        job: job.name,
        durationMs: Date.now() - startedAt,
        leaseLost: execution.leaseLost,
      },
      "Internal job completed"
    );
  } catch (error) {
    log.warn({ err: error, job: job.name }, "Internal job failed");
  }
}

/**
 * 为单个任务安装完成后再调度的递归定时器。
 *
 * running 防止同进程重入；跨进程竞争仍由数据库租约判定。读取间隔失败时回退任务
 * 默认值，确保调度循环持续但不会形成紧循环。
 */
async function scheduleJob(
  job: (typeof INTERNAL_JOBS)[number]
): Promise<void> {
  let running = false;

  const scheduleNext = (delayMs: number) => {
    const timer = setTimeout(() => {
      void tick();
    }, delayMs);
    timer.unref?.();
  };

  const tick = async () => {
    if (!running) {
      running = true;
      try {
        await runJob(job);
      } finally {
        running = false;
      }
    }

    try {
      scheduleNext(await getInternalJobIntervalMs(job));
    } catch (error) {
      log.warn(
        { err: error, job: job.name },
        "Internal job interval lookup failed"
      );
      scheduleNext(job.defaultIntervalMinutes * 60 * 1000);
    }
  };

  scheduleNext(job.initialDelayMs);
}

/**
 * 启动所有内置后台任务定时器。
 *
 * 测试和生产构建阶段不启动；关闭开关或初始化失败时保持可重试状态。成功后同进程
 * 重复调用无副作用。
 */
export async function startInternalJobScheduler(): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const state = getSchedulerState();
  if (state.started) return;

  try {
    const enabled = await getRuntimeSettingBoolean(
      "INTERNAL_JOB_SCHEDULER_ENABLED",
      true
    );
    if (!enabled) return;

    state.started = true;
    await Promise.all(INTERNAL_JOBS.map((job) => scheduleJob(job)));
    log.info("Internal job scheduler started");
  } catch (error) {
    state.started = false;
    log.warn({ err: error }, "Internal job scheduler failed to start");
  }
}
