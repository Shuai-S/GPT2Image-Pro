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

export const POST = withApiLogging(async (request: Request) => {
  const headersList = await headers();
  if (!(await validateCronSecret(headersList.get("authorization")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = ["1", "true", "yes"].includes(
    (url.searchParams.get("force") || "").toLowerCase()
  );
  return internalJobResponse(
    await runInternalJob("sub2api-sync", {
      mode: "manual",
      input: { force },
    })
  );
});

export const GET = withApiLogging(async () =>
  NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/image-backend/sub2api/sync",
    method: "POST",
    description:
      "Sync Sub2API current access tokens into the image backend pool",
    schedule:
      "Call periodically; configured Sub2API auto-sync tasks decide their own run intervals.",
    authentication: "Bearer token required (process env CRON_SECRET)",
  })
);
