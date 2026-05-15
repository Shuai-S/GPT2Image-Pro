"use server";

import { randomBytes, createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "@repo/database";
import { externalApiKey } from "@repo/database/schema";
import { canUseExternalApi } from "@repo/shared/config/subscription-plan";
import { protectedAction } from "@repo/shared/safe-action";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";

const API_KEY_PREFIX = "g2i";

function hashApiKey(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

function createApiKey() {
  return `${API_KEY_PREFIX}_${randomBytes(32).toString("base64url")}`;
}

const withExternalApiKeyAction = (name: string) =>
  protectedAction.metadata({ action: `settings.externalApiKey.${name}` });

async function ensureExternalApiAllowed(userId: string) {
  const plan = await getUserPlan(userId);
  if (!canUseExternalApi(plan.plan)) {
    throw new Error("External API access requires Starter plan or higher.");
  }
}

export const getExternalApiKeys = withExternalApiKeyAction("list").action(
  async ({ ctx }) => {
    const keys = await db
      .select({
        id: externalApiKey.id,
        name: externalApiKey.name,
        keyPrefix: externalApiKey.keyPrefix,
        lastFour: externalApiKey.lastFour,
        lastUsedAt: externalApiKey.lastUsedAt,
        isActive: externalApiKey.isActive,
        createdAt: externalApiKey.createdAt,
      })
      .from(externalApiKey)
      .where(eq(externalApiKey.userId, ctx.userId))
      .orderBy(desc(externalApiKey.createdAt));

    return keys;
  }
);

export const createExternalApiKey = withExternalApiKeyAction("create")
  .schema(
    z.object({
      name: z.string().trim().min(1).max(80).optional(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    await ensureExternalApiAllowed(ctx.userId);

    const apiKey = createApiKey();
    const keyPrefix = apiKey.slice(0, 7);

    await db.insert(externalApiKey).values({
      id: nanoid(),
      userId: ctx.userId,
      name: parsedInput.name || "默认 API Key",
      keyPrefix,
      keyHash: hashApiKey(apiKey),
      lastFour: apiKey.slice(-4),
    });

    return { apiKey };
  });

export const revokeExternalApiKey = withExternalApiKeyAction("revoke")
  .schema(
    z.object({
      id: z.string().min(1),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const keys = await db
      .select({ id: externalApiKey.id })
      .from(externalApiKey)
      .where(
        and(
          eq(externalApiKey.id, parsedInput.id),
          eq(externalApiKey.userId, ctx.userId)
        )
      )
      .limit(1);

    if (!keys[0]) {
      throw new Error("API key not found");
    }

    await db
      .update(externalApiKey)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(externalApiKey.id, parsedInput.id),
          eq(externalApiKey.userId, ctx.userId)
        )
      );

    return { success: true };
  });
