/**
 * 普通 generation worker 的 DB-free 执行访问决策。
 *
 * 职责：统一 API 请求期与 worker 对 relay-only 套餐降级的语义，并在任何上游或
 * 财务副作用前拒绝失活身份、仍有效的纯中转身份和已撤销的任务能力。
 */

import type { GenerationTaskExecutionCapability } from "./generation-task-resolver";

/**
 * 返回持久任务当前不可执行的稳定原因。
 *
 * @param input 数据库身份状态和按当前套餐重新计算的能力结果。
 * @returns undefined 表示可执行；否则返回可写入任务错误信封的公开原因。
 * @sideEffects 无。
 */
export function getGenerationTaskAccessError(input: {
  isActive: boolean;
  userBanned: boolean | null;
  rawRelayOnly: boolean;
  canUseRelay: boolean;
  canExecute: boolean;
  capability: GenerationTaskExecutionCapability;
}): string | undefined {
  if (!input.isActive || input.userBanned) {
    return "Generation task API key is no longer active";
  }
  // 套餐失去 relay 能力后，历史 relayOnly 列与请求期一样退回普通持久模式。
  if (input.rawRelayOnly && input.canUseRelay) {
    return "Relay-only API keys cannot execute persisted generation tasks";
  }
  if (!input.canExecute) {
    return input.capability === "externalApi.images.edit"
      ? "External image editing is no longer enabled for this plan"
      : "External generation is no longer enabled for this plan";
  }
  return undefined;
}
