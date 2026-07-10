/**
 * 内部任务统一执行入口。
 *
 * 职责：维护任务目录与运行间隔，在 PostgreSQL 可恢复租约下通过 UOL 网关执行
 * operation。内置定时器和外部 Cron 都必须调用本模块，确保跨副本单飞。
 */

import {
  getRuntimeSettingNumber,
} from "@repo/shared/system-settings";
import { invokeOperation } from "@repo/shared/uol";

import { executeInternalJobWithLease } from "./internal-job-lease";
import { ensureUolInitialized } from "./uol-init";

export type InternalJobName =
  | "images-maintenance"
  | "credits-expire"
  | "referral-thaw"
  | "web-accounts-refresh"
  | "web-accounts-replenish"
  | "sub2api-sync";

type InternalJobDefinition = {
  name: InternalJobName;
  operationName:
    | "image.runMaintenance"
    | "credits.runExpireJob"
    | "referral.thawCommissions"
    | "pool.cronRefreshStale"
    | "pool.cronWebAccountsReplenish"
    | "pool.cronSub2ApiSync";
  intervalSettingKey:
    | "INTERNAL_JOB_IMAGES_MAINTENANCE_INTERVAL_MINUTES"
    | "INTERNAL_JOB_CREDITS_EXPIRE_INTERVAL_MINUTES"
    | "INTERNAL_JOB_REFERRAL_THAW_INTERVAL_MINUTES"
    | "INTERNAL_JOB_WEB_ACCOUNTS_REFRESH_INTERVAL_MINUTES"
    | "INTERNAL_JOB_WEB_ACCOUNTS_REPLENISH_INTERVAL_MINUTES"
    | "INTERNAL_JOB_SUB2API_SYNC_INTERVAL_MINUTES";
  defaultIntervalMinutes: number;
  initialDelayMs: number;
};

const MINUTE_MS = 60 * 1000;

export const INTERNAL_JOBS: readonly InternalJobDefinition[] = [
  {
    name: "images-maintenance",
    operationName: "image.runMaintenance",
    intervalSettingKey: "INTERNAL_JOB_IMAGES_MAINTENANCE_INTERVAL_MINUTES",
    defaultIntervalMinutes: 5,
    initialDelayMs: 30_000,
  },
  {
    name: "credits-expire",
    operationName: "credits.runExpireJob",
    intervalSettingKey: "INTERNAL_JOB_CREDITS_EXPIRE_INTERVAL_MINUTES",
    defaultIntervalMinutes: 24 * 60,
    initialDelayMs: 60_000,
  },
  {
    name: "referral-thaw",
    operationName: "referral.thawCommissions",
    intervalSettingKey: "INTERNAL_JOB_REFERRAL_THAW_INTERVAL_MINUTES",
    defaultIntervalMinutes: 60,
    initialDelayMs: 75_000,
  },
  {
    name: "web-accounts-refresh",
    operationName: "pool.cronRefreshStale",
    intervalSettingKey: "INTERNAL_JOB_WEB_ACCOUNTS_REFRESH_INTERVAL_MINUTES",
    defaultIntervalMinutes: 10,
    initialDelayMs: 90_000,
  },
  {
    name: "sub2api-sync",
    operationName: "pool.cronSub2ApiSync",
    intervalSettingKey: "INTERNAL_JOB_SUB2API_SYNC_INTERVAL_MINUTES",
    defaultIntervalMinutes: 10,
    initialDelayMs: 120_000,
  },
  {
    name: "web-accounts-replenish",
    operationName: "pool.cronWebAccountsReplenish",
    intervalSettingKey: "INTERNAL_JOB_WEB_ACCOUNTS_REPLENISH_INTERVAL_MINUTES",
    defaultIntervalMinutes: 15,
    initialDelayMs: 150_000,
  },
] as const;

/**
 * 按稳定任务名获取定义。
 *
 * 未知任务名表示编程错误并立即抛出，避免绕过租约调用错误 operation。
 */
export function getInternalJob(name: InternalJobName): InternalJobDefinition {
  const job = INTERNAL_JOBS.find((candidate) => candidate.name === name);
  if (!job) throw new Error(`Unknown internal job: ${name}`);
  return job;
}

/**
 * 读取任务当前调度间隔并转换为毫秒。
 *
 * 非正配置由 system-settings 回退默认值；最终至少一分钟，防止错误配置形成紧循环。
 */
export async function getInternalJobIntervalMs(
  job: InternalJobDefinition
): Promise<number> {
  const minutes = await getRuntimeSettingNumber(
    job.intervalSettingKey,
    job.defaultIntervalMinutes,
    { positive: true }
  );
  return Math.max(1, Math.trunc(minutes)) * MINUTE_MS;
}

/**
 * 在分布式租约下调用任务对应的 UOL operation。
 *
 * scheduled 模式尊重全局 start-to-start 间隔；manual 模式绕过间隔但仍不能抢占活跃
 * 租约。Sub2API force 只传给业务 operation，不能绕过租约互斥。
 */
export async function runInternalJob<T = Record<string, unknown>>(
  name: InternalJobName,
  options?: {
    mode?: "scheduled" | "manual";
    input?: Record<string, unknown>;
  }
) {
  const job = getInternalJob(name);
  const intervalMs = await getInternalJobIntervalMs(job);
  await ensureUolInitialized();
  return await executeInternalJobWithLease<T>({
    jobName: job.name,
    intervalMs,
    mode: options?.mode ?? "scheduled",
    run: async () =>
      await invokeOperation<T>(
        job.operationName,
        options?.input ?? {},
        { type: "cron", job: job.name }
      ),
  });
}
