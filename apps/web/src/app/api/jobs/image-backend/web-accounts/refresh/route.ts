import crypto from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { withApiLogging } from "@repo/shared/api-logger";
import {
  getRuntimeSettingNumber,
  getRuntimeSettingString,
} from "@repo/shared/system-settings";

import { refreshStaleWebBackendAccounts } from "@/features/image-backend-pool/service";

async function validateCronSecret(authHeader: string | null) {
  if (!authHeader) return false;
  const cronSecret = await getRuntimeSettingString("CRON_SECRET");
  if (!cronSecret) return false;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  if (!token) return false;
  const tokenHash = crypto.createHash("sha256").update(Buffer.from(token)).digest();
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

  const staleMinutes = await getRuntimeSettingNumber(
    "CHATGPT_WEB_ACCOUNT_REFRESH_STALE_MINUTES",
    30,
    { positive: true }
  );
  const limit = await getRuntimeSettingNumber(
    "CHATGPT_WEB_ACCOUNT_REFRESH_LIMIT",
    20,
    { positive: true }
  );
  const result = await refreshStaleWebBackendAccounts({
    staleMinutes,
    limit,
  });

  return NextResponse.json({
    success: true,
    ...result,
    timestamp: new Date().toISOString(),
  });
});

export const GET = withApiLogging(async () =>
  NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/image-backend/web-accounts/refresh",
    method: "POST",
    authentication: "Bearer token required (CRON_SECRET)",
  })
);
