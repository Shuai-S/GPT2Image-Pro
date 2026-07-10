/**
 * UOL Bindings - 启动时延迟绑定真实 execute 实现
 *
 * 职责：在 apps/web 启动时，将 packages/shared 中定义的 operation stub
 * 替换为真实的 service-fn 实现。解决跨包依赖问题：
 * - 操作定义在 packages/shared（不可导入 apps/web）
 * - 部分 execute 实现依赖 apps/web 的 service-fn（DB、外部 API 等）
 *
 * 使用方：uol-init.ts 在应用启动时调用此模块（副作用导入）
 * 关键依赖：@repo/shared/uol（bindExecute）、各 features service-fn
 *
 * 约定：
 * - 此文件在 import 时执行所有 bindExecute 调用
 * - 每个绑定块对应一个 operation，注明源 service-fn 位置
 * - 尚未接线的 operation 用 TODO 注释标记
 */

// 副作用导入：触发所有需要绑定真实 execute 的用户/管理操作注册到 registry。
// 系统维护操作没有 apps/web 侧绑定需求，避免把 env-file 写入逻辑追进用户端。
import "@repo/shared/uol/operations/admin";

import { isSubscriptionPlan } from "@repo/shared/config/subscription-plan";
import { getPlanQueueSettings } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import type { OperationContext, Principal } from "@repo/shared/uol";
import {
  bindExecute,
  getPrincipalUserId,
  OperationError,
} from "@repo/shared/uol";
import {
  getAsyncImageTask,
  toAsyncImageTaskResponse,
} from "@/features/external-api/async-image-tasks";
import { enqueueEditableFileTask } from "@/features/external-api/editable-task-service";
import { runExternalAsyncTaskRetention } from "@/features/external-api/external-async-task-retention";
import {
  getUserImageBackendPreference,
  listAdminImageBackendPool,
  listSelectableImageBackendGroups,
  refreshStaleWebBackendAccounts,
  runAutoSub2ApiAccessTokenSync,
  setUserImageBackendPreference,
} from "@/features/image-backend-pool/service";
import { runImageGenerationForUser } from "@/features/image-generation/operations";
import type { ImageQuality } from "@/features/image-generation/types";
import {
  runImageMaintenanceJob,
  runWebAccountsReplenishJob,
} from "@/server/scheduled-jobs";

// ---------------------------------------------------------------------------
// image-generation 域
// ---------------------------------------------------------------------------

/**
 * 从已鉴权 Principal 获取用户 ID。
 *
 * @param principal UOL 网关传入的调用身份。
 * @returns 会话用户或 API Key 所属用户 ID。
 * @throws OperationError 非用户身份不得执行用户计费操作。
 */
function requirePrincipalUserId(principal: Principal): string {
  const userId = getPrincipalUserId(principal);
  if (!userId) {
    throw new OperationError("unauthenticated", "需要用户身份");
  }
  return userId;
}

/**
 * image.generate - 统一管线核心
 * 源: apps/web/src/features/image-generation/operations.ts
 */
bindExecute(
  "image.generate",
  async (
    input: {
      prompt: string;
      negativePrompt?: string;
      model?: string;
      size?: string;
      quality?: string;
      style?: string;
      count?: number;
      generationId?: string;
      backendGroupId?: string;
      relayOnly?: boolean;
      extra?: Record<string, unknown>;
    },
    principal: Principal,
    _ctx: OperationContext
  ) => {
    const userId = requirePrincipalUserId(principal);
    const result = await runImageGenerationForUser({
      mode: "generate",
      userId,
      prompt: input.prompt,
      model: input.model,
      size: input.size,
      quality: input.quality as ImageQuality | undefined,
      n: input.count,
      generationId: input.generationId,
      apiKeyId: principal.type === "apiKey" ? principal.apiKeyId : undefined,
      requestGroupId: input.backendGroupId,
      relayOnly:
        principal.type === "apiKey" ? principal.relayOnly : input.relayOnly,
    });

    if (result.error) {
      throw new Error(result.error);
    }

    // 将 ImageGenerationOperationResult 映射到 UOL output schema
    const images: { url: string; revisedPrompt?: string }[] = [];
    if (result.imageUrl) {
      images.push({
        url: result.imageUrl,
        revisedPrompt: result.revisedPrompt,
      });
    }
    if (result.imageOutputs) {
      for (const output of result.imageOutputs) {
        if (output.imageUrl) {
          images.push({
            url: output.imageUrl,
            revisedPrompt: output.revisedPrompt,
          });
        }
      }
    }

    return {
      generationId: result.generationId ?? input.generationId ?? "",
      images,
      creditsUsed: result.creditsConsumed,
      model: result.model,
    };
  }
);

/**
 * file.generatePpt / file.generatePsd - 可恢复可编辑文件任务入队
 * 源: apps/web/src/features/external-api/editable-task-service.ts
 */
function bindEditableFile(name: "file.generatePpt" | "file.generatePsd") {
  const kind = name === "file.generatePsd" ? "psd" : "ppt";
  bindExecute(
    name,
    async (
      input: {
        clientRequestId: string;
        prompt: string;
        base64Images?: string[];
      },
      principal: Principal,
      _ctx: OperationContext
    ) => {
      const userId = requirePrincipalUserId(principal);
      const plan =
        principal.type === "apiKey"
          ? principal.plan
          : (await getUserPlan(userId)).plan;
      if (!isSubscriptionPlan(plan)) {
        throw new OperationError(
          "capability_required",
          "A valid subscription plan is required for editable file generation"
        );
      }
      const queueSettings = await getPlanQueueSettings(plan);
      return await enqueueEditableFileTask({
        userId,
        apiKeyId: principal.type === "apiKey" ? principal.apiKeyId : undefined,
        kind,
        clientRequestId: input.clientRequestId,
        prompt: input.prompt,
        base64Images: input.base64Images ?? [],
        priority: queueSettings.priority,
        userConcurrency: queueSettings.userConcurrency,
      });
    }
  );
}
bindEditableFile("file.generatePpt");
bindEditableFile("file.generatePsd");

/**
 * file.getEditableTask - 查询当前 Principal 拥有的持久可编辑文件任务。
 *
 * 会话用户可读取自己的任务；API Key 还必须与创建任务的 Key 完全一致。所有不匹配均
 * 返回 not_found，避免通过错误差异探测其他资源。
 */
bindExecute(
  "file.getEditableTask",
  async (
    input: { taskId: string },
    principal: Principal,
    ctx: OperationContext
  ) => {
    const userId = requirePrincipalUserId(principal);
    const task = await getAsyncImageTask(input.taskId);
    if (task?.object !== "editable_file_task") {
      throw new OperationError("not_found", "Editable file task not found");
    }
    if (
      task.userId !== userId ||
      (principal.type === "apiKey" && task.apiKeyId !== principal.apiKeyId)
    ) {
      throw new OperationError("not_found", "Editable file task not found");
    }
    ctx.assertOwnership("editable file task", task.userId);
    return toAsyncImageTaskResponse(task);
  }
);

// TODO: image.generateAction - 委托 image.generate
// TODO: image.delete - deleteGenerationAction 逻辑
// TODO: image.getStatus - getGenerationStatus 逻辑
// TODO: image.getUserGenerations - 分页查询逻辑
// TODO: image.getUserGenerationCount - 计数查询逻辑
// TODO: image.getUserRecentGenerations - 最近生成查询
// TODO: image.getGenerationById - 单条查询
// TODO: image.getGenerationStats - 管理员统计
// TODO: image.getUserApiConfig - getUserApiConfig 逻辑
// TODO: image.getEffectiveConfig - getEffectiveConfig 逻辑
// TODO: image.selectWebCandidate - selectChatGptWebImageCandidate 逻辑

// ---------------------------------------------------------------------------
// image-backend-pool 域
// ---------------------------------------------------------------------------

/**
 * pool.getAdminPool - 管理后台池总览
 * 源: apps/web/src/features/image-backend-pool/service.ts
 */
bindExecute(
  "pool.getAdminPool",
  async (
    _input: Record<string, never>,
    _principal: Principal,
    _ctx: OperationContext
  ) => {
    const pool = await listAdminImageBackendPool();
    return pool;
  }
);

/**
 * pool.getSelectableGroups - 当前用户可选后端组(含倍率/车道/当前偏好)
 * 源: apps/web/src/features/image-backend-pool/service.ts
 *   listSelectableImageBackendGroups + getUserImageBackendPreference
 */
bindExecute(
  "pool.getSelectableGroups",
  async (
    _input: Record<string, never>,
    principal: Principal,
    _ctx: OperationContext
  ) => {
    const userId = requirePrincipalUserId(principal);
    const plan = await getUserPlan(userId);
    const [groups, selectedGroupId] = await Promise.all([
      listSelectableImageBackendGroups(plan.plan),
      getUserImageBackendPreference(userId, plan.plan),
    ]);
    return {
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        isDefault: group.isDefault,
        billingMultiplier: group.billingMultiplier,
        backendType: group.backendType,
        minPlan: group.minPlan,
        contentSafetyEnabled: group.contentSafetyEnabled,
      })),
      selectedGroupId,
    };
  }
);

/**
 * pool.setPreference - 设置用户默认分组偏好(upsert,同值重写无副作用)
 * 源: apps/web/src/features/image-backend-pool/service.ts
 *   setUserImageBackendPreference(内部校验能力位/isUserSelectable/minPlan)
 */
bindExecute(
  "pool.setPreference",
  async (
    input: { groupId: string | null },
    principal: Principal,
    _ctx: OperationContext
  ) => {
    const userId = requirePrincipalUserId(principal);
    const plan = await getUserPlan(userId);
    try {
      await setUserImageBackendPreference(userId, input.groupId, plan.plan);
    } catch (error) {
      throw new OperationError(
        "forbidden",
        error instanceof Error ? error.message : "设置生图分组偏好失败"
      );
    }
    return { success: true };
  }
);

// TODO: pool.getGroupOptions - getImageBackendGroupOptionsAction 逻辑
// TODO: pool.saveGroup - saveImageBackendGroupAction 逻辑
// TODO: pool.deleteGroup - deleteImageBackendGroupAction 逻辑
// TODO: pool.saveAccount - saveImageBackendAccountAction 逻辑
// TODO: pool.bulkUpdateAccounts - bulkUpdateImageBackendAccountsAction 逻辑
// TODO: pool.bulkDeleteAccounts - bulkDeleteImageBackendAccountsAction 逻辑
// TODO: pool.deleteMember - deleteImageBackendMemberAction 逻辑
// TODO: pool.saveApi - saveImageBackendApiAction 逻辑
// TODO: pool.importFromRefreshTokens - importImageBackendAccountsFromRefreshTokensAction
// TODO: pool.importWebFromAccessTokens - importImageBackendWebAccountsFromAccessTokensAction
// TODO: pool.refreshAccountInfo - refreshImageBackendAccountInfoAction 逻辑
// TODO: pool.refreshAccountsInfo - refreshImageBackendAccountsInfoAction 逻辑
// TODO: pool.getSub2ApiStatus - getSub2ApiSyncStatusAction 逻辑
// TODO: pool.getSub2ApiSourceGroups - getSub2ApiSourceGroupsAction 逻辑
// TODO: pool.getSub2ApiAutoSyncTasks - getSub2ApiAutoSyncTasksAction 逻辑
// TODO: pool.syncSub2ApiAccounts - syncImageBackendAccountsFromSub2ApiAction
// TODO: pool.runSub2ApiManualSync - runSub2ApiManualSyncAction 逻辑
// TODO: pool.runSub2ApiAutoSyncNow - runSub2ApiAutoSyncTaskNowAction 逻辑
// TODO: pool.setSub2ApiTaskEnabled - setSub2ApiAutoSyncTaskEnabledAction
// TODO: pool.setSub2ApiTaskOverwrite - setSub2ApiAutoSyncTaskOverwriteLocalUnavailableStateAction
// TODO: pool.updateSub2ApiTaskOptions - updateSub2ApiAutoSyncTaskOptionsAction
// TODO: pool.deleteSub2ApiTask - deleteSub2ApiAutoSyncTaskAction

/**
 * pool.cronSub2ApiSync - Sub2API 自动同步任务。
 * 源: image-backend-pool/service.ts runAutoSub2ApiAccessTokenSync
 */
bindExecute(
  "pool.cronSub2ApiSync",
  async (
    input: { force: boolean },
    _principal: Principal,
    _ctx: OperationContext
  ) => await runAutoSub2ApiAccessTokenSync({ force: input.force })
);

/**
 * pool.cronRefreshStale - 刷新陈旧 Web 账号。
 * 运行时设置在 scheduled-jobs 层解析，保持 operation 输入稳定。
 */
bindExecute(
  "pool.cronRefreshStale",
  async (
    _input: Record<string, never>,
    _principal: Principal,
    _ctx: OperationContext
  ) => {
    const { getRuntimeSettingNumber } = await import(
      "@repo/shared/system-settings"
    );
    const [staleMinutes, limit] = await Promise.all([
      getRuntimeSettingNumber("CHATGPT_WEB_ACCOUNT_REFRESH_STALE_MINUTES", 30, {
        positive: true,
      }),
      getRuntimeSettingNumber("CHATGPT_WEB_ACCOUNT_REFRESH_LIMIT", 20, {
        positive: true,
      }),
    ]);
    return await refreshStaleWebBackendAccounts({ staleMinutes, limit });
  }
);

/**
 * pool.cronWebAccountsReplenish - 号池自动补号。
 * 源: server/scheduled-jobs.ts runWebAccountsReplenishJob
 */
bindExecute(
  "pool.cronWebAccountsReplenish",
  async (
    _input: Record<string, never>,
    _principal: Principal,
    _ctx: OperationContext
  ) => await runWebAccountsReplenishJob()
);

// ---------------------------------------------------------------------------
// 图像维护域
// ---------------------------------------------------------------------------

/**
 * image.runMaintenance - pending 过期与图片保留维护。
 * 源: server/scheduled-jobs.ts runImageMaintenanceJob
 */
bindExecute(
  "image.runMaintenance",
  async (
    _input: Record<string, never>,
    _principal: Principal,
    _ctx: OperationContext
  ) => await runImageMaintenanceJob()
);

// ---------------------------------------------------------------------------
// user-auth 域
// ---------------------------------------------------------------------------

// TODO: user.list - getAllUsersAction 逻辑（DB 查询在 packages/shared 但需运行时 DB 连接）
// TODO: user.getDetail - getUserDetailAction 逻辑
// TODO: user.updateRole - updateUserRoleAction 逻辑
// TODO: user.ban - banUserAction 逻辑
// TODO: user.grantCredits - adminGrantCreditsAction 逻辑
// TODO: user.adjustCredits - adminAdjustCreditsAction 逻辑
// TODO: user.setSubscription - setUserPlanAction 逻辑
// TODO: user.setCreditsStatus - setUserCreditsStatusAction 逻辑
// TODO: user.setExternalApiKeyStatus - setExternalApiKeyStatusAction 逻辑
// TODO: user.create - createUserAction 逻辑
// TODO: user.updateProfile - updateUserProfileAction 逻辑
// TODO: user.setPassword - setUserPasswordAction 逻辑

// ---------------------------------------------------------------------------
// external-api 域
// ---------------------------------------------------------------------------

/**
 * externalApi.runAsyncTaskRetention - 清理 callback 已结束的持久异步任务终态。
 * 源: external-api/external-async-task-retention.ts
 */
bindExecute(
  "externalApi.runAsyncTaskRetention",
  async (
    _input: Record<string, never>,
    _principal: Principal,
    _ctx: OperationContext
  ) => await runExternalAsyncTaskRetention()
);

// TODO: externalApi.handleImageGenerations - image-generations handler 逻辑
// TODO: externalApi.handleImageEdits - image-edits handler 逻辑
// TODO: externalApi.handleChatCompletions - chat-completions handler 逻辑
// TODO: externalApi.handleResponses - responses handler 逻辑
// TODO: externalApi.handleAgentImages - agent-images handler 逻辑

// ---------------------------------------------------------------------------
// support 域
// ---------------------------------------------------------------------------

// TODO: support.createTicket - createTicketAction 逻辑
// TODO: support.listTickets - getTicketsAction 逻辑
// TODO: support.getTicketDetail - getTicketDetailAction 逻辑
// TODO: support.replyTicket - replyTicketAction 逻辑
// TODO: support.closeTicket - closeTicketAction 逻辑
// TODO: support.adminListTickets - adminGetTicketsAction 逻辑
// TODO: support.adminReplyTicket - adminReplyTicketAction 逻辑
// TODO: support.adminUpdateTicketStatus - adminUpdateTicketStatusAction 逻辑
