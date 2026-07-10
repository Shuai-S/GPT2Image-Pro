import crypto from "node:crypto";
import { withApiLogging } from "@repo/shared/api-logger";
import { IMAGE_GENERATION_PENDING_TIMEOUT_MS } from "@repo/shared/generation-maintenance";
import { logWarn } from "@repo/shared/logger";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { internalJobResponse } from "@/server/internal-job-http";
import { runInternalJob } from "@/server/internal-job-runner";

/** 超时 pending 生成的阈值（分钟），由共享常量推导以避免文案与真实阈值漂移 */
const PENDING_TIMEOUT_MINUTES = Math.round(
  IMAGE_GENERATION_PENDING_TIMEOUT_MS / 60_000
);

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

export const POST = withApiLogging(async () => {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");

  if (!validateCronSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return internalJobResponse(
    await runInternalJob("images-maintenance", { mode: "manual" })
  );
});

export const GET = withApiLogging(async () => {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/images/expire-pending",
    method: "POST",
    description: `Expire pending image generations older than ${PENDING_TIMEOUT_MINUTES} minutes and destroy completed image files when configured`,
    authentication: "Bearer token required (process env CRON_SECRET)",
  });
});
