/**
 * 注册邮箱验证码服务。
 *
 * 职责：发送公开注册验证码、校验验证码状态机并维护 verification 表中的验证码记录。
 * 使用方：注册验证码 API、UOL user.sendVerificationCode/user.verifyCode、Better Auth 注册钩子。
 * 关键依赖：system-settings 读取邮箱后缀白名单、registration-identity 查重、mail 发送验证码邮件。
 */
import { randomInt, randomUUID } from "node:crypto";
import { db, verification } from "@repo/database";
import { eq } from "drizzle-orm";
import { getRuntimeBrandingConfig } from "../config/branding";
import { RegistrationVerificationCodeEmail } from "../mail/templates/primary-action-email";
import { sendEmail } from "../mail/utils";
import { getRuntimeRegistrationEmailDomains } from "../system-settings";
import {
  getAllowedRegistrationEmailMessage,
  isAllowedRegistrationEmail,
  normalizeEmail,
} from "./email-domain";
import { isRegistrationEmailTaken } from "./registration-identity";
import {
  EXPIRES_IN_MINUTES,
  encodeCodeValue,
  evaluateVerificationAttempt,
  getResendCooldownRemainingSeconds,
} from "./registration-verification-core";
import { isSelfUseModeEnabled } from "./self-use-mode";

const PURPOSE = "registration-email-code";
const CODE_LENGTH = 6;

function getIdentifier(email: string) {
  return `${PURPOSE}:${normalizeEmail(email)}`;
}

function generateCode() {
  return Array.from({ length: CODE_LENGTH }, () => randomInt(0, 10)).join("");
}

export async function sendRegistrationVerificationCode(email: string) {
  if (await isSelfUseModeEnabled()) {
    throw new Error("Registration is disabled in self-use mode");
  }

  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Invalid email address");
  }

  const allowedDomains = await getRuntimeRegistrationEmailDomains();

  if (!isAllowedRegistrationEmail(normalizedEmail, allowedDomains)) {
    throw new Error(getAllowedRegistrationEmailMessage(allowedDomains));
  }

  if (await isRegistrationEmailTaken(normalizedEmail)) {
    throw new Error("Email already registered");
  }

  const identifier = getIdentifier(normalizedEmail);

  // 每邮箱发码冷却（审计 S-H6）：复用上一封验证码行的 createdAt 判断间隔，
  // 冷却期内拒绝再次发送，防止对任意白名单邮箱无限轰炸放大邮件出账成本。
  const [existing] = await db
    .select({ createdAt: verification.createdAt })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1);

  const cooldownRemaining = getResendCooldownRemainingSeconds(
    existing?.createdAt,
    new Date()
  );
  if (cooldownRemaining > 0) {
    throw new Error(
      `Please wait ${cooldownRemaining} seconds before requesting another code`
    );
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + EXPIRES_IN_MINUTES * 60 * 1000);

  await db.delete(verification).where(eq(verification.identifier, identifier));
  await db.insert(verification).values({
    id: randomUUID(),
    identifier,
    value: encodeCodeValue(code, 0),
    expiresAt,
  });

  const branding = await getRuntimeBrandingConfig();
  const result = await sendEmail({
    to: normalizedEmail,
    subject: `Your ${branding.name} verification code`,
    react: RegistrationVerificationCodeEmail({
      code,
      expiresIn: `${EXPIRES_IN_MINUTES} minutes`,
      appName: branding.name,
    }),
  });

  if (!result.success) {
    await db
      .delete(verification)
      .where(eq(verification.identifier, identifier));
    throw new Error(result.error || "Failed to send verification code");
  }

  return { simulated: result.simulated ?? false };
}

export async function verifyRegistrationCode(email: string, code: string) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = code.trim();

  if (!normalizedEmail || !normalizedCode) {
    return false;
  }

  const identifier = getIdentifier(normalizedEmail);
  const [record] = await db
    .select()
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1);

  if (!record) {
    return false;
  }

  // 状态机判定（过期 / 锁定 / 匹配 / 失败计数）抽到 DB-free 纯函数，
  // 这里只按其结论执行对应的 DB 副作用（删除或写回新尝试次数）。
  const decision = evaluateVerificationAttempt(
    record,
    normalizedCode,
    new Date()
  );

  if (decision.shouldDelete) {
    await db.delete(verification).where(eq(verification.id, record.id));
    return decision.outcome === "valid";
  }

  if (decision.nextValue !== null) {
    await db
      .update(verification)
      .set({ value: decision.nextValue })
      .where(eq(verification.id, record.id));
  }

  return false;
}
