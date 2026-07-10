import crypto from "node:crypto";
import { withApiLogging } from "@repo/shared/api-logger";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { internalJobResponse } from "@/server/internal-job-http";
import { runInternalJob } from "@/server/internal-job-runner";

async function validateCronSecret(authHeader: string | null) {
  if (!authHeader) return false;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
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
  if (!(await validateCronSecret(headersList.get("authorization")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return internalJobResponse(
    await runInternalJob("web-accounts-refresh", { mode: "manual" })
  );
});

export const GET = withApiLogging(async () =>
  NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/image-backend/web-accounts/refresh",
    method: "POST",
    authentication: "Bearer token required (process env CRON_SECRET)",
  })
);
