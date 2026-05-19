"use server";

import { randomBytes, createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "@repo/database";
import { externalApiKey } from "@repo/database/schema";
import { listImageBackendGroupOptions } from "@/features/image-backend-pool/service";
import {
  canUseExternalApi,
  normalizeModerationBlockRiskLevelForPlan,
} from "@repo/shared/config/subscription-plan";
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
  return plan.plan;
}

async function normalizeSelectableGenerationGroupId(groupId?: string | null) {
  if (!groupId || groupId === "default") return null;
  const groups = await listImageBackendGroupOptions({ userSelectableOnly: true });
  if (!groups.some((group) => group.id === groupId)) {
    throw new Error("Image backend group is not selectable");
  }
  return groupId;
}

export const getExternalApiKeys = withExternalApiKeyAction("list").action(
  async ({ ctx }) => {
    const keys = await db
      .select({
        id: externalApiKey.id,
        name: externalApiKey.name,
        keyPrefix: externalApiKey.keyPrefix,
        lastFour: externalApiKey.lastFour,
        moderationBlockRiskLevel: externalApiKey.moderationBlockRiskLevel,
        generationGroupId: externalApiKey.generationGroupId,
        lastUsedAt: externalApiKey.lastUsedAt,
        isActive: externalApiKey.isActive,
        createdAt: externalApiKey.createdAt,
      })
      .from(externalApiKey)
      .where(eq(externalApiKey.userId, ctx.userId))
      .orderBy(desc(externalApiKey.createdAt));

    const groups = await listImageBackendGroupOptions({
      userSelectableOnly: true,
    });
    return { keys, groups };
  }
);

export const createExternalApiKey = withExternalApiKeyAction("create")
  .schema(
    z.object({
      name: z.string().trim().min(1).max(80).optional(),
      moderationBlockRiskLevel: z.enum(["low", "medium", "high"]).optional(),
      generationGroupId: z.string().trim().optional().nullable(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const plan = await ensureExternalApiAllowed(ctx.userId);

    const apiKey = createApiKey();
    const keyPrefix = apiKey.slice(0, 7);
    const generationGroupId = await normalizeSelectableGenerationGroupId(
      parsedInput.generationGroupId
    );

    await db.insert(externalApiKey).values({
      id: nanoid(),
      userId: ctx.userId,
      name: parsedInput.name || "默认 API Key",
      keyPrefix,
      keyHash: hashApiKey(apiKey),
      lastFour: apiKey.slice(-4),
      moderationBlockRiskLevel: normalizeModerationBlockRiskLevelForPlan(
        plan,
        parsedInput.moderationBlockRiskLevel
      ),
      generationGroupId,
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

export const updateExternalApiKeyModeration = withExternalApiKeyAction(
  "updateModeration"
)
  .schema(
    z.object({
      id: z.string().min(1),
      moderationBlockRiskLevel: z.enum(["low", "medium", "high"]),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const plan = await ensureExternalApiAllowed(ctx.userId);
    const normalized = normalizeModerationBlockRiskLevelForPlan(
      plan,
      parsedInput.moderationBlockRiskLevel
    );

    await db
      .update(externalApiKey)
      .set({
        moderationBlockRiskLevel: normalized,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(externalApiKey.id, parsedInput.id),
          eq(externalApiKey.userId, ctx.userId)
        )
      );

    return { success: true, moderationBlockRiskLevel: normalized };
  });

export const updateExternalApiKeyGroup = withExternalApiKeyAction("updateGroup")
  .schema(
    z.object({
      id: z.string().min(1),
      generationGroupId: z.string().trim().optional().nullable(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    await ensureExternalApiAllowed(ctx.userId);
    const generationGroupId = await normalizeSelectableGenerationGroupId(
      parsedInput.generationGroupId
    );
    await db
      .update(externalApiKey)
      .set({
        generationGroupId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(externalApiKey.id, parsedInput.id),
          eq(externalApiKey.userId, ctx.userId)
        )
      );

    return { success: true };
  });
