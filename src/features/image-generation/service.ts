import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userApiConfig } from "@/db/schema";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  normalizeImageModel,
  parseImageSize,
} from "./resolution";
import type {
  ApiConfig,
  GenerateImageParams,
  GenerateImageResult,
} from "./types";

export async function getUserApiConfig(
  userId: string
): Promise<ApiConfig | null> {
  const config = await db
    .select()
    .from(userApiConfig)
    .where(eq(userApiConfig.userId, userId))
    .limit(1);

  const row = config[0];
  if (!row?.isActive || !row.baseUrl || !row.apiKey) {
    return null;
  }

  const result: ApiConfig = { baseUrl: row.baseUrl, apiKey: row.apiKey };
  const normalizedModel = normalizeImageModel(row.model);
  if (normalizedModel) result.model = normalizedModel;
  return result;
}

export function getEffectiveConfig(userConfig: ApiConfig | null): {
  config: ApiConfig;
  useCredits: boolean;
} {
  if (userConfig) {
    return { config: userConfig, useCredits: false };
  }
  throw new Error(
    "No default image backend is configured. Configure the image backend pool."
  );
}

export async function generateImage(
  config: ApiConfig,
  params: GenerateImageParams
): Promise<GenerateImageResult> {
  try {
    const size = params.size || DEFAULT_IMAGE_SIZE;
    const dimensions = parseImageSize(size);
    const response = await fetch(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model:
          normalizeImageModel(params.model) ||
          normalizeImageModel(config.model) ||
          DEFAULT_IMAGE_MODEL,
        prompt: params.prompt,
        n: params.n || 1,
        size,
        ...(dimensions
          ? { width: dimensions.width, height: dimensions.height }
          : {}),
        response_format: "b64_json",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        error:
          (errorData as Record<string, Record<string, string>>)?.error
            ?.message || `API error: ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    };
    const image = data.data?.[0];

    const result: GenerateImageResult = {};
    if (image?.b64_json) result.imageBase64 = image.b64_json;
    if (image?.url) result.imageUrl = image.url;
    if (image?.revised_prompt) result.revisedPrompt = image.revised_prompt;
    return result;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
