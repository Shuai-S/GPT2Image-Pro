/**
 * 邀请返佣纯规则
 *
 * 使用方：referral 核心服务、邀请链接路由、单元测试。
 * 关键依赖：无数据库依赖，保持 DB-free 以便覆盖金额、邀请码和边界规则。
 */

export const REFERRAL_CODE_LENGTH = 10;
export const REFERRAL_CODE_MIN_LENGTH = 4;
export const REFERRAL_CODE_MAX_LENGTH = 32;
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_ATTRIBUTION_COOKIE = "gpt2image_referral_code";

const CENTS_PER_CREDIT = 1;

/**
 * 归一化用户输入的邀请码。
 *
 * @param code - 用户输入、URL 参数或 Cookie 中的邀请码。
 * @returns 去除首尾空白并转为大写后的邀请码。
 * @sideEffects 无。
 */
export function normalizeReferralCode(code: string) {
  return code.trim().toUpperCase();
}

/**
 * 校验邀请码格式。
 *
 * @param code - 已归一化或原始邀请码。
 * @returns 长度与字符集均合法时返回 true。
 * @sideEffects 无。
 */
export function isValidReferralCode(code: string) {
  const normalized = normalizeReferralCode(code);
  if (
    normalized.length < REFERRAL_CODE_MIN_LENGTH ||
    normalized.length > REFERRAL_CODE_MAX_LENGTH
  ) {
    return false;
  }
  return /^[A-Z0-9_-]+$/.test(normalized);
}

/**
 * 将返佣金额分转换为积分。
 *
 * @param cents - 返佣金额，单位为归一后的人民币分。
 * @returns 可发放的积分数量，保留两位小数。
 * @sideEffects 无。
 */
export function centsToCredits(cents: number) {
  return Math.round((cents / CENTS_PER_CREDIT) * 100) / 100;
}

/**
 * 将订单金额按币种归一为人民币分。
 *
 * WHY: Creem 走 USD cents，易支付/支付宝走 CNY 分。返佣以分为单位计算积分，
 * 业务口径要求按人民币返利：充值 10 元、10% 返利即 1 元，再按 1 分对应
 * 1 积分发放。美元订单先折成人民币分，保证跨支付通道价值一致。未知币种
 * 返回 null，由调用方拒绝入账。
 *
 * @param amountCents - 订单实付金额，单位为原币种最小单位（分）。
 * @param currency - 订单币种代码，大小写不敏感。
 * @param cnyPerUsd - CNY 兑 USD 汇率（1 USD 等于多少 CNY）。
 * @returns 归一后的人民币分（向下取整），入参非法或币种不支持时返回 null。
 * @sideEffects 无。
 */
export function normalizeOrderAmountToCnyCents(
  amountCents: number,
  currency: string,
  cnyPerUsd: number
) {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return null;
  const code = currency.trim().toUpperCase();
  if (code === "CNY") return Math.trunc(amountCents);
  if (code === "USD") {
    if (!Number.isFinite(cnyPerUsd) || cnyPerUsd <= 0) return null;
    return Math.floor(Math.trunc(amountCents) * cnyPerUsd);
  }
  return null;
}

/**
 * 计算单笔订单可产生的返佣金额。
 *
 * @param orderAmountCents - 订单实付金额，单位为分。
 * @param rateBps - 返佣比例，10000 表示 100%。
 * @param existingCents - 该邀请人从同一被邀请人已累计获得的返佣金额。
 * @param capCents - 单个被邀请人的返佣上限，0 表示不限。
 * @returns 本次可入账返佣金额，单位为分。
 * @sideEffects 无。
 */
export function calculateReferralCommissionCents(
  orderAmountCents: number,
  rateBps: number,
  existingCents = 0,
  capCents = 0
) {
  if (
    !Number.isFinite(orderAmountCents) ||
    !Number.isFinite(rateBps) ||
    orderAmountCents <= 0 ||
    rateBps <= 0
  ) {
    return 0;
  }

  const baseCommission = Math.floor(
    (Math.trunc(orderAmountCents) * Math.trunc(rateBps)) / 10000
  );
  if (baseCommission <= 0) return 0;

  if (!Number.isFinite(capCents) || capCents <= 0) {
    return baseCommission;
  }

  const used = Math.max(0, Math.trunc(existingCents));
  const remaining = Math.max(0, Math.trunc(capCents) - used);
  return Math.min(baseCommission, remaining);
}
