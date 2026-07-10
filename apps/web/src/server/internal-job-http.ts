/**
 * 内部任务 HTTP 传输辅助。
 *
 * 将租约执行结果编码为 Cron 路由的稳定 JSON：成功保持原业务负载，活跃租约或
 * 调度跳过返回 2xx skip，避免外部调度平台因 409/5xx 形成重试风暴。
 */

import { NextResponse } from "next/server";

import type { LeasedJobExecutionResult } from "./internal-job-lease-core";

/**
 * 将统一任务执行结果转换为 NextResponse。
 *
 * executed 时原样返回 operation 负载；跳过时附带 retryAt ISO 时间（若可用）。
 */
export function internalJobResponse<T extends Record<string, unknown>>(
  execution: LeasedJobExecutionResult<T>
): NextResponse {
  if (execution.executed) {
    return NextResponse.json(execution.result);
  }
  return NextResponse.json({
    success: true,
    skipped: execution.reason,
    retryAt: execution.retryAt?.toISOString(),
  });
}
