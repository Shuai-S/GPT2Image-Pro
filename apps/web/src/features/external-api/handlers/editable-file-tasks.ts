/**
 * v1 可编辑文件异步任务查询 handler:GET /v1/editable-file-tasks/{task_id}。
 *
 * async:true 创建的可编辑文件(PPT/PSD)任务按 task_<uuid> 存进程内内存(30 分钟 TTL、
 * 多实例不共享、重启即清)。本 handler 鉴权后按 taskId 取回任务,显式校验归属(userId +
 * apiKeyId)防越权(IDOR),只返回 object=editable_file_task 的任务(与图像/视频任务查询隔离)。
 * 可编辑文件无 DB generation 行,故不作持久回退——任务过期/跨实例即 404。
 */
import { withApiLogging } from "@repo/shared/api-logger";
import type { NextRequest } from "next/server";

import {
  getAsyncImageTask,
  toAsyncImageTaskResponse,
} from "@/features/external-api/async-image-tasks";
import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import { openAIImageError } from "@/features/external-api/images";

export const getExternalEditableFileTask = withApiLogging(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
  ) => {
    const auth = await authenticateExternalApiRequest(request);
    if (!auth) {
      return openAIImageError(
        "Invalid or missing API key",
        401,
        "invalid_api_key"
      );
    }

    const { taskId } = await params;
    if (!taskId || taskId.length > 128) {
      return openAIImageError("Invalid task_id.");
    }

    const task = getAsyncImageTask(taskId);
    if (
      task &&
      task.object === "editable_file_task" &&
      task.userId === auth.userId &&
      (!task.apiKeyId || task.apiKeyId === auth.apiKeyId)
    ) {
      return Response.json(toAsyncImageTaskResponse(task), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    return openAIImageError("Editable file task not found or expired.", 404);
  }
);
