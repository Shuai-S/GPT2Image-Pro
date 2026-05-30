/**
 * 注册验证码的纯逻辑（DB-free）。
 *
 * 使用方：registration-verification.ts（负责 DB 读写 + 发信），本模块仅承载
 * 不依赖 @repo/database 的编码与状态机判定，以便 DB-free 单测覆盖安全分支
 * （A10 暴力破解防护：6 位码空间仅 10^6，靠尝试计数 + 上限作废兜底）。
 */

// 单个验证码的存活时间（分钟），用于计算 expiresAt。
export const EXPIRES_IN_MINUTES = 10;

// 验证码达到该错误尝试次数即作废，阻断暴力破解。
export const MAX_VERIFY_ATTEMPTS = 5;

// 同一邮箱两次发码之间的最小冷却（秒），防止对任意白名单邮箱无限轰炸
// （审计 S-H6：发码无每邮箱节流可放大邮件出账成本并骚扰受害者）。
export const RESEND_COOLDOWN_SECONDS = 60;

// value 字段编码为 `code|attempts`，用于在不新增列的前提下记录错误尝试次数。
// 仅本模块（PURPOSE 前缀的 identifier）使用该编码。
export function encodeCodeValue(code: string, attempts: number) {
  return `${code}|${attempts}`;
}

// 解码 `code|attempts`；对老数据（无分隔符）或非法 attempts（如 'code|NaN'）
// 一律回退 attempts=0，否则非法计数会使验证码永不作废，反成暴破口子。
export function decodeCodeValue(value: string): {
  code: string;
  attempts: number;
} {
  const separatorIndex = value.lastIndexOf("|");
  if (separatorIndex < 0) {
    return { code: value, attempts: 0 };
  }
  const code = value.slice(0, separatorIndex);
  const attempts = Number(value.slice(separatorIndex + 1));
  return { code, attempts: Number.isFinite(attempts) ? attempts : 0 };
}

/**
 * 判断与上一封验证码的间隔是否仍处于冷却期内。
 *
 * @param lastSentAt 上一封验证码的创建时间（verification.createdAt），无则视为可发
 * @param now 当前时间
 * @returns 仍在冷却期返回剩余秒数（向上取整，>=1）；可发送返回 0
 */
export function getResendCooldownRemainingSeconds(
  lastSentAt: Date | null | undefined,
  now: Date
): number {
  if (!lastSentAt) {
    return 0;
  }
  const elapsedMs = now.getTime() - lastSentAt.getTime();
  const remainingMs = RESEND_COOLDOWN_SECONDS * 1000 - elapsedMs;
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.ceil(remainingMs / 1000);
}

// evaluateVerificationAttempt 的判定结果。
// - outcome：本次校验语义；
// - shouldDelete：是否应删除该验证记录（成功消费、过期、锁定或达上限）；
// - nextValue：当 outcome='invalid' 且未达上限时需写回的新 value，否则为 null。
export type VerificationOutcome = "valid" | "invalid" | "expired" | "locked";

export interface VerificationAttemptDecision {
  outcome: VerificationOutcome;
  shouldDelete: boolean;
  nextValue: string | null;
}

/**
 * 验证码校验状态机（纯函数）。
 *
 * 输入一条验证记录、用户提交的码与当前时间，输出本次结果与应执行的 DB 副作用，
 * 由调用方据此读写 DB。与 verifyRegistrationCode 的原有分支顺序逐一对应：
 * 1. 过期 -> expired（删记录）；
 * 2. 已达上限 -> locked（删记录，阻断暴破）；
 * 3. 精确匹配 -> valid（删记录，消费验证码）；
 * 4. 不匹配 -> invalid，attempts+1：达上限删记录，否则写回新 value。
 */
export function evaluateVerificationAttempt(
  record: { value: string; expiresAt: Date },
  inputCode: string,
  now: Date
): VerificationAttemptDecision {
  if (record.expiresAt.getTime() < now.getTime()) {
    return { outcome: "expired", shouldDelete: true, nextValue: null };
  }

  const { code: storedCode, attempts } = decodeCodeValue(record.value);

  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    return { outcome: "locked", shouldDelete: true, nextValue: null };
  }

  if (storedCode === inputCode) {
    return { outcome: "valid", shouldDelete: true, nextValue: null };
  }

  const nextAttempts = attempts + 1;
  if (nextAttempts >= MAX_VERIFY_ATTEMPTS) {
    return { outcome: "invalid", shouldDelete: true, nextValue: null };
  }

  return {
    outcome: "invalid",
    shouldDelete: false,
    nextValue: encodeCodeValue(storedCode, nextAttempts),
  };
}
