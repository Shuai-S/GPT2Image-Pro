/**
 * 站内可编辑文件(PPT/PSD)生成路由（创作页 chat(web) tab 用）。
 *
 * 与外部 v1/ppts、v1/psds 同一 service(runEditableFileForUser),差别仅在鉴权:此路由用
 * 登录会话(Better Auth session)而非 Bearer API key。PPT/PSD 是分钟级长任务,复用图像生成的
 * SSE keep-alive(createImageStreamResponse)撑住连接,完成推 completed(含产物下载 URL),失败推 error。
 *
 * 流程:session 鉴权 → 能力门禁(export.ppt/export.psd)→ 解析 body → runEditableFileForUser
 *   (单一账号池/计费真相,只选付费 web 账号)→ keep-alive 返回。计费/账号池/storage 全在 service。
 */

import { randomUUID } from "node:crypto";
import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { canUsePlanCapability } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createJsonKeepAliveResponse } from "@/features/external-api/images";
import { runEditableFileForUser } from "@/features/image-generation/editable-file-operations";

const generateSchema = z.object({
  kind: z.enum(["ppt", "psd"]),
  prompt: z.string().min(1, "prompt is required").max(8000),
  // 输入图 data URL 数组(PSD 必须非空;PPT 可空)。
  base64Images: z.array(z.string().min(1).max(20_000_000)).default([]),
});

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export const POST = withApiLogging(async (request: NextRequest) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return errorResponse("Unauthorized", 401);
  }
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message || "Invalid request");
  }
  const { kind, prompt, base64Images } = parsed.data;

  const capability = kind === "psd" ? "export.psd" : "export.ppt";
  const plan = await getUserPlan(userId);
  if (!(await canUsePlanCapability(plan.plan, capability))) {
    return errorResponse(
      kind === "psd"
        ? "PSD generation is not enabled for this plan."
        : "PPT generation is not enabled for this plan.",
      403
    );
  }
  if (kind === "psd" && base64Images.length === 0) {
    return errorResponse("base64_images is empty");
  }

  const taskId = randomUUID();
  return createJsonKeepAliveResponse(async () => {
    const result = await runEditableFileForUser({
      userId,
      kind,
      prompt,
      base64Images,
      taskId,
    });
    return {
      object: "editable_file_task",
      taskId,
      status: "success",
      kind,
      result: {
        conversation_id: result.conversationId,
        primary_url: result.primaryUrl,
        zip_url: result.zipUrl,
      },
      credits_charged: result.creditsCharged,
    };
  });
});
