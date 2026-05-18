import "server-only";

import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { desc } from "drizzle-orm";

export type GenerationErrorCategory =
  | "platform"
  | "moderation"
  | "user_request";

export type GenerationSlaStats = {
  sampleSize: number;
  completed: number;
  failed: number;
  successRate: number;
  platformErrors: number;
  moderationErrors: number;
  userRequestErrors: number;
};

const USER_REQUEST_PATTERNS = [
  "insufficient credits",
  "requires pro plan",
  "requires starter",
  "requires ultra",
  "requires enterprise",
  "invalid model",
  "unsupported model",
  "prompt exceeds",
  "context prompt exceeds",
  "chat input context",
  "invalid quality",
  "invalid moderation",
  "invalid thinking",
  "invalid display size",
  "invalid resolution",
  "use widthxheight",
  "must be between",
  "total pixels",
  "no more than",
  "at least one source image",
  "source images must be",
  "reference images must be",
  "mask must be",
  "is empty",
  "exceeds the",
  "total upload size",
  "upload is too large",
  "invalid or missing api key",
  "unauthorized",
  "account frozen",
];

const MODERATION_PATTERNS = [
  "moderation",
  "content failed moderation",
  "content blocked",
  "content moderation",
  "aliyun",
  "omni-moderation",
  "risklevel",
];

function includesAny(value: string, patterns: string[]) {
  return patterns.some((pattern) => value.includes(pattern));
}

export function classifyGenerationError(error: string | null | undefined) {
  const normalized = (error || "").toLowerCase();
  if (includesAny(normalized, MODERATION_PATTERNS)) {
    return "moderation" satisfies GenerationErrorCategory;
  }
  if (includesAny(normalized, USER_REQUEST_PATTERNS)) {
    return "user_request" satisfies GenerationErrorCategory;
  }
  return "platform" satisfies GenerationErrorCategory;
}

export async function getRecentGenerationSlaStats(
  limit = 1000
): Promise<GenerationSlaStats> {
  const rows = await db
    .select({
      status: generation.status,
      error: generation.error,
    })
    .from(generation)
    .orderBy(desc(generation.createdAt))
    .limit(limit);

  let completed = 0;
  let failed = 0;
  let platformErrors = 0;
  let moderationErrors = 0;
  let userRequestErrors = 0;

  for (const row of rows) {
    if (row.status === "completed") {
      completed += 1;
      continue;
    }
    if (row.status !== "failed") continue;

    failed += 1;
    const category = classifyGenerationError(row.error);
    if (category === "moderation") {
      moderationErrors += 1;
    } else if (category === "user_request") {
      userRequestErrors += 1;
    } else {
      platformErrors += 1;
    }
  }

  const denominator = completed + platformErrors;
  const successRate = denominator > 0 ? completed / denominator : 1;

  return {
    sampleSize: rows.length,
    completed,
    failed,
    successRate,
    platformErrors,
    moderationErrors,
    userRequestErrors,
  };
}
