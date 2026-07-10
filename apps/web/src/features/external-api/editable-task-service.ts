/**
 * 可编辑文件持久任务服务。
 *
 * 职责：以 clientRequestId + requestHash 幂等创建 PPT/PSD 队列任务，并把 base64 输入
 * 转为对象存储引用。传输层和 UOL binding 共同调用本模块。
 */

import { randomUUID } from "node:crypto";
import type { QueuePriority } from "@repo/shared/config/subscription-plan";

import {
  createExternalAsyncTask,
  findEditableTaskByClientRequest,
} from "./external-async-task-store";
import {
  cleanupEditableTaskInputs,
  decodeEditableTaskImages,
  hashEditableTaskRequest,
  storeEditableTaskImages,
} from "./editable-task-input";

export class EditableTaskConflictError extends Error {
  constructor() {
    super("client_task_id was already used with different request content");
    this.name = "EditableTaskConflictError";
  }
}

export type EnqueuedEditableTask = {
  taskId: string;
  status: "queued" | "running" | "completed" | "failed";
  kind: "ppt" | "psd";
  createdAt: string;
};

/** 将数据库内部状态收窄为 enqueue 对外状态。 */
function publicEditableTaskStatus(
  status: string
): EnqueuedEditableTask["status"] {
  if (status === "running" || status === "completed" || status === "failed") {
    return status;
  }
  return "queued";
}

/**
 * 幂等创建一个可恢复 PPT/PSD 任务。
 *
 * 相同 user/kind/clientRequestId + requestHash 返回已有 task；hash 不同抛冲突。新任务
 * 先写输入对象，再插入 queued 行；并发唯一冲突时重新读取 winner 并清理 loser 输入。
 */
export async function enqueueEditableFileTask(input: {
  userId: string;
  apiKeyId?: string;
  kind: "ppt" | "psd";
  clientRequestId: string;
  prompt: string;
  base64Images: string[];
  callbackUrl?: string;
  priority: QueuePriority;
  userConcurrency: number;
}): Promise<EnqueuedEditableTask> {
  const clientRequestId = input.clientRequestId.trim();
  const prompt = input.prompt.trim();
  const images = decodeEditableTaskImages({
    kind: input.kind,
    base64Images: input.base64Images,
  });
  const requestHash = hashEditableTaskRequest({
    kind: input.kind,
    prompt,
    images,
  });
  const existing = await findEditableTaskByClientRequest({
    userId: input.userId,
    kind: input.kind,
    clientRequestId,
  });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new EditableTaskConflictError();
    return {
      taskId: existing.id,
      status: publicEditableTaskStatus(existing.status),
      kind: input.kind,
      createdAt: existing.createdAt.toISOString(),
    };
  }

  const taskId = `task_${randomUUID().replace(/-/g, "")}`;
  const inputReferences = await storeEditableTaskImages({
    taskId,
    userId: input.userId,
    images,
  });
  try {
    const now = new Date();
    const initialPayload = {
      id: taskId,
      object: "editable_file_task",
      kind: input.kind,
      client_task_id: clientRequestId,
      status: "processing",
      created: Math.floor(now.getTime() / 1000),
      created_at: now.toISOString(),
    };
    const row = await createExternalAsyncTask({
      id: taskId,
      taskType: "editable_file",
      objectType: "editable_file_task",
      userId: input.userId,
      apiKeyId: input.apiKeyId,
      kind: input.kind,
      clientRequestId,
      requestHash,
      status: "queued",
      priority:
        input.priority === "highest"
          ? 2
          : input.priority === "priority"
            ? 1
            : 0,
      userConcurrency: Math.max(1, Math.floor(input.userConcurrency)),
      maxAttempts: 3,
      initialPayload,
      requestPayload: {
        prompt,
        inputReferences,
      },
      callbackUrl: input.callbackUrl,
    });
    return {
      taskId: row.id,
      status: "queued",
      kind: input.kind,
      createdAt: row.createdAt.toISOString(),
    };
  } catch (error) {
    await cleanupEditableTaskInputs({
      userId: input.userId,
      taskId,
      references: inputReferences,
    });
    const winner = await findEditableTaskByClientRequest({
      userId: input.userId,
      kind: input.kind,
      clientRequestId,
    });
    if (winner) {
      if (winner.requestHash !== requestHash) throw new EditableTaskConflictError();
      return {
        taskId: winner.id,
        status: publicEditableTaskStatus(winner.status),
        kind: input.kind,
        createdAt: winner.createdAt.toISOString(),
      };
    }
    throw error;
  }
}
