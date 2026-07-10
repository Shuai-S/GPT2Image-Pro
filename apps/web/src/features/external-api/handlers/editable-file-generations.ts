/**
 * v1 可编辑文件生成 handler:POST /v1/ppts、POST /v1/psds。
 *
 * 职责(薄传输适配):鉴权(Bearer)→ 能力门禁(export.ppt/export.psd)→ 解析 body →
 *   调 runEditableFileForUser(单一账号池/计费真相)。
 * 契约对齐 basketikun/chatgpt2api:{ client_task_id?, prompt, base64_images[] }。PSD 强制非空图。
 * 计费/账号池/storage 全在 service;handler 不碰钱。
 *
 * 两种返回(与图像/视频 API 一致):
 * - 同步(默认):keep-alive JSON 撑住长任务,跑完返回 editable_file_task 结果。
 * - 异步(async:true 或 ?async=true):立即返回 task_<uuid>,后台跑完更新任务;可轮询
 *   GET /v1/editable-file-tasks/{task_id} 或用 callback_url 完成回调。任务、worker 租约和
 *   callback outbox 持久化到 PostgreSQL，可跨重启与多副本接管。
 * client_task_id 同时作为任务和计费幂等键；同键不同内容返回 409。
 */
import { randomUUID } from "node:crypto";
import { withApiLogging } from "@repo/shared/api-logger";
import {
  canUsePlanCapability,
  getPlanQueueSettings,
} from "@repo/shared/subscription/services/plan-capabilities";
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  getAsyncImageTask,
  toAsyncImageTaskResponse,
  validateCallbackUrl,
} from "@/features/external-api/async-image-tasks";
import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import {
  EditableTaskConflictError,
  enqueueEditableFileTask,
} from "@/features/external-api/editable-task-service";
import {
  createJsonKeepAliveResponse,
  openAIImageError,
} from "@/features/external-api/images";
import type { EditableFileKind } from "@/features/image-generation/chatgpt-web";
import { runEditableFileForUser } from "@/features/image-generation/editable-file-operations";
import { MAX_EDITABLE_INPUT_BASE64_CHARACTERS } from "@/features/image-generation/editable-file-util";

const editableFileSchema = z.object({
  client_task_id: z.string().max(200).optional(),
  prompt: z.string().min(1, "prompt is required").max(8000),
  base64_images: z
    .array(z.string().max(MAX_EDITABLE_INPUT_BASE64_CHARACTERS))
    .max(4)
    .default([]),
  async: z.boolean().optional(),
  callback_url: z.string().url().max(2048).optional(),
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

    const clientTaskId = parsed.data.client_task_id?.trim();
    // client_task_id 作幂等/审计标识(计费 sourceRef);缺省用服务端 uuid。
    const taskId = clientTaskId || randomUUID();

    const useAsync =
      parsed.data.async === true ||
      request.nextUrl.searchParams.get("async") === "true";

    // 回调 URL 提交期校验(强制 https + 公网;完成时再逐跳复检投递)。
    let callbackUrl: string | undefined;
    if (parsed.data.callback_url) {
      try {
        callbackUrl = await validateCallbackUrl(parsed.data.callback_url);
      } catch (error) {
        return openAIImageError(
          error instanceof Error ? error.message : "Invalid callback_url."
        );
      }
    }

    // 单次生成 + 成功结果构建(sync/async 共用同一产出结构)。
    const runOnce = async () => {
      const result = await runEditableFileForUser({
        userId: auth.userId,
        apiKeyId: auth.apiKeyId,
        kind,
        prompt: parsed.data.prompt,
        base64Images: parsed.data.base64_images,
        taskId,
      });
      return {
        object: "editable_file_task" as const,
        id: taskId,
        taskId,
        status: "success" as const,
        kind,
        result: {
          conversation_id: result.conversationId,
          primary_url: result.primaryUrl,
          zip_url: result.zipUrl,
        },
        credits_charged: result.creditsCharged,
      };
    };

    if (useAsync) {
      try {
        const queueSettings = await getPlanQueueSettings(auth.plan);
        const enqueued = await enqueueEditableFileTask({
          userId: auth.userId,
          apiKeyId: auth.apiKeyId,
          kind,
          clientRequestId: taskId,
          prompt: parsed.data.prompt,
          base64Images: parsed.data.base64_images,
          callbackUrl,
          priority: queueSettings.priority,
          userConcurrency: queueSettings.userConcurrency,
        });
        const task = await getAsyncImageTask(enqueued.taskId);
        if (!task) throw new Error("Failed to load persisted editable task");
        return Response.json(toAsyncImageTaskResponse(task), {
          headers: { "Cache-Control": "no-store" },
        });
      } catch (error) {
        if (error instanceof EditableTaskConflictError) {
          return openAIImageError(error.message, 409, "idempotency_conflict");
        }
        throw error;
      }
    }

    return createJsonKeepAliveResponse(runOnce);
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
