/**
 * 数据库 readiness 路由。
 *
 * 职责：用 PostgreSQL 端 statement_timeout 执行最小查询，确认当前副本可以承接需要
 * 数据库的真实流量；失败统一返回 503，不泄露连接串、SQL 或驱动错误。
 */

import { db } from "@repo/database";
import { sql } from "drizzle-orm";
import { buildReadinessResponse } from "@/server/health-response";

export const dynamic = "force-dynamic";

/**
 * 探测数据库并编码 readiness。
 *
 * @returns 查询在 2 秒内成功时 200，否则 503。
 * @sideEffects 仅开启一个短事务并执行 SELECT 1，不修改业务数据。
 */
export async function GET(): Promise<Response> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
      await tx.execute(sql`SELECT 1`);
    });
    return buildReadinessResponse(true);
  } catch {
    return buildReadinessResponse(false);
  }
}
