import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { withApiLogging } from "@repo/shared/api-logger";
import { IMAGE_GENERATION_PENDING_TIMEOUT_MS } from "@repo/shared/generation-maintenance";
import { validateCronSecret } from "@repo/shared/jobs/cron-auth";
import { runImageMaintenanceJob } from "@repo/image-generation/jobs-scheduled";

/** 超时 pending 生成的阈值（分钟），由共享常量推导以避免文案与真实阈值漂移 */
const PENDING_TIMEOUT_MINUTES = Math.round(
  IMAGE_GENERATION_PENDING_TIMEOUT_MS / 60_000
);

export const POST = withApiLogging(async () => {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");

  if (!validateCronSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await runImageMaintenanceJob());
});

/**
 * GET /api/jobs/images/expire-pending
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
    endpoint: "/api/jobs/images/expire-pending",
    method: "POST",
    description: `Expire pending image generations older than ${PENDING_TIMEOUT_MINUTES} minutes and destroy completed image files when configured`,
    authentication: "Bearer token required (process env CRON_SECRET)",
  });
});
