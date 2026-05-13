import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
  getAllowedRegistrationEmailMessage,
  isAllowedRegistrationEmail,
} from "./email-domain";
import { verifyRegistrationCode } from "./registration-verification";

function assertAllowedRegistrationEmail(email: string) {
  if (!isAllowedRegistrationEmail(email)) {
    throw new APIError("BAD_REQUEST", {
      message: getAllowedRegistrationEmailMessage(),
      code: "EMAIL_DOMAIN_NOT_ALLOWED",
    });
  }
}

export const registrationVerificationPlugin = (): BetterAuthPlugin => ({
  id: "registration-verification",
  hooks: {
    before: [
      {
        matcher: (context) => context.path === "/sign-up/email",
        handler: createAuthMiddleware(async (ctx) => {
          const email =
            typeof ctx.body.email === "string" ? ctx.body.email : "";
          const verificationCode =
            typeof ctx.body.verificationCode === "string"
              ? ctx.body.verificationCode
              : "";

          assertAllowedRegistrationEmail(email);

          if (!verificationCode) {
            throw new APIError("BAD_REQUEST", {
              message: "Verification code is required",
              code: "VERIFICATION_CODE_REQUIRED",
            });
          }

          const valid = await verifyRegistrationCode(email, verificationCode);

          if (!valid) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid or expired verification code",
              code: "INVALID_VERIFICATION_CODE",
            });
          }

          delete ctx.body.verificationCode;
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
              assertAllowedRegistrationEmail(user.email);

              if (context?.path === "/sign-up/email") {
                return {
                  data: {
                    ...user,
                    emailVerified: true,
                  },
                };
              }

              return {
                data: {
                  ...user,
                },
              };
            },
          },
        },
      },
    },
  }),
});
