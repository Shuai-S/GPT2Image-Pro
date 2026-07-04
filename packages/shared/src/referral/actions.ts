"use server";

/**
 * 邀请返佣 Server Actions
 *
 * 使用方：Dashboard 邀请返利页面。
 * 关键依赖：UOL invoke 网关、next-safe-action、当前登录会话。
 */

import { z } from "zod";

import { getUserRoleById } from "../auth/role-server";
import { ActionUserError, protectedAction } from "../safe-action";
import { invokeOperation } from "../uol";
import "../uol/operations/referral";
import type { ReferralOverview } from "./index";

const withProtectedReferralAction = (name: string) =>
  protectedAction.metadata({ action: `referral.${name}` });

interface ConvertReferralCommissionResult {
  transferId: string;
  creditsAmount: number;
  commissionCount: number;
  alreadyConverted: boolean;
}

/**
 * 读取当前用户邀请返佣概览。
 *
 * @returns 邀请码、返佣汇总和被邀请用户列表。
 * @sideEffects 会触发到期冻结返佣的惰性解冻。
 */
export const getMyReferralOverviewAction = withProtectedReferralAction(
  "getMyReferralOverview"
).action(async ({ ctx }) => {
  const role = await getUserRoleById(ctx.userId);
  return invokeOperation<ReferralOverview>(
    "referral.getMyReferralOverview",
    {},
    { type: "user", userId: ctx.userId, role }
  );
});

/**
 * 将当前用户全部可用返佣转换为站内积分。
 *
 * @param requestId - 前端生成的请求幂等键。
 * @returns 转积分记录与发放数量。
 * @sideEffects 发放 referral 类型积分批次，并更新返佣账本状态。
 */
export const convertMyReferralCommissionToCreditsAction =
  withProtectedReferralAction("convertAvailableCommissionToCredits")
    .schema(
      z.object({
        requestId: z.string().min(1),
      })
    )
    .action(async ({ parsedInput, ctx }) => {
      const role = await getUserRoleById(ctx.userId);
      try {
        return await invokeOperation<ConvertReferralCommissionResult>(
          "referral.convertAvailableCommissionToCredits",
          parsedInput,
          { type: "user", userId: ctx.userId, role }
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes("可转积分")) {
          throw new ActionUserError("没有可转积分的返佣");
        }
        throw error;
      }
    });
