/**
 * Better Auth 注册安全钩子。
 *
 * 职责：在公开注册链路统一执行自用模式、邮箱后缀白名单、验证码、重复注册和封禁校验。
 * 使用方：auth/index.ts 的 Better Auth plugins 配置。
 * 关键依赖：system-settings 读取邮箱白名单、registration-identity 防重复注册、UOL referral 绑定邀请。
 */
import { db, user as userTable } from "@repo/database";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import { logError } from "../logger";
import { getRuntimeRegistrationEmailDomains } from "../system-settings";
import { invokeOperation } from "../uol";
import "../uol/operations/referral";
import {
  getAllowedRegistrationEmailMessage,
  isAllowedRegistrationEmail,
  normalizeEmail,
} from "./email-domain";
import {
  isRegistrationEmailTaken,
  markRegistrationIdentityDeleted,
  recordRegistrationIdentity,
} from "./registration-identity";
import { verifyRegistrationCode } from "./registration-verification";
import { isSelfUseModeEnabled } from "./self-use-mode";

function isPublicRegistrationPath(path?: string) {
  return (
    path === "/sign-up/email" ||
    path === "/sign-in/social" ||
    Boolean(path?.startsWith("/callback/"))
  );
}

async function assertRegistrationOpen() {
  if (await isSelfUseModeEnabled()) {
    throw new APIError("FORBIDDEN", {
      message: "Registration is disabled in self-use mode",
      code: "REGISTRATION_DISABLED",
    });
  }
}

async function assertAllowedRegistrationEmail(email: string) {
  const allowedDomains = await getRuntimeRegistrationEmailDomains();
  if (!isAllowedRegistrationEmail(email, allowedDomains)) {
    throw new APIError("BAD_REQUEST", {
      message: getAllowedRegistrationEmailMessage(allowedDomains),
      code: "EMAIL_DOMAIN_NOT_ALLOWED",
    });
  }
}

async function assertEmailNotRegistered(email: string) {
  const normalizedEmail = normalizeEmail(email);

  if (await isRegistrationEmailTaken(normalizedEmail)) {
    throw new APIError("BAD_REQUEST", {
      message: "Email already registered",
      code: "EMAIL_ALREADY_REGISTERED",
    });
  }
}

async function assertUserCanAuthenticate(userId: string) {
  const [existingUser] = await db
    .select({
      id: userTable.id,
      banned: userTable.banned,
      bannedReason: userTable.bannedReason,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  if (!existingUser?.banned) return;

  // 任意 banned=true 都拒绝创建会话/账户，不再只拦 account_deleted。
  // 否则管理员的普通封禁（banUserAction 写入的 banned=true + 普通原因）在 Web 通道形同摆设，
  // 被封用户重新登录即可创建新会话照常调用受保护操作（生图/扣费/工单/设置）。
  if (existingUser.bannedReason === "account_deleted") {
    throw new APIError("FORBIDDEN", {
      message: "Account has been deleted",
      code: "ACCOUNT_DELETED",
    });
  }

  throw new APIError("FORBIDDEN", {
    message: "Account has been banned",
    code: "ACCOUNT_BANNED",
  });
}

export const registrationVerificationPlugin = (): BetterAuthPlugin => ({
  id: "registration-verification",
  hooks: {
    before: [
      {
        matcher: (context) => context.path === "/sign-up/email",
        handler: createAuthMiddleware(async (ctx) => {
          await assertRegistrationOpen();

          const email =
            typeof ctx.body.email === "string" ? ctx.body.email : "";
          const verificationCode =
            typeof ctx.body.verificationCode === "string"
              ? ctx.body.verificationCode
              : "";
          const normalizedEmail = normalizeEmail(email);

          await assertAllowedRegistrationEmail(normalizedEmail);
          await assertEmailNotRegistered(normalizedEmail);

          if (!verificationCode) {
            throw new APIError("BAD_REQUEST", {
              message: "Verification code is required",
              code: "VERIFICATION_CODE_REQUIRED",
            });
          }

          const valid = await verifyRegistrationCode(
            normalizedEmail,
            verificationCode
          );

          if (!valid) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid or expired verification code",
              code: "INVALID_VERIFICATION_CODE",
            });
          }

          delete ctx.body.verificationCode;
          ctx.body.email = normalizedEmail;
          ctx.body.emailVerified = true;
        }),
      },
    ],
  },
  init: () => ({
    options: {
      databaseHooks: {
        user: {
          create: {
            before: async (user, context) => {
              if (isPublicRegistrationPath(context?.path)) {
                await assertRegistrationOpen();
              }

              const normalizedEmail = normalizeEmail(user.email);

              await assertAllowedRegistrationEmail(normalizedEmail);
              await assertEmailNotRegistered(normalizedEmail);

              if (context?.path === "/sign-up/email") {
                return {
                  data: {
                    ...user,
                    email: normalizedEmail,
                    emailVerified: true,
                  },
                };
              }

              return {
                data: {
                  ...user,
                  email: normalizedEmail,
                },
              };
            },
            after: async (user, context) => {
              await recordRegistrationIdentity(user.email, user.id);
              const referralCode =
                typeof context?.body?.referralCode === "string"
                  ? context.body.referralCode
                  : typeof context?.body?.ref === "string"
                    ? context.body.ref
                    : "";
              if (referralCode) {
                // WHY: 邀请绑定是注册的附属动作，失败（DB 抖动、码失效）不应
                // 中断已完成的注册流程，记错误日志供事后排查即可。
                try {
                  await invokeOperation(
                    "referral.bindInviterByCode",
                    {
                      inviteeUserId: user.id,
                      code: referralCode,
                      metadata: {
                        source: "sign-up",
                        path: context?.path,
                      },
                    },
                    { type: "system", reason: "registration-referral-binding" }
                  );
                } catch (error) {
                  logError(error, {
                    source: "registration-referral-binding",
                    userId: user.id,
                    referralCode,
                  });
                }
              }
            },
          },
          delete: {
            after: async (user) => {
              await markRegistrationIdentityDeleted(user.email, user.id);
            },
          },
        },
        account: {
          create: {
            before: async (account) => {
              await assertUserCanAuthenticate(account.userId);
              return { data: account };
            },
          },
        },
        session: {
          create: {
            before: async (session) => {
              await assertUserCanAuthenticate(session.userId);
              return { data: session };
            },
          },
        },
      },
    },
  }),
});
