/**
 * 图像生成 PostgreSQL 分布式并发协调器。
 *
 * 使用固定 user/global 槽位行、SKIP LOCKED 与同一 leaseId 原子领取两个许可。
 * 图像生成闭包在事务外执行；心跳停后租约过期，其他副本可接管槽位。
 */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { db } from "@repo/database";
import { createContextLogger } from "@repo/shared/logger";
import { sql } from "drizzle-orm";

import type {
  ImageGenerationConcurrencyCoordinator,
  ImageGenerationConcurrencyLease,
} from "./queue-core";

const GLOBAL_SCOPE_KEY = "image-generation";
const LEASE_TTL_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const PROCESS_OWNER_ID = `${hostname()}:${process.pid}:${randomUUID()}`;
const log = createContextLogger({ component: "image-generation-concurrency" });

/** 数据库并发槽租约已失效，旧执行者不得继续产生业务副作用。 */
export class ImageGenerationConcurrencyLeaseLostError extends Error {
  constructor() {
    super("Image generation concurrency lease was lost");
    this.name = "ImageGenerationConcurrencyLeaseLostError";
  }
}

/** 从 Drizzle 不同 PG 驱动的 execute 结果安全读取所有对象行。 */
function resultRows(result: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(result)
    ? result
    : (result as { rows?: unknown[] } | undefined)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null
  );
}

/** 将数据库 slot_no 值收窄为有效正整数。 */
function readSlotNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * 原子领取一个用户槽与一个全局槽。
 *
 * 所有领取固定按 user → global 锁序，避免死锁。若第二个槽不可用，事务未写任何租约；
 * setting 下调时查询只看 slot_no <= 当前上限，已运行的高号槽自然完成。
 */
async function acquireConcurrencyLease(input: {
  taskId: string;
  userId: string;
  userConcurrency: number;
  globalConcurrency: number;
}) {
  const leaseId = randomUUID();
  const userConcurrency = Math.max(1, Math.floor(input.userConcurrency));
  const globalConcurrency = Math.max(1, Math.floor(input.globalConcurrency));

  return await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO "image_generation_concurrency_slot" (
        "scope", "scope_key", "slot_no", "created_at", "updated_at"
      )
      SELECT 'user', ${input.userId}, slot_no, now(), now()
      FROM generate_series(1, ${userConcurrency}) AS slot_no
      ON CONFLICT ("scope", "scope_key", "slot_no") DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO "image_generation_concurrency_slot" (
        "scope", "scope_key", "slot_no", "created_at", "updated_at"
      )
      SELECT 'global', ${GLOBAL_SCOPE_KEY}, slot_no, now(), now()
      FROM generate_series(1, ${globalConcurrency}) AS slot_no
      ON CONFLICT ("scope", "scope_key", "slot_no") DO NOTHING
    `);

    const userResult = await tx.execute(sql`
      SELECT "slot_no"
      FROM "image_generation_concurrency_slot"
      WHERE "scope" = 'user'
        AND "scope_key" = ${input.userId}
        AND "slot_no" <= ${userConcurrency}
        AND ("lease_id" IS NULL OR "lease_expires_at" <= now())
      ORDER BY "slot_no"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const userSlot = readSlotNumber(resultRows(userResult)[0]?.slot_no);
    if (!userSlot) {
      return { acquired: false as const, reason: "user_limit" as const };
    }

    const globalResult = await tx.execute(sql`
      SELECT "slot_no"
      FROM "image_generation_concurrency_slot"
      WHERE "scope" = 'global'
        AND "scope_key" = ${GLOBAL_SCOPE_KEY}
        AND "slot_no" <= ${globalConcurrency}
        AND ("lease_id" IS NULL OR "lease_expires_at" <= now())
      ORDER BY "slot_no"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const globalSlot = readSlotNumber(resultRows(globalResult)[0]?.slot_no);
    if (!globalSlot) {
      return { acquired: false as const, reason: "global_limit" as const };
    }

    const expiresAt = sql`now() + (${LEASE_TTL_MS} * interval '1 millisecond')`;
    await tx.execute(sql`
      UPDATE "image_generation_concurrency_slot"
      SET
        "lease_id" = ${leaseId},
        "owner_id" = ${PROCESS_OWNER_ID},
        "task_id" = ${input.taskId},
        "lease_expires_at" = ${expiresAt},
        "heartbeat_at" = now(),
        "updated_at" = now()
      WHERE (
        "scope" = 'user'
        AND "scope_key" = ${input.userId}
        AND "slot_no" = ${userSlot}
      ) OR (
        "scope" = 'global'
        AND "scope_key" = ${GLOBAL_SCOPE_KEY}
        AND "slot_no" = ${globalSlot}
      )
    `);

    return {
      acquired: true as const,
      lease: {
        leaseId,
        taskId: input.taskId,
        userId: input.userId,
      } satisfies ImageGenerationConcurrencyLease,
    };
  });
}

/**
 * 续租仍由当前 leaseId 持有且尚未过期的两个槽位。
 *
 * 返回 false 表示至少一个槽位已过期或被接管；旧执行者不能复活失效许可。
 */
async function heartbeatConcurrencyLease(
  lease: ImageGenerationConcurrencyLease
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE "image_generation_concurrency_slot"
    SET
      "lease_expires_at" = now() + (${LEASE_TTL_MS} * interval '1 millisecond'),
      "heartbeat_at" = now(),
      "updated_at" = now()
    WHERE "lease_id" = ${lease.leaseId}
      AND "owner_id" = ${PROCESS_OWNER_ID}
      AND "lease_expires_at" > now()
    RETURNING "scope"
  `);
  return resultRows(result).length === 2;
}

/** 按 leaseId 条件释放当前执行持有的 user/global 两个槽位。 */
async function releaseConcurrencyLease(
  lease: ImageGenerationConcurrencyLease
): Promise<void> {
  await db.execute(sql`
    UPDATE "image_generation_concurrency_slot"
    SET
      "lease_id" = NULL,
      "owner_id" = NULL,
      "task_id" = NULL,
      "lease_expires_at" = NULL,
      "heartbeat_at" = NULL,
      "updated_at" = now()
    WHERE "lease_id" = ${lease.leaseId}
      AND "owner_id" = ${PROCESS_OWNER_ID}
  `);
}

/**
 * 在许可心跳保护下运行不可序列化的图像生成闭包。
 *
 * 心跳异常会记录并继续重试，最终无论成功失败都条件释放；业务结果与异常原样透传。
 */
async function runWithConcurrencyLease<T>(
  lease: ImageGenerationConcurrencyLease,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatInFlight: Promise<void> = Promise.resolve();
  let leaseValidUntilMs = Date.now() + LEASE_TTL_MS;
  const controller = new AbortController();

  /** 标记租约失效并中止业务；重复调用保持首个 reason。 */
  const abortLostLease = (): void => {
    if (controller.signal.aborted) return;
    stopped = true;
    controller.abort(new ImageGenerationConcurrencyLeaseLostError());
    log.warn(
      { leaseId: lease.leaseId, taskId: lease.taskId },
      "Image generation concurrency lease was lost"
    );
  };

  const scheduleHeartbeat = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      heartbeatInFlight = heartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    timer.unref?.();
  };
  const heartbeat = async () => {
    if (stopped) return;
    try {
      const renewed = await heartbeatConcurrencyLease(lease);
      if (!renewed) {
        abortLostLease();
        return;
      }
      leaseValidUntilMs = Date.now() + LEASE_TTL_MS;
    } catch (error) {
      log.warn(
        { err: error, leaseId: lease.leaseId, taskId: lease.taskId },
        "Image generation concurrency heartbeat failed"
      );
      if (Date.now() >= leaseValidUntilMs) {
        abortLostLease();
        return;
      }
    }
    scheduleHeartbeat();
  };

  scheduleHeartbeat();
  try {
    const result = await run(controller.signal);
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    return result;
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
    await heartbeatInFlight;
    await releaseConcurrencyLease(lease).catch((error: unknown) => {
      log.warn(
        { err: error, leaseId: lease.leaseId, taskId: lease.taskId },
        "Image generation concurrency release failed"
      );
    });
  }
}

export const postgresImageGenerationConcurrencyCoordinator = {
  acquire: acquireConcurrencyLease,
  runWithLease: runWithConcurrencyLease,
} satisfies ImageGenerationConcurrencyCoordinator;
