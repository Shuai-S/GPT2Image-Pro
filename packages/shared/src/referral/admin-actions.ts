"use server";

/**
 * 邀请返佣管理端 Server Actions
 *
 * 使用方：/dashboard/admin/referral 管理端审计页。
 * 关键依赖：UOL referral 管理操作、adminAction 权限中间件。
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AppUserRole } from "../auth/roles";
import { ActionUserError, adminAction } from "../safe-action";
import { invokeOperation } from "../uol";
import "../uol/operations/referral";
import type {
  ReferralAdminBindingRow,
  ReferralAdminCommissionRow,
  ReferralAdminListResult,
  ReferralAdminProfileRow,
  ReferralAdminTransferRow,
} from "./index";

const withAdminReferralAction = (name: string) =>
  adminAction.metadata({ action: `referral.admin.${name}` });

const adminListSchema = z
  .object({
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    query: z.string().trim().optional(),
  })
  .optional();

const commissionListSchema = adminListSchema.unwrap().extend({
  status: z
    .enum(["all", "frozen", "available", "converting", "converted", "canceled"])
    .optional(),
});

const transferListSchema = adminListSchema.unwrap().extend({
  status: z.enum(["all", "pending", "completed", "failed"]).optional(),
});

const reasonSchema = z.string().trim().min(1, "请填写操作原因").max(300);

const updateCodeSchema = z.object({
  userId: z.string().min(1, "用户 ID 不能为空"),
  code: z.string().trim().min(1, "邀请码不能为空").max(32),
  reason: reasonSchema,
});

const setCommissionRateSchema = z.object({
  userId: z.string().min(1, "用户 ID 不能为空"),
  commissionRateBps: z.number().int().min(0).max(10000).nullable(),
  reason: reasonSchema,
});

const cancelCommissionSchema = z.object({
  provider: z.enum(["creem", "epay", "alipay"]),
  orderId: z.string().trim().min(1, "订单号不能为空"),
  reason: reasonSchema,
});

function adminPrincipal(ctx: { userId: string; role: AppUserRole }) {
  return { type: "user" as const, userId: ctx.userId, role: ctx.role };
}

function toActionUserError(error: unknown): never {
  if (error instanceof Error) {
    throw new ActionUserError(error.message);
  }
  throw error;
}

/**
 * 管理端读取邀请档案列表。
 *
 * @param parsedInput - 搜索和分页参数。
 * @returns 邀请档案分页结果。
 * @sideEffects 无。
 */
export const adminListReferralProfilesAction = withAdminReferralAction(
  "listProfiles"
)
  .schema(adminListSchema)
  .action(async ({ parsedInput, ctx }) =>
    invokeOperation<ReferralAdminListResult<ReferralAdminProfileRow>>(
      "admin.referral.listProfiles",
      parsedInput ?? {},
      adminPrincipal(ctx)
    )
  );

/**
 * 管理端读取邀请绑定列表。
 *
 * @param parsedInput - 搜索和分页参数。
 * @returns 绑定关系分页结果。
 * @sideEffects 无。
 */
export const adminListReferralBindingsAction = withAdminReferralAction(
  "listBindings"
)
  .schema(adminListSchema)
  .action(async ({ parsedInput, ctx }) =>
    invokeOperation<ReferralAdminListResult<ReferralAdminBindingRow>>(
      "admin.referral.listBindings",
      parsedInput ?? {},
      adminPrincipal(ctx)
    )
  );

/**
 * 管理端读取返佣权益账本。
 *
 * @param parsedInput - 搜索、状态和分页参数。
 * @returns 返佣账本分页结果。
 * @sideEffects 无。
 */
export const adminListReferralCommissionLedgerAction = withAdminReferralAction(
  "listCommissionLedger"
)
  .schema(commissionListSchema.optional())
  .action(async ({ parsedInput, ctx }) =>
    invokeOperation<ReferralAdminListResult<ReferralAdminCommissionRow>>(
      "admin.referral.listCommissionLedger",
      parsedInput ?? {},
      adminPrincipal(ctx)
    )
  );

/**
 * 管理端读取返佣转积分记录。
 *
 * @param parsedInput - 搜索、状态和分页参数。
 * @returns 转积分分页结果。
 * @sideEffects 无。
 */
export const adminListReferralTransfersAction = withAdminReferralAction(
  "listTransfers"
)
  .schema(transferListSchema.optional())
  .action(async ({ parsedInput, ctx }) =>
    invokeOperation<ReferralAdminListResult<ReferralAdminTransferRow>>(
      "admin.referral.listTransfers",
      parsedInput ?? {},
      adminPrincipal(ctx)
    )
  );

/**
 * 管理员更新用户专属邀请码。
 *
 * @param parsedInput - 目标用户、新邀请码和审计原因。
 * @returns 更新后的邀请档案片段。
 * @sideEffects 写 referral_profile 与 admin_audit_log，并刷新管理页缓存。
 */
export const adminUpdateReferralCodeAction = withAdminReferralAction(
  "updateUserCode"
)
  .schema(updateCodeSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      const result = await invokeOperation(
        "admin.referral.updateUserCode",
        parsedInput,
        adminPrincipal(ctx)
      );
      revalidatePath("/dashboard/admin/referral");
      return result;
    } catch (error) {
      toActionUserError(error);
    }
  });

/**
 * 管理员更新用户专属返佣比例。
 *
 * @param parsedInput - 目标用户、bps 比例或 null、审计原因。
 * @returns 更新后的邀请档案片段。
 * @sideEffects 写 referral_profile 与 admin_audit_log，并刷新管理页缓存。
 */
export const adminSetReferralCommissionRateAction = withAdminReferralAction(
  "setUserCommissionRate"
)
  .schema(setCommissionRateSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      const result = await invokeOperation(
        "admin.referral.setUserCommissionRate",
        parsedInput,
        adminPrincipal(ctx)
      );
      revalidatePath("/dashboard/admin/referral");
      return result;
    } catch (error) {
      toActionUserError(error);
    }
  });

/**
 * 管理员按订单取消返佣。
 *
 * @param parsedInput - 支付提供商、订单号和审计原因。
 * @returns 取消、冲正、跳过数量与错误明细。
 * @sideEffects 更新 referral_commission_ledger，必要时扣回已转积分并写审计日志。
 */
export const adminCancelReferralCommissionForOrderAction =
  withAdminReferralAction("cancelCommissionForOrder")
    .schema(cancelCommissionSchema)
    .action(async ({ parsedInput, ctx }) => {
      try {
        const result = await invokeOperation(
          "admin.referral.cancelCommissionForOrder",
          parsedInput,
          adminPrincipal(ctx)
        );
        revalidatePath("/dashboard/admin/referral");
        return result;
      } catch (error) {
        toActionUserError(error);
      }
    });
