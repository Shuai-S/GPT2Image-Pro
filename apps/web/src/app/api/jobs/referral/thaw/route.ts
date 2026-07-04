import crypto from "node:crypto";
import { withApiLogging } from "@repo/shared/api-logger";
import { logWarn } from "@repo/shared/logger";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { runReferralThawJob } from "@/server/scheduled-jobs";

function validateCronSecret(authHeader: string | null): boolean {
  if (!authHeader) return false;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logWarn("CRON_SECRET environment variable is not set");
    return false;
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  if (!token) return false;

  const tokenHash = crypto
    .createHash("sha256")
    .update(Buffer.from(token))
    .digest();
  const secretHash = crypto
    .createHash("sha256")
    .update(Buffer.from(cronSecret))
    .digest();

  if (tokenHash.length !== secretHash.length) return false;
  return crypto.timingSafeEqual(tokenHash, secretHash);
}

/**
 * POST /api/jobs/referral/thaw
 *
 * 将到期的冻结返佣解冻为可转积分返佣。
 */
export const POST = withApiLogging(async () => {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");

  if (!validateCronSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await runReferralThawJob());
});

/**
 * GET /api/jobs/referral/thaw
 *
 * 健康检查端点，用于验证 Cron Job 配置是否正确。
 */
export const GET = withApiLogging(async () => {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/referral/thaw",
    method: "POST",
    description: "Thaw matured referral commissions",
    authentication: "Bearer token required (process env CRON_SECRET)",
  });
});
