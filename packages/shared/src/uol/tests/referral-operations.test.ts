/**
 * 邀请返佣 UOL 操作注册测试
 *
 * 使用方：Vitest。验证 referral 域所有用户、系统与管理端操作都通过
 * Operation Registry 暴露，并保持权限、幂等、破坏性与审计副作用声明稳定。
 * 关键依赖：uol registry、invoke 网关、referral 服务 mock。
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

import { invokeOperation } from "../invoke";
import type { Principal } from "../principal";
import { clearRegistry, getOperation } from "../registry";
import type { OperationDefinition } from "../types";

const referralServiceMock = vi.hoisted(() => ({
  accrueReferralCommissionForPayment: vi.fn(),
  adminCancelReferralCommissionForOrder: vi.fn(),
  bindInviterByCode: vi.fn(),
  cancelReferralCommissionForOrder: vi.fn(),
  convertAvailableReferralCommissionToCredits: vi.fn(),
  ensureReferralProfile: vi.fn(),
  getReferralOverview: vi.fn(),
  listReferralBindings: vi.fn(),
  listReferralCommissionLedger: vi.fn(),
  listReferralProfiles: vi.fn(),
  listReferralTransfers: vi.fn(),
  setReferralCommissionRate: vi.fn(),
  thawReferralCommissions: vi.fn(),
  updateReferralCode: vi.fn(),
}));

vi.mock("../../referral", () => referralServiceMock);

const userPrincipal = {
  type: "user",
  userId: "user-1",
  role: "user",
} satisfies Principal;

/**
 * 按名称读取已注册操作，缺失时让测试直接失败。
 *
 * @param name - UOL 操作名。
 * @returns 已注册的操作定义。
 * @sideEffects 无；只读取内存注册表。
 */
function expectRegisteredOperation(name: string): OperationDefinition {
  const operation = getOperation(name);
  expect(operation, `${name} should be registered`).toBeDefined();
  return operation as OperationDefinition;
}

/**
 * 构造管理端列表服务的空分页响应。
 *
 * @returns 空列表分页数据。
 * @sideEffects 无；供 mocked referral service 返回。
 */
function emptyListResult() {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  };
}

describe("referral UOL operations", () => {
  beforeAll(async () => {
    clearRegistry();
    referralServiceMock.getReferralOverview.mockResolvedValue({
      userId: "user-1",
      referralCode: "ABCD1234",
      invitedCount: 0,
      effectiveCommissionRateBps: 1000,
      availableCredits: 0,
      frozenCredits: 0,
      convertedCredits: 0,
      invitees: [],
    });
    referralServiceMock.ensureReferralProfile.mockResolvedValue({
      userId: "user-1",
      referralCode: "ABCD1234",
    });
    referralServiceMock.bindInviterByCode.mockResolvedValue({
      bound: true,
      inviterUserId: "user-2",
    });
    referralServiceMock.accrueReferralCommissionForPayment.mockResolvedValue({
      applied: true,
      commissionId: "commission-1",
      inviterUserId: "user-2",
      commissionAmountCents: 100,
      commissionCredits: 100,
      status: "available",
    });
    referralServiceMock.thawReferralCommissions.mockResolvedValue({
      thawedCount: 0,
    });
    referralServiceMock.cancelReferralCommissionForOrder.mockResolvedValue({
      canceledCount: 0,
      reversedCount: 0,
      skippedCount: 0,
      alreadyCanceledCount: 0,
      errors: [],
    });
    referralServiceMock.convertAvailableReferralCommissionToCredits.mockResolvedValue(
      {
        transferId: "transfer-1",
        creditsAmount: 100,
        commissionCount: 1,
        alreadyConverted: false,
      }
    );
    referralServiceMock.listReferralProfiles.mockResolvedValue(
      emptyListResult()
    );
    referralServiceMock.listReferralBindings.mockResolvedValue(
      emptyListResult()
    );
    referralServiceMock.listReferralCommissionLedger.mockResolvedValue(
      emptyListResult()
    );
    referralServiceMock.listReferralTransfers.mockResolvedValue(
      emptyListResult()
    );
    referralServiceMock.updateReferralCode.mockResolvedValue({
      userId: "user-1",
      referralCode: "CUSTOM",
      referralCodeCustom: true,
      commissionRateBps: null,
      invitedCount: 0,
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
    });
    referralServiceMock.setReferralCommissionRate.mockResolvedValue({
      userId: "user-1",
      referralCode: "ABCD1234",
      referralCodeCustom: false,
      commissionRateBps: 1200,
      invitedCount: 0,
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
    });
    referralServiceMock.adminCancelReferralCommissionForOrder.mockResolvedValue(
      {
        provider: "creem",
        orderId: "order-1",
        canceledCount: 1,
        reversedCount: 0,
        skippedCount: 0,
        alreadyCanceledCount: 0,
        errors: [],
      }
    );

    await import("../operations/referral");
  });

  it("registers every referral operation required by the commission flow", () => {
    const requiredOperationNames = [
      "referral.getMyReferralOverview",
      "referral.ensureMyProfile",
      "referral.bindInviterByCode",
      "referral.accrueCommissionForOrder",
      "referral.thawCommissions",
      "referral.convertAvailableCommissionToCredits",
      "referral.cancelCommissionForOrder",
      "admin.referral.listProfiles",
      "admin.referral.updateUserCode",
      "admin.referral.setUserCommissionRate",
      "admin.referral.cancelCommissionForOrder",
      "admin.referral.listBindings",
      "admin.referral.listCommissionLedger",
      "admin.referral.listTransfers",
    ];

    for (const operationName of requiredOperationNames) {
      const operation = expectRegisteredOperation(operationName);
      expect(operation.domain).toBe("referral");
    }
  });

  it("declares system-only payment accrual and cancellation boundaries", () => {
    const accrue = expectRegisteredOperation(
      "referral.accrueCommissionForOrder"
    );
    expect(accrue.access).toEqual({ kind: "system" });
    expect(accrue.idempotency).toEqual({
      kind: "required",
      keyField: "orderId",
      scope: "global",
    });
    expect(accrue.destructive).toBe(false);
    expect(accrue.sideEffects).toEqual(["billing", "audit"]);

    const cancel = expectRegisteredOperation(
      "referral.cancelCommissionForOrder"
    );
    expect(cancel.access).toEqual({ kind: "system" });
    expect(cancel.idempotency).toEqual({
      kind: "required",
      keyField: "orderId",
      scope: "global",
    });
    expect(cancel.destructive).toBe(true);
    expect(cancel.sideEffects).toEqual(["billing", "audit"]);
  });

  it("declares per-user idempotency for manual commission conversion", async () => {
    const convert = expectRegisteredOperation(
      "referral.convertAvailableCommissionToCredits"
    );
    expect(convert.access).toEqual({ kind: "protected" });
    expect(convert.idempotency).toEqual({
      kind: "required",
      keyField: "requestId",
      scope: "per-user",
    });
    expect(convert.sideEffects).toEqual(["billing", "audit"]);

    await invokeOperation(
      "referral.convertAvailableCommissionToCredits",
      { requestId: "request-1" },
      userPrincipal
    );

    expect(
      referralServiceMock.convertAvailableReferralCommissionToCredits
    ).toHaveBeenCalledWith({
      userId: "user-1",
      requestId: "request-1",
    });
  });

  it("maps conversion business conflicts to stable operation errors", async () => {
    referralServiceMock.convertAvailableReferralCommissionToCredits.mockRejectedValueOnce(
      new Error("已有返佣转积分正在处理中")
    );

    await expect(
      invokeOperation(
        "referral.convertAvailableCommissionToCredits",
        { requestId: "request-2" },
        userPrincipal
      )
    ).rejects.toHaveProperty("code", "idempotency_conflict");
  });

  it("keeps admin audit and read-only declarations explicit", () => {
    const listProfiles = expectRegisteredOperation(
      "admin.referral.listProfiles"
    );
    expect(listProfiles.access).toEqual({ kind: "admin" });
    expect(listProfiles.readOnly).toBe(true);
    expect(listProfiles.sideEffects).toEqual([]);

    const updateCode = expectRegisteredOperation(
      "admin.referral.updateUserCode"
    );
    expect(updateCode.access).toEqual({ kind: "admin" });
    expect(updateCode.readOnly).toBe(false);
    expect(updateCode.sideEffects).toEqual(["audit"]);

    const setRate = expectRegisteredOperation(
      "admin.referral.setUserCommissionRate"
    );
    expect(setRate.access).toEqual({ kind: "admin" });
    expect(setRate.readOnly).toBe(false);
    expect(setRate.sideEffects).toEqual(["audit"]);

    const cancel = expectRegisteredOperation(
      "admin.referral.cancelCommissionForOrder"
    );
    expect(cancel.access).toEqual({ kind: "admin" });
    expect(cancel.readOnly).toBe(false);
    expect(cancel.destructive).toBe(true);
    expect(cancel.idempotency).toEqual({
      kind: "required",
      keyField: "orderId",
      scope: "global",
    });
    expect(cancel.sideEffects).toEqual(["billing", "audit"]);
  });

  it("lets admin cancel commission by provider and order with audit reason", async () => {
    const result = await invokeOperation(
      "admin.referral.cancelCommissionForOrder",
      {
        provider: "creem",
        orderId: "order-1",
        reason: "manual refund reconciliation",
      },
      { type: "user", userId: "admin-1", role: "admin" }
    );

    expect(result).toMatchObject({
      provider: "creem",
      orderId: "order-1",
      canceledCount: 1,
    });
    expect(
      referralServiceMock.adminCancelReferralCommissionForOrder
    ).toHaveBeenCalledWith({
      provider: "creem",
      orderId: "order-1",
      adminUserId: "admin-1",
      reason: "manual refund reconciliation",
    });
  });
});
