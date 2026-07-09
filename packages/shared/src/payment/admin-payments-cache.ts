/**
 * 管理端支付聚合缓存的 tag 与失效入口
 *
 * 职责：单点定义 admin/payments 聚合统计(订单总数/状态分组汇总)的缓存 tag，
 * 并提供带降级的失效函数。独立成小模块的原因：epay 写入路径(webhook/回调)
 * 需要在订单状态变化后失效缓存，若直接 import UOL 操作模块会提前触发
 * defineOperation 注册副作用并拉大 webhook 依赖链。
 *
 * 使用方：uol/operations/admin-payments.ts(缓存声明)、payment/epay.ts(写入失效)。
 * 关键依赖：next/cache 的 revalidateTag。
 */

import { revalidateTag } from "next/cache";

import { logWarn } from "../logger";

/**
 * admin/payments 聚合统计(A1 订单总数 + A2 状态分组汇总)的缓存 tag。
 *
 * 聚合只读取 epay_order 表,因此失效触点只需覆盖 epay_order 的写入点
 * (saveEpayOrder/updateEpayOrderStatus/claimEpayOrderForFulfillment);
 * credits_batch/credits_transaction 明细不经缓存,无需失效。
 */
export const ADMIN_PAYMENTS_CACHE_TAG = "admin-payments-aggregate";

/**
 * 失效 admin/payments 聚合缓存。
 *
 * WHY: 用 revalidateTag 而非 updateTag——epay 写入点由 webhook/回调 route handler
 * 调用,updateTag 仅限 Server Action 上下文。失效失败(边缘上下文)不阻断支付
 * 主流程:聚合缓存另有 TTL 兜底,数据陈旧的代价远小于订单状态更新失败。
 *
 * @sideEffects 标记 ADMIN_PAYMENTS_CACHE_TAG 为待失效;失败仅记日志。
 */
export function invalidateAdminPaymentsCache(): void {
  try {
    // Next 16 要求显式 profile:"max" 表示立即彻底失效(等价旧单参语义)。
    revalidateTag(ADMIN_PAYMENTS_CACHE_TAG, "max");
  } catch (error) {
    logWarn("Admin payments cache invalidation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}