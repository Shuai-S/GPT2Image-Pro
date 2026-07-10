/**
 * 普通 generation worker 执行访问决策测试。
 *
 * 锁定 relay-only 套餐降级与任务类型能力复核，避免请求成功入队后被 worker 用不同
 * 口径拒绝，或编辑能力撤销后仍继续调用上游。
 */

import { describe, expect, it } from "vitest";
import { getGenerationTaskAccessError } from "./generation-task-access";

const activeInput = {
  isActive: true,
  userBanned: false,
  rawRelayOnly: false,
  canUseRelay: false,
  canExecute: true,
  capability: "externalApi.images.generate" as const,
};

describe("getGenerationTaskAccessError", () => {
  it("历史 relay 标记在套餐失去 relay 能力后退回普通持久模式", () => {
    expect(
      getGenerationTaskAccessError({
        ...activeInput,
        rawRelayOnly: true,
        canUseRelay: false,
      })
    ).toBeUndefined();
  });

  it("当前套餐仍允许 relay 时拒绝纯中转身份产生持久副作用", () => {
    expect(
      getGenerationTaskAccessError({
        ...activeInput,
        rawRelayOnly: true,
        canUseRelay: true,
      })
    ).toBe("Relay-only API keys cannot execute persisted generation tasks");
  });

  it("编辑能力被撤销后返回编辑专用拒绝原因", () => {
    expect(
      getGenerationTaskAccessError({
        ...activeInput,
        canExecute: false,
        capability: "externalApi.images.edit",
      })
    ).toBe("External image editing is no longer enabled for this plan");
  });
});
