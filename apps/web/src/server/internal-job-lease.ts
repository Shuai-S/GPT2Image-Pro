/**
 * 内部任务 PostgreSQL 租约适配器。
 *
 * 使用 internal_job_lease 表提供原子抢租约、心跳续租和带 fencing token 的终态
 * 写入。内置调度器与外部 Cron 必须共同经过本模块，避免跨入口重复执行。
 */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { db, internalJobLease } from "@repo/database";
import { createContextLogger } from "@repo/shared/logger";
import { eq, sql } from "drizzle-orm";

import {
  executeLeasedJob,
  type ExecuteLeasedJobInput,
  type InternalJobLeaseAcquireInput,
  type InternalJobLeaseAcquireResult,
  type InternalJobLeaseStore,
  type InternalJobLeaseToken,
  type LeasedJobExecutionResult,
} from "./internal-job-lease-core";

const DEFAULT_LEASE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1000;
const PROCESS_OWNER_ID = `${hostname()}:${process.pid}:${randomUUID()}`;

/**
 * 从 Drizzle 的 node-postgres 或 Neon 执行结果读取首行。
 *
 * 两种驱动的 execute() 返回结构不同；本函数只接受 unknown 并安全收窄，无法识别时
 * 返回 undefined，不会抛出或修改结果。
 */
function firstRow(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) {
    const row = result[0];
    return typeof row === "object" && row !== null
      ? (row as Record<string, unknown>)
      : undefined;
  }
  const rows = (result as { rows?: unknown[] } | undefined)?.rows;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return typeof row === "object" && row !== null
    ? (row as Record<string, unknown>)
    : undefined;
}

/**
 * 将数据库时间值安全收窄为有效 Date。
 *
 * 接受 Date、字符串或数字；无效值返回 undefined，调用方据此省略非关键 retryAt。
 */
function readDate(value: unknown): Date | undefined {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : undefined;
  return date && Number.isFinite(date.getTime()) ? date : undefined;
}

/**
 * 原子抢占指定任务租约。
 *
 * 首次创建、终态达到调度间隔或 running 租约过期时可获得租约。ON CONFLICT 的
 * WHERE 在 PostgreSQL 内完成竞争裁决；未获得时再读一次当前行，仅用于返回跳过原因。
 */
async function acquireLease(
  input: InternalJobLeaseAcquireInput
): Promise<InternalJobLeaseAcquireResult> {
  const result = await db.execute(sql`
    INSERT INTO "internal_job_lease" (
      "job_name",
      "owner_id",
      "run_id",
      "status",
      "lease_expires_at",
      "heartbeat_at",
      "last_started_at",
      "last_finished_at",
      "last_error",
      "created_at",
      "updated_at"
    ) VALUES (
      ${input.jobName},
      ${input.ownerId},
      ${input.runId},
      'running',
      now() + (${input.leaseTtlMs} * interval '1 millisecond'),
      now(),
      now(),
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT ("job_name") DO UPDATE SET
      "owner_id" = EXCLUDED."owner_id",
      "run_id" = EXCLUDED."run_id",
      "status" = 'running',
      "lease_expires_at" = EXCLUDED."lease_expires_at",
      "heartbeat_at" = EXCLUDED."heartbeat_at",
      "last_started_at" = EXCLUDED."last_started_at",
      "last_finished_at" = NULL,
      "last_error" = NULL,
      "updated_at" = now()
    WHERE (
      "internal_job_lease"."status" = 'running'
      AND "internal_job_lease"."lease_expires_at" <= now()
    ) OR (
      "internal_job_lease"."status" <> 'running'
      AND (
        ${input.mode === "manual"}
        OR "internal_job_lease"."last_started_at"
          <= now() - (${input.intervalMs} * interval '1 millisecond')
      )
    )
    RETURNING "lease_expires_at"
  `);
  const acquiredAt = readDate(firstRow(result)?.lease_expires_at);
  if (acquiredAt) {
    return { acquired: true, leaseExpiresAt: acquiredAt };
  }

  const [current] = await db
    .select({
      status: internalJobLease.status,
      leaseExpiresAt: internalJobLease.leaseExpiresAt,
      lastStartedAt: internalJobLease.lastStartedAt,
    })
    .from(internalJobLease)
    .where(eq(internalJobLease.jobName, input.jobName))
    .limit(1);
  if (current?.status === "running") {
    return {
      acquired: false,
      reason: "already_running",
      retryAt: current.leaseExpiresAt,
    };
  }
  return {
    acquired: false,
    reason: "interval_not_reached",
    retryAt: current
      ? new Date(current.lastStartedAt.getTime() + input.intervalMs)
      : undefined,
  };
}

/**
 * 续租仍由当前 fencing token 持有且尚未过期的 running 租约。
 *
 * 已过期租约不能被旧 owner 复活；返回 false 表示租约已丢失或被新执行者接管。
 */
async function heartbeatLease(
  token: InternalJobLeaseToken,
  leaseTtlMs: number
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE "internal_job_lease"
    SET
      "heartbeat_at" = now(),
      "lease_expires_at" = now() + (${leaseTtlMs} * interval '1 millisecond'),
      "updated_at" = now()
    WHERE "job_name" = ${token.jobName}
      AND "owner_id" = ${token.ownerId}
      AND "run_id" = ${token.runId}
      AND "status" = 'running'
      AND "lease_expires_at" > now()
    RETURNING "job_name"
  `);
  return Boolean(firstRow(result)?.job_name);
}

/**
 * 用当前 fencing token 写入任务成功或失败终态。
 *
 * 仅 running 且 token 完全匹配时更新；旧执行者晚到会返回 false。成功会刷新
 * last_success_at，失败保留上次成功时间并记录有限长度错误文本。
 */
async function finalizeLease(
  token: InternalJobLeaseToken,
  outcome: { status: "success" } | { status: "error"; error: string }
): Promise<boolean> {
  const lastError = outcome.status === "error" ? outcome.error : null;
  const result = await db.execute(sql`
    UPDATE "internal_job_lease"
    SET
      "status" = ${outcome.status},
      "lease_expires_at" = now(),
      "last_finished_at" = now(),
      "last_success_at" = CASE
        WHEN ${outcome.status} = 'success' THEN now()
        ELSE "last_success_at"
      END,
      "last_error" = ${lastError},
      "updated_at" = now()
    WHERE "job_name" = ${token.jobName}
      AND "owner_id" = ${token.ownerId}
      AND "run_id" = ${token.runId}
      AND "status" = 'running'
    RETURNING "job_name"
  `);
  return Boolean(firstRow(result)?.job_name);
}

export const postgresInternalJobLeaseStore: InternalJobLeaseStore = {
  acquire: acquireLease,
  heartbeat: heartbeatLease,
  finalize: finalizeLease,
};

/**
 * 使用生产 PostgreSQL 租约执行一个内部任务。
 *
 * 调用方提供任务名、间隔、模式和任务函数；本函数注入进程 ownerId、随机 runId、
 * 默认 TTL/心跳及结构化日志。任务函数在任何数据库事务之外运行。
 */
export async function executeInternalJobWithLease<T>(
  input: Omit<
    ExecuteLeasedJobInput<T>,
    "leaseTtlMs" | "heartbeatIntervalMs"
  > & {
    leaseTtlMs?: number;
    heartbeatIntervalMs?: number;
  }
): Promise<LeasedJobExecutionResult<T>> {
  const log = createContextLogger({
    component: "internal-job-lease",
    job: input.jobName,
  });
  return await executeLeasedJob(
    {
      ...input,
      leaseTtlMs: input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
      heartbeatIntervalMs:
        input.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    },
    {
      store: postgresInternalJobLeaseStore,
      ownerId: PROCESS_OWNER_ID,
      createRunId: randomUUID,
      onHeartbeatError: (error) => {
        log.warn({ err: error }, "Internal job heartbeat failed");
      },
      onLeaseLost: () => {
        log.warn("Internal job lease was lost before completion");
      },
      onFinalizeError: (error) => {
        log.error({ err: error }, "Internal job finalization failed");
      },
    }
  );
}
