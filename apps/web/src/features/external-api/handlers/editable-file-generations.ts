/**
 * v1 可编辑文件生成 handler:POST /v1/ppts、POST /v1/psds。
 *
 * 职责(薄传输适配):鉴权(Bearer)→ 能力门禁(export.ppt/export.psd)→ 解析 body →
 *   调 runEditableFileForUser(单一账号池/计费真相)→ 长任务用 keep-alive 撑到出结果返回。
 * 契约对齐 basketikun/chatgpt2api:{ client_task_id?, prompt, base64_images[] }。PSD 强制非空图。
 * 计费/账号池/storage 全在 service;handler 不碰钱。
 *
 * 注:本期为同步(keep-alive)返回;异步任务态(queued→轮询 /v1/editable-file-tasks)+
 *   client_task_id 层幂等见后续迭代(DB 任务表)。当前 client_task_id 仅作计费 sourceRef 幂等键。
 */
import { randomUUID } from "node:crypto";
import { withApiLogging } from "@repo/shared/api-logger";
import { canUsePlanCapability } from "@repo/shared/subscription/services/plan-capabilities";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import {
  createJsonKeepAliveResponse,
  openAIImageError,
} from "@/features/external-api/images";
import type { EditableFileKind } from "@/features/image-generation/chatgpt-web";
import { runEditableFileForUser } from "@/features/image-generation/editable-file-operations";

const editableFileSchema = z.object({
  client_task_id: z.string().max(200).optional(),
  prompt: z.string().min(1, "prompt is required").max(8000),
  base64_images: z.array(z.string()).default([]),
});

function makeEditableFileHandler(
  kind: EditableFileKind,
  capability: "export.ppt" | "export.psd",
  label: string
) {
  return withApiLogging(async (request: NextRequest) => {
    const auth = await authenticateExternalApiRequest(request);
    if (!auth) {
      return openAIImageError(
        "Invalid or missing API key",
        401,
        "invalid_api_key"
      );
    }
    if (!(await canUsePlanCapability(auth.plan, capability))) {
      return openAIImageError(
        `${label} generation is not enabled for this plan.`,
        403,
        "insufficient_plan"
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return openAIImageError("Invalid JSON body");
    }
    const parsed = editableFileSchema.safeParse(body);
    if (!parsed.success) {
      return openAIImageError(
        parsed.error.issues[0]?.message || "Invalid request"
      );
    }
    if (kind === "psd" && parsed.data.base64_images.length === 0) {
      return openAIImageError("base64_images is empty");
    }

    // client_task_id 作幂等/审计标识(计费 sourceRef);缺省用服务端 uuid。
    const taskId = parsed.data.client_task_id?.trim() || randomUUID();

    return createJsonKeepAliveResponse(async () => {
      const result = await runEditableFileForUser({
        userId: auth.userId,
        apiKeyId: auth.apiKeyId,
        kind,
        prompt: parsed.data.prompt,
        base64Images: parsed.data.base64_images,
        taskId,
      });
      return {
        object: "editable_file_task",
        id: taskId,
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
}

export const postExternalPptGenerations = makeEditableFileHandler(
  "ppt",
  "export.ppt",
  "PPT"
);

export const postExternalPsdGenerations = makeEditableFileHandler(
  "psd",
  "export.psd",
  "PSD"
);
