/**
 * UOL 操作注册 - referral 邀请返佣域
 *
 * 使用方：注册归因、支付 webhook、用户侧邀请页面、管理端审计和外部 agent。
 * 关键依赖：referral 核心服务、UOL registry、Principal 权限模型。
 */

import { z } from "zod";
import {
  accrueReferralCommissionForPayment,
  adminCancelReferralCommissionForOrder,
  bindInviterByCode,
  cancelReferralCommissionForOrder,
  convertAvailableReferralCommissionToCredits,
  ensureReferralProfile,
  getReferralOverview,
  listReferralBindings,
  listReferralCommissionLedger,
  listReferralProfiles,
  listReferralTransfers,
  setReferralCommissionRate,
  thawReferralCommissions,
  updateReferralCode,
} from "../../referral";
import { OperationError } from "../errors";
import { getPrincipalUserId } from "../principal";
import { defineOperation } from "../registry";

const referralMetadataSchema = z.record(z.string(), z.unknown()).optional();
const adminPaginationSchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  query: z.string().trim().optional(),
});
const adminProfileRowSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  referralCode: z.string(),
  referralCodeCustom: z.boolean(),
  commissionRateBps: z.number().nullable(),
  invitedCount: z.number(),
  availableCredits: z.number(),
  frozenCredits: z.number(),
  convertedCredits: z.number(),
  createdAt: z.date(),
});
const adminBindingRowSchema = z.object({
  id: z.string(),
  inviterUserId: z.string(),
  inviterEmail: z.string(),
  inviteeUserId: z.string(),
  inviteeEmail: z.string(),
  referralCode: z.string(),
  createdAt: z.date(),
});
const commissionStatusSchema = z.enum([
  "frozen",
  "available",
  "converting",
  "converted",
  "canceled",
]);
const transferStatusSchema = z.enum(["pending", "completed", "failed"]);
const adminCommissionRowSchema = z.object({
  id: z.string(),
  inviterUserId: z.string(),
  inviterEmail: z.string(),
  inviteeUserId: z.string(),
  inviteeEmail: z.string(),
  provider: z.string(),
  orderId: z.string(),
  orderKind: z.string(),
  orderAmountCents: z.number(),
  currency: z.string(),
  commissionRateBps: z.number(),
  commissionAmountCents: z.number(),
  commissionCredits: z.number(),
  status: commissionStatusSchema,
  frozenUntil: z.date().nullable(),
  convertedAt: z.date().nullable(),
  canceledAt: z.date().nullable(),
  createdAt: z.date(),
});
const adminTransferRowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string(),
  status: transferStatusSchema,
  amountCents: z.number(),
  creditsAmount: z.number(),
  commissionCount: z.number(),
  sourceRef: z.string(),
  creditsBatchId: z.string().nullable(),
  creditsTransactionId: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
const cancelCommissionResultSchema = z.object({
  provider: z.enum(["creem", "epay", "alipay"]),
  orderId: z.string(),
  canceledCount: z.number(),
  reversedCount: z.number(),
  skippedCount: z.number(),
  alreadyCanceledCount: z.number(),
  errors: z.array(
    z.object({
      commissionId: z.string(),
      message: z.string(),
    })
  ),
});

const listResultSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  });

function getAdminUserId(principal: Parameters<typeof getPrincipalUserId>[0]) {
  const adminUserId = getPrincipalUserId(principal);
  if (!adminUserId) throw new Error("No admin userId in principal");
  return adminUserId;
}

export const getMyReferralOverview = defineOperation({
  name: "referral.getMyReferralOverview",
  domain: "referral",
  title: "Get My Referral Overview",
  description: "获取当前用户的邀请码、返佣汇总和被邀请用户列表。",
  input: z.object({}),
  output: z.object({
    userId: z.string(),
    referralCode: z.string(),
    invitedCount: z.number(),
    effectiveCommissionRateBps: z.number(),
    availableCredits: z.number(),
    frozenCredits: z.number(),
    convertedCredits: z.number(),
    invitees: z.array(
      z.object({
        userId: z.string(),
        email: z.string(),
        name: z.string(),
        joinedAt: z.date(),
        totalCommissionCredits: z.number(),
      })
    ),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["billing"],
  hasMaintenanceWrite: true,
  execute: async (_input, principal) => {
    const userId = getPrincipalUserId(principal);
    if (!userId) throw new Error("No userId in principal");
    return getReferralOverview(userId);
  },
});

export const ensureMyReferralProfile = defineOperation({
  name: "referral.ensureMyProfile",
  domain: "referral",
  title: "Ensure My Referral Profile",
  description: "确保当前用户拥有可分享的邀请码。",
  input: z.object({}),
  output: z.object({
    userId: z.string(),
    referralCode: z.string(),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  hasMaintenanceWrite: true,
  execute: async (_input, principal) => {
    const userId = getPrincipalUserId(principal);
    if (!userId) throw new Error("No userId in principal");
    const profile = await ensureReferralProfile(userId);
    return { userId: profile.userId, referralCode: profile.referralCode };
  },
});

export const bindInviter = defineOperation({
  name: "referral.bindInviterByCode",
  domain: "referral",
  title: "Bind Inviter By Code",
  description: "为指定或当前用户按返佣邀请码绑定邀请人，仅首次绑定生效。",
  input: z.object({
    code: z.string().min(1),
    inviteeUserId: z.string().optional(),
    metadata: referralMetadataSchema,
  }),
  output: z.object({
    bound: z.boolean(),
    inviterUserId: z.string().optional(),
    reason: z.string().optional(),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["audit"],
  execute: async (input, principal) => {
    const principalUserId = getPrincipalUserId(principal);
    const inviteeUserId = input.inviteeUserId ?? principalUserId;
    if (!inviteeUserId) throw new Error("No invitee userId");
    if (
      input.inviteeUserId &&
      input.inviteeUserId !== principalUserId &&
      principal.type !== "system"
    ) {
      if (principal.type !== "user" || principal.role === "user") {
        throw new Error("Only admin can bind referral for another user");
      }
    }
    const bindInput: Parameters<typeof bindInviterByCode>[0] = {
      inviteeUserId,
      code: input.code,
    };
    if (input.metadata !== undefined) {
      bindInput.metadata = input.metadata;
    }
    const result = await bindInviterByCode(bindInput);
    return result;
  },
});

export const accrueCommissionForOrder = defineOperation({
  name: "referral.accrueCommissionForOrder",
  domain: "referral",
  title: "Accrue Referral Commission For Order",
  description:
    "支付 webhook 在真实支付完成后调用，为被邀请用户订单生成冻结或可用返佣。",
  input: z.object({
    inviteeUserId: z.string().min(1),
    provider: z.enum(["creem", "epay", "alipay"]),
    orderId: z.string().min(1),
    orderKind: z.enum(["credit_purchase", "subscription"]),
    orderAmountCents: z.number().int().positive(),
    currency: z.string().min(1),
    metadata: referralMetadataSchema,
  }),
  output: z.object({
    applied: z.boolean(),
    reason: z.string().optional(),
    commissionId: z.string().optional(),
    inviterUserId: z.string().optional(),
    commissionAmountCents: z.number().optional(),
    commissionCredits: z.number().optional(),
    status: z.string().optional(),
  }),
  access: { kind: "system" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "required", keyField: "orderId", scope: "global" },
  sideEffects: ["billing", "audit"],
  execute: async (input) => {
    const paymentInput: Parameters<
      typeof accrueReferralCommissionForPayment
    >[0] = {
      inviteeUserId: input.inviteeUserId,
      provider: input.provider,
      orderId: input.orderId,
      orderKind: input.orderKind,
      orderAmountCents: input.orderAmountCents,
      currency: input.currency,
    };
    if (input.metadata !== undefined) {
      paymentInput.metadata = input.metadata;
    }
    return accrueReferralCommissionForPayment(paymentInput);
  },
});

export const thawCommissions = defineOperation({
  name: "referral.thawCommissions",
  domain: "referral",
  title: "Thaw Referral Commissions",
  description: "将达到冻结截止时间的返佣从 frozen 解冻为 available。",
  input: z.object({
    userId: z.string().optional(),
  }),
  output: z.object({
    thawedCount: z.number(),
  }),
  access: { kind: "cron" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["billing"],
  hasMaintenanceWrite: true,
  execute: async (input) => thawReferralCommissions(input.userId),
});

export const cancelCommissionForOrder = defineOperation({
  name: "referral.cancelCommissionForOrder",
  domain: "referral",
  title: "Cancel Referral Commission For Order",
  description:
    "退款、拒付或管理员取消订单后，取消冻结/可用返佣，并对已转积分返佣做冲正扣回。",
  input: z.object({
    provider: z.enum(["creem", "epay", "alipay"]),
    orderId: z.string().min(1),
    reason: z.enum(["refund", "chargeback", "admin", "payment_canceled"]),
    metadata: referralMetadataSchema,
  }),
  output: z.object({
    canceledCount: z.number(),
    reversedCount: z.number(),
    skippedCount: z.number(),
    alreadyCanceledCount: z.number(),
    errors: z.array(
      z.object({
        commissionId: z.string(),
        message: z.string(),
      })
    ),
  }),
  access: { kind: "system" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "required", keyField: "orderId", scope: "global" },
  sideEffects: ["billing", "audit"],
  execute: async (input) => {
    const cancelInput: Parameters<typeof cancelReferralCommissionForOrder>[0] =
      {
        provider: input.provider,
        orderId: input.orderId,
        reason: input.reason,
      };
    if (input.metadata !== undefined) {
      cancelInput.metadata = input.metadata;
    }
    return cancelReferralCommissionForOrder(cancelInput);
  },
});

export const convertAvailableCommissionToCredits = defineOperation({
  name: "referral.convertAvailableCommissionToCredits",
  domain: "referral",
  title: "Convert Referral Commission To Credits",
  description: "将当前用户全部可用返佣手动转换为站内积分。",
  input: z.object({
    requestId: z.string().min(1),
  }),
  output: z.object({
    transferId: z.string(),
    creditsAmount: z.number(),
    commissionCount: z.number(),
    alreadyConverted: z.boolean(),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "required", keyField: "requestId", scope: "per-user" },
  sideEffects: ["billing", "audit"],
  execute: async (input, principal) => {
    const userId = getPrincipalUserId(principal);
    if (!userId) throw new Error("No userId in principal");
    try {
      return await convertAvailableReferralCommissionToCredits({
        userId,
        requestId: input.requestId,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("可转积分")) {
        throw new OperationError("validation_error", error.message);
      }
      if (error instanceof Error && error.message.includes("处理中")) {
        throw new OperationError("idempotency_conflict", error.message);
      }
      throw error;
    }
  },
});

export const adminListReferralProfiles = defineOperation({
  name: "admin.referral.listProfiles",
  domain: "referral",
  title: "Admin List Referral Profiles",
  description: "管理端分页查询用户邀请码、专属返佣比例和返佣汇总。",
  input: adminPaginationSchema.optional().default({}),
  output: listResultSchema(adminProfileRowSchema),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async (input) => listReferralProfiles(input),
});

export const adminUpdateUserReferralCode = defineOperation({
  name: "admin.referral.updateUserCode",
  domain: "referral",
  title: "Admin Update User Referral Code",
  description: "管理员设置用户专属邀请码，并写入管理员审计日志。",
  input: z.object({
    userId: z.string().min(1),
    code: z.string().min(1),
    reason: z.string().trim().max(300).optional(),
  }),
  output: adminProfileRowSchema.pick({
    userId: true,
    referralCode: true,
    referralCodeCustom: true,
    commissionRateBps: true,
    invitedCount: true,
    createdAt: true,
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["audit"],
  execute: async (input, principal) => {
    const profile = await updateReferralCode({
      targetUserId: input.userId,
      code: input.code,
      adminUserId: getAdminUserId(principal),
      reason: input.reason,
    });
    return {
      userId: profile.userId,
      referralCode: profile.referralCode,
      referralCodeCustom: profile.referralCodeCustom,
      commissionRateBps: profile.commissionRateBps,
      invitedCount: profile.invitedCount,
      createdAt: profile.createdAt,
    };
  },
});

export const adminSetUserCommissionRate = defineOperation({
  name: "admin.referral.setUserCommissionRate",
  domain: "referral",
  title: "Admin Set User Referral Commission Rate",
  description: "管理员设置或清空用户专属返佣比例，并写入管理员审计日志。",
  input: z.object({
    userId: z.string().min(1),
    commissionRateBps: z.number().int().min(0).max(10000).nullable(),
    reason: z.string().trim().max(300).optional(),
  }),
  output: adminProfileRowSchema.pick({
    userId: true,
    referralCode: true,
    referralCodeCustom: true,
    commissionRateBps: true,
    invitedCount: true,
    createdAt: true,
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["audit"],
  execute: async (input, principal) => {
    const profile = await setReferralCommissionRate({
      targetUserId: input.userId,
      commissionRateBps: input.commissionRateBps,
      adminUserId: getAdminUserId(principal),
      reason: input.reason,
    });
    return {
      userId: profile.userId,
      referralCode: profile.referralCode,
      referralCodeCustom: profile.referralCodeCustom,
      commissionRateBps: profile.commissionRateBps,
      invitedCount: profile.invitedCount,
      createdAt: profile.createdAt,
    };
  },
});

export const adminCancelCommissionForOrder = defineOperation({
  name: "admin.referral.cancelCommissionForOrder",
  domain: "referral",
  title: "Admin Cancel Referral Commission For Order",
  description:
    "管理员按支付订单取消返佣；冻结/可用返佣直接取消，已转积分返佣做冲正扣回。",
  input: z.object({
    provider: z.enum(["creem", "epay", "alipay"]),
    orderId: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(300),
    metadata: referralMetadataSchema,
  }),
  output: cancelCommissionResultSchema,
  access: { kind: "admin" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "required", keyField: "orderId", scope: "global" },
  sideEffects: ["billing", "audit"],
  execute: async (input, principal) => {
    const cancelInput: Parameters<
      typeof adminCancelReferralCommissionForOrder
    >[0] = {
      provider: input.provider,
      orderId: input.orderId,
      adminUserId: getAdminUserId(principal),
      reason: input.reason,
    };
    if (input.metadata !== undefined) {
      cancelInput.metadata = input.metadata;
    }
    return adminCancelReferralCommissionForOrder(cancelInput);
  },
});

export const adminListReferralBindings = defineOperation({
  name: "admin.referral.listBindings",
  domain: "referral",
  title: "Admin List Referral Bindings",
  description: "管理端分页查询邀请绑定关系。",
  input: adminPaginationSchema.optional().default({}),
  output: listResultSchema(adminBindingRowSchema),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async (input) => listReferralBindings(input),
});

export const adminListReferralCommissionLedger = defineOperation({
  name: "admin.referral.listCommissionLedger",
  domain: "referral",
  title: "Admin List Referral Commission Ledger",
  description: "管理端分页查询返佣权益账本。",
  input: adminPaginationSchema
    .extend({
      status: z.union([commissionStatusSchema, z.literal("all")]).optional(),
    })
    .optional()
    .default({}),
  output: listResultSchema(adminCommissionRowSchema),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async (input) => listReferralCommissionLedger(input),
});

export const adminListReferralTransfers = defineOperation({
  name: "admin.referral.listTransfers",
  domain: "referral",
  title: "Admin List Referral Transfers",
  description: "管理端分页查询返佣转积分记录。",
  input: adminPaginationSchema
    .extend({
      status: z.union([transferStatusSchema, z.literal("all")]).optional(),
    })
    .optional()
    .default({}),
  output: listResultSchema(adminTransferRowSchema),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async (input) => listReferralTransfers(input),
});
