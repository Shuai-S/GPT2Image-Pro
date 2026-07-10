/**
 * 运维指标 PostgreSQL 快照读取器。
 *
 * 职责：用一个有 2 秒语句上限的 UNION ALL 查询聚合内部任务租约、持久异步任务、
 * callback outbox 与集群生图并发槽位。使用方：/api/metrics 路由。
 * 关键依赖：@repo/database、Drizzle SQL、Zod；不返回行级身份或错误文本。
 */

import { db } from "@repo/database";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { OperationalMetricAggregate } from "./operational-metrics-core";

const countSchema = z.union([z.string(), z.number(), z.bigint()]);
const aggregateRowSchema = z.discriminatedUnion("metric", [
  z.object({
    metric: z.literal("job_status"),
    labelA: z.enum(["running", "success", "error"]),
    labelB: z.null(),
    value: countSchema,
  }),
  z.object({
    metric: z.literal("job_expired"),
    labelA: z.null(),
    labelB: z.null(),
    value: countSchema,
  }),
  z.object({
    metric: z.literal("task_status"),
    labelA: z.enum(["image", "video", "editable_file"]),
    labelB: z.enum(["queued", "running", "completed", "failed"]),
    value: countSchema,
  }),
  z.object({
    metric: z.literal("task_lease_expired"),
    labelA: z.null(),
    labelB: z.null(),
    value: countSchema,
  }),
  z.object({
    metric: z.literal("callback_status"),
    labelA: z.enum([
      "none",
      "waiting",
      "sending",
      "retry",
      "sent",
      "permanent_failed",
    ]),
    labelB: z.null(),
    value: countSchema,
  }),
  z.object({
    metric: z.literal("callback_lease_expired"),
    labelA: z.null(),
    labelB: z.null(),
    value: countSchema,
  }),
  z.object({
    metric: z.literal("slot_state"),
    labelA: z.enum(["global", "user", "invalid"]),
    labelB: z.enum(["free", "leased", "expired", "invalid"]),
    value: countSchema,
  }),
]);

type AggregateRow = z.infer<typeof aggregateRowSchema>;

/**
 * 统一读取 node-postgres 与 Neon execute() 的行数组。
 *
 * @param result 驱动返回的不可信值。
 * @returns 未校验行数组；结构不匹配时抛出，路由统一返回 503。
 */
function extractRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown } | undefined)?.rows;
  if (!Array.isArray(rows)) {
    throw new Error("Operational metrics query returned an invalid result");
  }
  return rows;
}

/**
 * 把 PostgreSQL count 值收窄为 Prometheus 可编码的非负安全整数。
 *
 * @param value 驱动可能返回的 string、number 或 bigint。
 * @returns 非负安全整数；溢出、负值或非整数时抛出，防止发布失真指标。
 */
function normalizeCount(value: string | number | bigint): number {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error("Operational metrics query returned an invalid count");
  }
  return normalized;
}

/**
 * 把受校验数据库行映射成公开聚合契约。
 *
 * @param row 通过判别联合 schema 的数据库行。
 * @returns 仅含固定标签与计数的指标聚合；无副作用。
 */
function toAggregate(row: AggregateRow): OperationalMetricAggregate {
  const value = normalizeCount(row.value);
  switch (row.metric) {
    case "job_status":
      return { metric: row.metric, status: row.labelA, value };
    case "job_expired":
    case "task_lease_expired":
    case "callback_lease_expired":
      return { metric: row.metric, value };
    case "task_status":
      return {
        metric: row.metric,
        taskType: row.labelA,
        status: row.labelB,
        value,
      };
    case "callback_status":
      return { metric: row.metric, status: row.labelA, value };
    case "slot_state":
      return {
        metric: row.metric,
        scope: row.labelA,
        state: row.labelB,
        value,
      };
  }
}

/**
 * 读取当前队列与租约指标快照。
 *
 * @returns 所有固定状态（包括零值）的聚合数组。
 * @sideEffects 开启一个只包含超时设置和聚合 SELECT 的短数据库事务。
 * @throws 数据库超时、连接失败或返回值不符合 schema 时显式抛出。
 */
export async function readOperationalMetrics(): Promise<
  OperationalMetricAggregate[]
> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
    return await tx.execute(sql`
      WITH
      job_statuses("status") AS (
        VALUES ('running'::text), ('success'::text), ('error'::text)
      ),
      task_statuses("task_type", "status") AS (
        SELECT "task_type", "status"
        FROM (VALUES
          ('image'::text), ('video'::text), ('editable_file'::text)
        ) AS task_types("task_type")
        CROSS JOIN (VALUES
          ('queued'::text), ('running'::text),
          ('completed'::text), ('failed'::text)
        ) AS statuses("status")
      ),
      callback_statuses("status") AS (
        VALUES
          ('none'::text), ('waiting'::text), ('sending'::text),
          ('retry'::text), ('sent'::text), ('permanent_failed'::text)
      ),
      slot_states("scope", "state") AS (
        SELECT "scope", "state"
        FROM (VALUES
          ('global'::text), ('user'::text), ('invalid'::text)
        ) AS scopes("scope")
        CROSS JOIN (VALUES
          ('free'::text), ('leased'::text),
          ('expired'::text), ('invalid'::text)
        ) AS states("state")
      ),
      normalized_slots AS (
        SELECT
          CASE
            WHEN "scope" IN ('global', 'user') THEN "scope"
            ELSE 'invalid'
          END AS "scope",
          CASE
            WHEN "lease_id" IS NULL THEN 'free'
            WHEN "lease_expires_at" IS NULL THEN 'invalid'
            WHEN "lease_expires_at" <= now() THEN 'expired'
            ELSE 'leased'
          END AS "state"
        FROM "image_generation_concurrency_slot"
      )
      SELECT
        'job_status'::text AS "metric",
        statuses."status" AS "labelA",
        NULL::text AS "labelB",
        count(leases."job_name") AS "value"
      FROM job_statuses AS statuses
      LEFT JOIN "internal_job_lease" AS leases
        ON leases."status" = statuses."status"
      GROUP BY statuses."status"

      UNION ALL

      SELECT
        'job_expired', NULL, NULL, count(*)
      FROM "internal_job_lease"
      WHERE "status" = 'running' AND "lease_expires_at" <= now()

      UNION ALL

      SELECT
        'task_status', statuses."task_type", statuses."status", count(tasks."id")
      FROM task_statuses AS statuses
      LEFT JOIN "external_async_task" AS tasks
        ON tasks."task_type" = statuses."task_type"
        AND tasks."status" = statuses."status"
      GROUP BY statuses."task_type", statuses."status"

      UNION ALL

      SELECT
        'task_lease_expired', NULL, NULL, count(*)
      FROM "external_async_task"
      WHERE "status" = 'running' AND "lease_expires_at" <= now()

      UNION ALL

      SELECT
        'callback_status', statuses."status", NULL, count(tasks."id")
      FROM callback_statuses AS statuses
      LEFT JOIN "external_async_task" AS tasks
        ON tasks."callback_status" = statuses."status"
      GROUP BY statuses."status"

      UNION ALL

      SELECT
        'callback_lease_expired', NULL, NULL, count(*)
      FROM "external_async_task"
      WHERE "callback_status" = 'sending'
        AND "callback_lease_expires_at" <= now()

      UNION ALL

      SELECT
        'slot_state', states."scope", states."state", count(slots."scope")
      FROM slot_states AS states
      LEFT JOIN normalized_slots AS slots
        ON slots."scope" = states."scope" AND slots."state" = states."state"
      GROUP BY states."scope", states."state"
    `);
  });

  return aggregateRowSchema.array().parse(extractRows(result)).map(toAggregate);
}
