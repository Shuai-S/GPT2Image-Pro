import { withApiLogging } from "@repo/shared/api-logger";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import type { NextRequest } from "next/server";
import {
  getAsyncImageTask,
  toAsyncImageTaskResponse,
  toGenerationImageTaskResponse,
} from "@/features/external-api/async-image-tasks";
import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import { openAIImageError } from "@/features/external-api/images";
import { getGenerationById } from "@/features/image-generation/queries";

export const getExternalImageTask = withApiLogging(
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

    // 1. 先查 PostgreSQL 持久异步任务外壳(async=true 创建,按 task_<uuid> 为键)。
    const task = await getAsyncImageTask(taskId);
    if (
      task &&
      task.userId === auth.userId &&
      task.apiKeyId === auth.apiKeyId
    ) {
      return Response.json(toAsyncImageTaskResponse(task), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // 2. 未命中时把 taskId 当 generation_id 从 DB 产物真相取回。同步请求返回的是
    // generation_id 而非 task id；getGenerationById 不带
    // 归属过滤,必须在此显式校验 userId 防越权(IDOR):只返回归属本人的记录。
    const row = await getGenerationById(taskId);
    if (row && row.userId === auth.userId) {
      const imageUrl = row.storageKey
        ? buildSignedStorageImageUrl(row.storageKey, row.storageBucket)
        : null;
      return Response.json(toGenerationImageTaskResponse(row, imageUrl), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    return openAIImageError("Image task not found or expired.", 404);
  }
);
/**
 * 外部 API 图像任务查询 handler。
 *
 * 优先读取持久 task_* 外壳；同步 generation id 则回退产物表。两条路径都校验用户归属，
 * task_* 还要求创建它的 API Key 完全一致，避免同用户不同 Key 越权读取。
 */
