/**
 * 生图后端分组"请求级选择"的纯函数校验层。
 *
 * 职责:集中判定"某个分组能否被某来源选中"(fail-closed 单点),供
 * image-backend-pool/service.ts 的 resolveRequestedGroup 在运行时调用。
 * 本文件刻意不 import @repo/database,保持 DB-free 以支持纯函数单测;
 * 能力位(backendGroups.select)由调用方查询后以布尔传入。
 *
 * 语义(与设计文档 docs/plan/2026-07-06-user-selectable-group-billing.md 对齐):
 * - 显式来源(request / preference)要求 isEnabled + isUserSelectable +
 *   套餐达到 minPlan + 具备 backendGroups.select 能力位;
 * - api_key 来源是发 Key 者的管理约束,绑定时已校验 isUserSelectable,
 *   运行时只复核 isEnabled + minPlan(与既有 ensureGroupUsable 口径一致);
 * - 校验失败由调用方决定 fail-closed(request 直接报错)还是回退
 *   (preference 静默回退默认分组)。
 */
import {
  isPlanAtLeast,
  normalizeSubscriptionPlan,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";

/** 分组选择的来源,决定校验严格程度与失败语义。 */
export type GroupSelectionSource = "request" | "api_key" | "preference";

/** 校验失败原因,面向调用方做错误映射与埋点。 */
export type GroupNotSelectableReason =
  | "group_not_found"
  | "group_disabled"
  | "group_not_user_selectable"
  | "plan_capability_missing"
  | "plan_below_min_plan";

export type GroupSelectableVerdict =
  | { ok: true }
  | { ok: false; reason: GroupNotSelectableReason };

/** 校验所需的分组行子集(调用方从 DB 行或缓存映射而来)。 */
export type SelectableGroupRow = {
  id: string;
  isEnabled: boolean;
  isUserSelectable: boolean;
  metadata: Record<string, unknown> | null;
};

function getGroupMinPlan(
  metadata: Record<string, unknown> | null
): SubscriptionPlan {
  const value =
    metadata && typeof metadata === "object" ? metadata.minPlan : undefined;
  return normalizeSubscriptionPlan(value, "free");
}

/**
 * 判定分组能否被指定来源选中。
 *
 * @param input.group 分组行(未找到传 null)。
 * @param input.plan 用户当前套餐。
 * @param input.canSelectGroups 用户套餐是否具备 backendGroups.select 能力位。
 * @param input.source 选择来源(见 GroupSelectionSource)。
 * @returns ok 或携带 reason 的失败结果;不抛异常,由调用方决定失败语义。
 */
export function checkGroupSelectable(input: {
  group: SelectableGroupRow | null;
  plan: SubscriptionPlan;
  canSelectGroups: boolean;
  source: GroupSelectionSource;
}): GroupSelectableVerdict {
  const { group, plan, canSelectGroups, source } = input;
  if (!group) return { ok: false, reason: "group_not_found" };
  if (!group.isEnabled) return { ok: false, reason: "group_disabled" };
  if (!isPlanAtLeast(plan, getGroupMinPlan(group.metadata))) {
    return { ok: false, reason: "plan_below_min_plan" };
  }
  if (source === "api_key") return { ok: true };
  if (!group.isUserSelectable) {
    return { ok: false, reason: "group_not_user_selectable" };
  }
  if (!canSelectGroups) {
    return { ok: false, reason: "plan_capability_missing" };
  }
  return { ok: true };
}

/** 拒绝码:校验失败原因 + Key 锁定(Key 绑定分组时请求级覆盖被拒)。 */
export type GroupSelectionRejectedCode =
  | GroupNotSelectableReason
  | "group_locked_by_key";

/** 失败原因到用户可读文案的映射(简体中文,供错误与前端提示复用)。 */
export const GROUP_SELECTION_REJECTED_MESSAGES: Record<
  GroupSelectionRejectedCode,
  string
> = {
  group_not_found: "生图分组不存在",
  group_disabled: "生图分组已停用",
  group_not_user_selectable: "该生图分组不可手动选择",
  plan_capability_missing: "当前套餐不可手动选择生图分组",
  plan_below_min_plan: "当前套餐不可使用该生图分组",
  group_locked_by_key: "该 API Key 已绑定生图分组,不可在请求中覆盖",
};

/**
 * 请求级分组选择被拒(fail-closed)。
 *
 * 与 ImageBackendPoolUnavailableError(资源暂不可用,可重试/换组)不同,
 * 本错误表示"用户显式选择的分组不合法/无权",绝不降级到其他分组,
 * 调用方应映射为 4xx 业务错误并把 code 透出给客户端。
 */
export class ImageBackendGroupSelectionError extends Error {
  readonly code: GroupSelectionRejectedCode;

  constructor(code: GroupSelectionRejectedCode) {
    super(GROUP_SELECTION_REJECTED_MESSAGES[code]);
    this.name = "ImageBackendGroupSelectionError";
    this.code = code;
  }
}
