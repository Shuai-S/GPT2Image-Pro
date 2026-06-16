import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { withApiLogging } from "@repo/shared/api-logger";
import { validateCronSecret } from "@repo/shared/jobs/cron-auth";
import { runWebAccountsRefreshJob } from "@repo/image-generation/jobs-scheduled";

export const POST = withApiLogging(async () => {
  const headersList = await headers();
  if (!(await validateCronSecret(headersList.get("authorization")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await runWebAccountsRefreshJob());
});

/**
 * GET /api/jobs/image-backend/web-accounts/refresh
 *
 * 健康检查端点。需通过 CRON_SECRET 鉴权，防止未认证访问泄露端点元数据。
 */
export const GET = withApiLogging(async () => {
  const headersList = await headers();
  if (!validateCronSecret(headersList.get("authorization"))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  return NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/image-backend/web-accounts/refresh",
    method: "POST",
    authentication: "Bearer token required (process env CRON_SECRET)",
  });
});
