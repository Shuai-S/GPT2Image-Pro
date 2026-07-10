/**
 * 外部 API 异步任务 PostgreSQL 存储。
 *
 * 职责：持久化 task_* 外壳、终态结果和 callback outbox，使轮询与回调在重启和多
 * 副本下可恢复。普通 image/video 与 PPT/PSD worker 的领取、心跳和 fencing 终态均
 * 复用同一张表，但分别领取各自 task_type，避免相互误消费。
 */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { db, externalAsyncTask } from "@repo/database";
import { and, eq, inArray, sql } from "drizzle-orm";

export type ExternalAsyncTaskRow = typeof externalAsyncTask.$inferSelect;

const CALLBACK_LEASE_TTL_MS = 60 * 1000;
const TASK_LEASE_TTL_MS = 2 * 60 * 1000;
const LEGACY_NULL_LEASE_GRACE_MS = 20 * 60 * 1000;
const PROCESS_OWNER_ID = `${hostname()}:${process.pid}:${randomUUID()}`;

/**
 * 插入一个外部异步任务外壳。
 *
 * 调用方必须提供已校验的用户归属和公开初始字段；返回已提交的数据库行。
 */
export async function createExternalAsyncTask(input: {
  id: string;
  taskType: "image" | "video" | "editable_file";
  objectType: string;
  userId: string;
  apiKeyId?: string;
  kind?: "ppt" | "psd";
  model?: string;
  clientRequestId?: string;
  requestHash?: string;
  status: "queued" | "running";
  priority?: number;
  userConcurrency?: number;
  maxAttempts?: number;
  initialPayload: Record<string, unknown>;
  requestPayload?: Record<string, unknown>;
  callbackUrl?: string;
}): Promise<ExternalAsyncTaskRow> {
  const [row] = await db
    .insert(externalAsyncTask)
    .values({
      id: input.id,
      taskType: input.taskType,
      objectType: input.objectType,
      userId: input.userId,
      apiKeyId: input.apiKeyId,
      kind: input.kind,
      model: input.model,
      clientRequestId: input.clientRequestId,
      requestHash: input.requestHash,
      status: input.status,
      priority: input.priority ?? 0,
      userConcurrency: input.userConcurrency ?? 1,
      maxAttempts: input.maxAttempts ?? 3,
      initialPayload: input.initialPayload,
      requestPayload: input.requestPayload,
      callbackUrl: input.callbackUrl,
      callbackStatus: input.callbackUrl ? "waiting" : "none",
      availableAt: sql`now()`,
      startedAt: input.status === "running" ? sql`now()` : undefined,
    })
    .returning();
  if (!row) throw new Error("Failed to persist external async task");
  return row;
}

/** 按 task id 读取一条持久异步任务；不存在时返回 undefined。 */
export async function getExternalAsyncTask(
  id: string
): Promise<ExternalAsyncTaskRow | undefined> {
  const [row] = await db
    .select()
    .from(externalAsyncTask)
    .where(eq(externalAsyncTask.id, id))
    .limit(1);
  return row;
}

/**
 * 写入普通 image/video fire-and-forget 任务的成功或失败终态。
 *
 * 结果与错误分列存储，callback_url 存在时把 outbox 置 waiting；重复完成会覆盖为相同
 * 终态，不修改用户归属或请求载荷。
 */
export async function completeExternalAsyncTask(input: {
  id: string;
  objectType: string;
  resultPayload?: unknown;
  errorPayload?: unknown;
}): Promise<ExternalAsyncTaskRow | undefined> {
  const [row] = await db
    .update(externalAsyncTask)
    .set({
      objectType: input.objectType,
      status: input.errorPayload === undefined ? "completed" : "failed",
      resultPayload:
        input.errorPayload === undefined ? input.resultPayload : null,
      errorPayload: input.errorPayload ?? null,
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
      callbackStatus: sql`CASE
        WHEN ${externalAsyncTask.callbackUrl} IS NULL THEN 'none'
        ELSE 'waiting'
      END`,
      callbackNextAt: sql`CASE
        WHEN ${externalAsyncTask.callbackUrl} IS NULL THEN NULL
        ELSE now()
      END`,
    })
    .where(
      and(
        eq(externalAsyncTask.id, input.id),
        inArray(externalAsyncTask.status, ["queued", "running"])
      )
    )
    .returning();
  return row;
}

/**
 * 领取一条待投递 callback outbox。
 *
 * 使用 SKIP LOCKED 支持多副本并发；sending 租约过期后可接管。返回的 callback token
 * 是 fencing token，后续成功/失败写入必须匹配。
 */
export async function claimExternalAsyncCallback(): Promise<
  { row: ExternalAsyncTaskRow; callbackToken: string } | undefined
> {
  const callbackToken = randomUUID();
  return await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT "id"
      FROM "external_async_task"
      WHERE "callback_url" IS NOT NULL
        AND "status" IN ('completed', 'failed')
        AND (
          (
            "callback_status" IN ('waiting', 'retry')
            AND coalesce("callback_next_at", now()) <= now()
          ) OR (
            "callback_status" = 'sending'
            AND "callback_lease_expires_at" <= now()
          )
        )
      ORDER BY "callback_next_at" NULLS FIRST, "completed_at", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const rows = Array.isArray(result)
      ? result
      : (result as { rows?: unknown[] }).rows;
    const id =
      Array.isArray(rows) &&
      typeof rows[0] === "object" &&
      rows[0] !== null &&
      typeof (rows[0] as Record<string, unknown>).id === "string"
        ? ((rows[0] as Record<string, unknown>).id as string)
        : undefined;
    if (!id) return undefined;

    const [row] = await tx
      .update(externalAsyncTask)
      .set({
        callbackStatus: "sending",
        callbackLeaseOwner: PROCESS_OWNER_ID,
        callbackLeaseToken: callbackToken,
        callbackLeaseExpiresAt: sql`now() + (${CALLBACK_LEASE_TTL_MS} * interval '1 millisecond')`,
        callbackAttempts: sql`${externalAsyncTask.callbackAttempts} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(externalAsyncTask.id, id))
      .returning();
    return row ? { row, callbackToken } : undefined;
  });
}

/** 用 callback fencing token 标记 outbox 已投递。 */
export async function completeExternalAsyncCallback(
  id: string,
  callbackToken: string
): Promise<boolean> {
  const [row] = await db
    .update(externalAsyncTask)
    .set({
      callbackStatus: "sent",
      callbackDeliveredAt: sql`now()`,
      callbackLeaseOwner: null,
      callbackLeaseToken: null,
      callbackLeaseExpiresAt: null,
      callbackError: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(externalAsyncTask.id, id),
        eq(externalAsyncTask.callbackLeaseOwner, PROCESS_OWNER_ID),
        eq(externalAsyncTask.callbackLeaseToken, callbackToken),
        eq(externalAsyncTask.callbackStatus, "sending"),
        sql`${externalAsyncTask.callbackLeaseExpiresAt} > now()`
      )
    )
    .returning({ id: externalAsyncTask.id });
  return Boolean(row);
}

/**
 * 用 callback fencing token 记录失败并安排指数退避。
 *
 * 最多尝试 8 次；达到上限后转 permanent_failed，不再自动投递。
 */
export async function retryExternalAsyncCallback(input: {
  id: string;
  callbackToken: string;
  attempts: number;
  error: string;
}): Promise<boolean> {
  const permanent = input.attempts >= 8;
  const delayMs = Math.min(60 * 60 * 1000, 2 ** input.attempts * 5_000);
  const [row] = await db
    .update(externalAsyncTask)
    .set({
      callbackStatus: permanent ? "permanent_failed" : "retry",
      callbackNextAt: permanent
        ? null
        : sql`now() + (${delayMs} * interval '1 millisecond')`,
      callbackLeaseOwner: null,
      callbackLeaseToken: null,
      callbackLeaseExpiresAt: null,
      callbackError: input.error.slice(0, 2_000),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(externalAsyncTask.id, input.id),
        eq(externalAsyncTask.callbackLeaseOwner, PROCESS_OWNER_ID),
        eq(externalAsyncTask.callbackLeaseToken, input.callbackToken),
        eq(externalAsyncTask.callbackStatus, "sending"),
        sql`${externalAsyncTask.callbackLeaseExpiresAt} > now()`
      )
    )
    .returning({ id: externalAsyncTask.id });
  return Boolean(row);
}

/**
 * 查找同一用户/文件类型/clientRequestId 的可编辑文件任务。
 *
 * 用于 enqueue 幂等：相同 requestHash 返回已有任务，不同 hash 由调用方报 409。
 */
export async function findEditableTaskByClientRequest(input: {
  userId: string;
  kind: "ppt" | "psd";
  clientRequestId: string;
}): Promise<ExternalAsyncTaskRow | undefined> {
  const [row] = await db
    .select()
    .from(externalAsyncTask)
    .where(
      and(
        eq(externalAsyncTask.taskType, "editable_file"),
        eq(externalAsyncTask.userId, input.userId),
        eq(externalAsyncTask.kind, input.kind),
        eq(externalAsyncTask.clientRequestId, input.clientRequestId)
      )
    )
    .limit(1);
  return row;
}

/**
 * 把一条过期 running 且已耗尽尝试次数的可编辑任务收敛为 failed。
 *
 * 该维护写入避免进程连续崩溃后任务永久停在 running；返回被收敛的完整行，供调用方
 * 清理输入对象并观察 callback outbox 状态。
 */
export async function failExhaustedEditableTasks(): Promise<
  ExternalAsyncTaskRow[]
> {
  return await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT "id"
      FROM "external_async_task"
      WHERE "task_type" = 'editable_file'
        AND "status" = 'running'
        AND "lease_expires_at" <= now()
        AND "attempt_count" >= "max_attempts"
      ORDER BY "lease_expires_at", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 100
    `);
    const rawRows = Array.isArray(result)
      ? result
      : (result as { rows?: unknown[] }).rows;
    const ids = (Array.isArray(rawRows) ? rawRows : []).flatMap((row) => {
      if (typeof row !== "object" || row === null) return [];
      const id = (row as Record<string, unknown>).id;
      return typeof id === "string" ? [id] : [];
    });
    if (ids.length === 0) return [];

    return await tx
      .update(externalAsyncTask)
      .set({
        status: "failed",
        errorPayload: {
          error: {
            message: "Editable file task could not be recovered after retries.",
          },
        },
        completedAt: sql`now()`,
        updatedAt: sql`now()`,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        callbackStatus: sql`CASE
          WHEN ${externalAsyncTask.callbackUrl} IS NULL THEN 'none'
          ELSE 'waiting'
        END`,
        callbackNextAt: sql`CASE
          WHEN ${externalAsyncTask.callbackUrl} IS NULL THEN NULL
          ELSE now()
        END`,
      })
      .where(
        and(
          inArray(externalAsyncTask.id, ids),
          eq(externalAsyncTask.status, "running"),
          sql`${externalAsyncTask.leaseExpiresAt} <= now()`,
          sql`${externalAsyncTask.attemptCount} >= ${externalAsyncTask.maxAttempts}`
        )
      )
      .returning();
  });
}

/**
 * 领取一条 queued 或租约过期的 running 可编辑文件任务。
 *
 * 事务内以优先级降序、创建时间 FIFO 选择并 SKIP LOCKED；领取会递增 attemptCount，
 * 达到 maxAttempts 的过期任务由 failExhaustedEditableTasks 单独收敛。
 */
export async function claimEditableTask(): Promise<
  { row: ExternalAsyncTaskRow; leaseToken: string } | undefined
> {
  const leaseToken = randomUUID();
  return await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT "id"
      FROM "external_async_task"
      WHERE "task_type" = 'editable_file'
        AND "attempt_count" < "max_attempts"
        AND (
          (
            "status" = 'queued'
            AND "available_at" <= now()
          ) OR (
            "status" = 'running'
            AND "lease_expires_at" <= now()
          )
        )
      ORDER BY "priority" DESC, "created_at", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const rows = Array.isArray(result)
      ? result
      : (result as { rows?: unknown[] }).rows;
    const id =
      Array.isArray(rows) &&
      typeof rows[0] === "object" &&
      rows[0] !== null &&
      typeof (rows[0] as Record<string, unknown>).id === "string"
        ? ((rows[0] as Record<string, unknown>).id as string)
        : undefined;
    if (!id) return undefined;

    const [row] = await tx
      .update(externalAsyncTask)
      .set({
        status: "running",
        attemptCount: sql`${externalAsyncTask.attemptCount} + 1`,
        leaseOwner: PROCESS_OWNER_ID,
        leaseToken,
        leaseExpiresAt: sql`now() + (${TASK_LEASE_TTL_MS} * interval '1 millisecond')`,
        heartbeatAt: sql`now()`,
        startedAt: sql`coalesce(${externalAsyncTask.startedAt}, now())`,
        updatedAt: sql`now()`,
      })
      .where(eq(externalAsyncTask.id, id))
      .returning();
    return row ? { row, leaseToken } : undefined;
  });
}

/**
 * 续租当前 worker 持有且尚未过期的可编辑文件任务。
 *
 * 已过期 token 不能复活；返回 false 表示任务已被其他 worker 接管或进入终态。
 */
export async function heartbeatEditableTask(
  id: string,
  leaseToken: string
): Promise<boolean> {
  const [row] = await db
    .update(externalAsyncTask)
    .set({
      leaseExpiresAt: sql`now() + (${TASK_LEASE_TTL_MS} * interval '1 millisecond')`,
      heartbeatAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(externalAsyncTask.id, id),
        eq(externalAsyncTask.taskType, "editable_file"),
        eq(externalAsyncTask.status, "running"),
        eq(externalAsyncTask.leaseOwner, PROCESS_OWNER_ID),
        eq(externalAsyncTask.leaseToken, leaseToken),
        sql`${externalAsyncTask.leaseExpiresAt} > now()`
      )
    )
    .returning({ id: externalAsyncTask.id });
  return Boolean(row);
}

/**
 * 用 task fencing token 写入可编辑文件成功或失败终态。
 *
 * 成功保存内部 storage 引用，公开查询时动态签名；失败保存 OpenAI 错误信封。旧 worker
 * 晚到只能得到 false。callback outbox 同步转 waiting。
 */
export async function finalizeEditableTask(input: {
  id: string;
  leaseToken: string;
  resultPayload?: Record<string, unknown>;
  errorPayload?: Record<string, unknown>;
}): Promise<boolean> {
  const [row] = await db
    .update(externalAsyncTask)
    .set({
      status: input.errorPayload ? "failed" : "completed",
      resultPayload: input.errorPayload ? null : input.resultPayload,
      errorPayload: input.errorPayload ?? null,
      completedAt: sql`now()`,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      callbackStatus: sql`CASE
        WHEN ${externalAsyncTask.callbackUrl} IS NULL THEN 'none'
        ELSE 'waiting'
      END`,
      callbackNextAt: sql`CASE
        WHEN ${externalAsyncTask.callbackUrl} IS NULL THEN NULL
        ELSE now()
      END`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(externalAsyncTask.id, input.id),
        eq(externalAsyncTask.taskType, "editable_file"),
        eq(externalAsyncTask.status, "running"),
        eq(externalAsyncTask.leaseOwner, PROCESS_OWNER_ID),
        eq(externalAsyncTask.leaseToken, input.leaseToken),
        sql`${externalAsyncTask.leaseExpiresAt} > now()`
      )
    )
    .returning({ id: externalAsyncTask.id });
  return Boolean(row);
}

/**
 * 当前 worker 未获得业务并发许可时，把任务安全退回 queued。
 *
 * attemptCount 回退一次，因为本轮尚未调用上游，不应消耗崩溃重试预算。
 */
export async function requeueEditableTask(
  id: string,
  leaseToken: string,
  delayMs = 500
): Promise<boolean> {
  const [row] = await db
    .update(externalAsyncTask)
    .set({
      status: "queued",
      attemptCount: sql`greatest(0, ${externalAsyncTask.attemptCount} - 1)`,
      availableAt: sql`now() + (${Math.max(0, delayMs)} * interval '1 millisecond')`,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(externalAsyncTask.id, id),
        eq(externalAsyncTask.status, "running"),
        eq(externalAsyncTask.leaseOwner, PROCESS_OWNER_ID),
        eq(externalAsyncTask.leaseToken, leaseToken),
        sql`${externalAsyncTask.leaseExpiresAt} > now()`
      )
    )
    .returning({ id: externalAsyncTask.id });
  return Boolean(row);
}

/**
 * 领取一条耗尽执行次数、只能继续对账/补偿的普通 generation 任务。
 *
 * @returns 任务行与本次 fencing token；无候选时返回 undefined。
 * @sideEffects 短事务内 SKIP LOCKED 领取，不再递增 attemptCount，也不直接发布失败；
 * adapter 必须先对账 generation/video 与财务真相后再决定终态。
 */
export async function claimExhaustedGenerationTask(): Promise<
  { row: ExternalAsyncTaskRow; leaseToken: string } | undefined
> {
  const leaseToken = randomUUID();
  return await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT "id"
      FROM "external_async_task"
      WHERE "task_type" IN ('image', 'video')
        AND "attempt_count" >= "max_attempts"
        AND (
          (
            "status" = 'queued'
            AND "available_at" <= now()
          ) OR (
            "status" = 'running'
            AND (
              "lease_expires_at" <= now()
              OR (
                "lease_expires_at" IS NULL
                AND "created_at" <= now() - (${LEGACY_NULL_LEASE_GRACE_MS} * interval '1 millisecond')
              )
            )
          )
        )
      ORDER BY "available_at", "created_at", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const rows = Array.isArray(result)
      ? result
      : (result as { rows?: unknown[] }).rows;
    const id =
      Array.isArray(rows) &&
      typeof rows[0] === "object" &&
      rows[0] !== null &&
      typeof (rows[0] as Record<string, unknown>).id === "string"
        ? ((rows[0] as Record<string, unknown>).id as string)
        : undefined;
    if (!id) return undefined;

    const [row] = await tx
      .update(externalAsyncTask)
      .set({
        status: "running",
        leaseOwner: PROCESS_OWNER_ID,
        leaseToken,
        leaseExpiresAt: sql`now() + (${TASK_LEASE_TTL_MS} * interval '1 millisecond')`,
        heartbeatAt: sql`now()`,
        startedAt: sql`coalesce(${externalAsyncTask.startedAt}, now())`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(externalAsyncTask.id, id),
          inArray(externalAsyncTask.taskType, ["image", "video"])
        )
      )
      .returning();
    return row ? { row, leaseToken } : undefined;
  });
}

/**
 * 领取一条 queued 或租约过期的普通 image/video 任务。
 *
 * @returns 任务行与本次随机 fencing token；无可领取任务时返回 undefined。
 * @sideEffects 在短事务内按优先级/FIFO 使用 SKIP LOCKED 领取并递增 attemptCount。
 */
export async function claimGenerationTask(): Promise<
  { row: ExternalAsyncTaskRow; leaseToken: string } | undefined
> {
  const leaseToken = randomUUID();
  return await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT "id"
      FROM "external_async_task"
      WHERE "task_type" IN ('image', 'video')
        AND "attempt_count" < "max_attempts"
        AND (
          (
            "status" = 'queued'
            AND "available_at" <= now()
          ) OR (
            "status" = 'running'
            AND (
              "lease_expires_at" <= now()
              OR (
                "lease_expires_at" IS NULL
                AND "created_at" <= now() - (${LEGACY_NULL_LEASE_GRACE_MS} * interval '1 millisecond')
              )
            )
          )
        )
      ORDER BY "priority" DESC, "created_at", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const rows = Array.isArray(result)
      ? result
      : (result as { rows?: unknown[] }).rows;
    const id =
      Array.isArray(rows) &&
      typeof rows[0] === "object" &&
      rows[0] !== null &&
      typeof (rows[0] as Record<string, unknown>).id === "string"
        ? ((rows[0] as Record<string, unknown>).id as string)
        : undefined;
    if (!id) return undefined;

    const [row] = await tx
      .update(externalAsyncTask)
      .set({
        status: "running",
        attemptCount: sql`${externalAsyncTask.attemptCount} + 1`,
        leaseOwner: PROCESS_OWNER_ID,
        leaseToken,
        leaseExpiresAt: sql`now() + (${TASK_LEASE_TTL_MS} * interval '1 millisecond')`,
        heartbeatAt: sql`now()`,
        startedAt: sql`coalesce(${externalAsyncTask.startedAt}, now())`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(externalAsyncTask.id, id),
          inArray(externalAsyncTask.taskType, ["image", "video"])
        )
      )
      .returning();
    return row ? { row, leaseToken } : undefined;
  });
}

/**
 * 续租当前 worker 持有且尚未过期的普通 generation 任务。
 *
 * @param id task ID。
 * @param leaseToken claimGenerationTask 返回的 fencing token。
 * @returns token 仍有效且续租成功时为 true；过期、终态或被接管时为 false。
 * @sideEffects 条件更新 lease expiry 与 heartbeat 时间。
 */
export async function heartbeatGenerationTask(
  id: string,
  leaseToken: string
): Promise<boolean> {
  const [row] = await db
    .update(externalAsyncTask)
    .set({
      leaseExpiresAt: sql`now() + (${TASK_LEASE_TTL_MS} * interval '1 millisecond')`,
      heartbeatAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(externalAsyncTask.id, id),
        inArray(externalAsyncTask.taskType, ["image", "video"]),
        eq(externalAsyncTask.status, "running"),
        eq(externalAsyncTask.leaseOwner, PROCESS_OWNER_ID),
        eq(externalAsyncTask.leaseToken, leaseToken),
        sql`${externalAsyncTask.leaseExpiresAt} > now()`
      )
    )
    .returning({ id: externalAsyncTask.id });
  return Boolean(row);
}

/**
 * 用当前 fencing token 写普通 generation 任务的成功或失败终态。
 *
 * @param input task/token、终态公开 object 类型与紧凑结果或错误元数据。
 * @returns 只有当前未过期 lease 完成写入时为 true；旧 worker 晚到返回 false。
 * @sideEffects 清空 task lease，并在 callback 存在时原子唤醒 outbox。
 */
export async function finalizeGenerationTask(input: {
  id: string;
  leaseToken: string;
  objectType: "image" | "video";
  resultPayload?: Record<string, unknown>;
  errorPayload?: Record<string, unknown>;
}): Promise<boolean> {
  const failed = input.errorPayload !== undefined;
  const [row] = await db
    .update(externalAsyncTask)
    .set({
      objectType: input.objectType,
      status: failed ? "failed" : "completed",
      resultPayload: failed ? null : input.resultPayload,
      errorPayload: input.errorPayload ?? null,
      completedAt: sql`now()`,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      callbackStatus: sql`CASE
        WHEN ${externalAsyncTask.callbackUrl} IS NULL THEN 'none'
        ELSE 'waiting'
      END`,
      callbackNextAt: sql`CASE
        WHEN ${externalAsyncTask.callbackUrl} IS NULL THEN NULL
        ELSE now()
      END`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(externalAsyncTask.id, input.id),
        inArray(externalAsyncTask.taskType, ["image", "video"]),
        eq(externalAsyncTask.status, "running"),
        eq(externalAsyncTask.leaseOwner, PROCESS_OWNER_ID),
        eq(externalAsyncTask.leaseToken, input.leaseToken),
        sql`${externalAsyncTask.leaseExpiresAt} > now()`
      )
    )
    .returning({ id: externalAsyncTask.id });
  return Boolean(row);
}

/**
 * 把尚未调用业务管线的普通 generation 任务安全退回 queued。
 *
 * @param id task ID。
 * @param leaseToken 当前 fencing token。
 * @param delayMs 再次可领取前的非负延迟，默认 500ms。
 * @returns 当前 lease 成功重排时为 true；已失效时为 false。
 * @sideEffects attemptCount 回退一次并清空租约，不消耗崩溃重试预算。
 */
export async function releaseUnstartedGenerationTask(
  id: string,
  leaseToken: string,
  delayMs = 500
): Promise<boolean> {
  const [row] = await db
    .update(externalAsyncTask)
    .set({
      status: "queued",
      attemptCount: sql`greatest(0, ${externalAsyncTask.attemptCount} - 1)`,
      availableAt: sql`now() + (${Math.max(0, delayMs)} * interval '1 millisecond')`,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(externalAsyncTask.id, id),
        inArray(externalAsyncTask.taskType, ["image", "video"]),
        eq(externalAsyncTask.status, "running"),
        eq(externalAsyncTask.leaseOwner, PROCESS_OWNER_ID),
        eq(externalAsyncTask.leaseToken, leaseToken),
        sql`${externalAsyncTask.leaseExpiresAt} > now()`
      )
    )
    .returning({ id: externalAsyncTask.id });
  return Boolean(row);
}

/**
 * 延后一条已经实际消耗本次执行机会的普通 generation 任务。
 *
 * @param id task ID。
 * @param leaseToken 当前 fencing token。
 * @param delayMs 再次可领取前的非负延迟，默认 500ms。
 * @returns 当前 lease 成功释放时为 true；已失效时为 false。
 * @sideEffects 保留 claim 已递增的 attemptCount，清空 lease 并写 queued/availableAt，
 * 使连续暂态失败最终进入 exhausted reconciliation，而非无限重试。
 */
export async function deferGenerationTask(
  id: string,
  leaseToken: string,
  delayMs = 500
): Promise<boolean> {
  const [row] = await db
    .update(externalAsyncTask)
    .set({
      status: "queued",
      availableAt: sql`now() + (${Math.max(0, delayMs)} * interval '1 millisecond')`,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(externalAsyncTask.id, id),
        inArray(externalAsyncTask.taskType, ["image", "video"]),
        eq(externalAsyncTask.status, "running"),
        eq(externalAsyncTask.leaseOwner, PROCESS_OWNER_ID),
        eq(externalAsyncTask.leaseToken, leaseToken),
        sql`${externalAsyncTask.leaseExpiresAt} > now()`
      )
    )
    .returning({ id: externalAsyncTask.id });
  return Boolean(row);
}

/**
 * 延后再次对账一条已耗尽尝试次数的 generation 任务。
 *
 * @param id task ID。
 * @param leaseToken 当前 reconciliation fencing token。
 * @param delayMs 下一次对账前的非负延迟，默认 5 秒。
 * @returns 当前 lease 成功释放时为 true；过期或被接管时为 false。
 * @sideEffects 保留 attemptCount，清空 lease 并写 queued/availableAt；普通领取仍会因
 * attemptCount 达上限而跳过，只能由 claimExhaustedGenerationTask 再次对账。
 */
export async function deferExhaustedGenerationTask(
  id: string,
  leaseToken: string,
  delayMs = 5_000
): Promise<boolean> {
  const [row] = await db
    .update(externalAsyncTask)
    .set({
      status: "queued",
      availableAt: sql`now() + (${Math.max(0, delayMs)} * interval '1 millisecond')`,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(externalAsyncTask.id, id),
        inArray(externalAsyncTask.taskType, ["image", "video"]),
        eq(externalAsyncTask.status, "running"),
        eq(externalAsyncTask.leaseOwner, PROCESS_OWNER_ID),
        eq(externalAsyncTask.leaseToken, leaseToken),
        sql`${externalAsyncTask.leaseExpiresAt} > now()`,
        sql`${externalAsyncTask.attemptCount} >= ${externalAsyncTask.maxAttempts}`
      )
    )
    .returning({ id: externalAsyncTask.id });
  return Boolean(row);
}
