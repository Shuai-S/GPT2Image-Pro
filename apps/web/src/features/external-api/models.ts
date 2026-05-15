import { logError } from "@repo/shared/logger";

import {
  DEFAULT_IMAGE_MODEL,
  normalizeImageModel,
} from "@/features/image-generation/resolution";
import {
  getEffectiveConfig,
  getUserApiConfig,
} from "@/features/image-generation/service";
import type { ApiConfig } from "@/features/image-generation/types";

const MODEL_FETCH_TIMEOUT_MS = 5000;
const DEFAULT_MODEL_OWNER = "gpt2image";

type OpenAIModel = {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  [key: string]: unknown;
};

export type OpenAIModelList = {
  object: "list";
  data: OpenAIModel[];
};

function buildModelsUrl(baseUrl: string) {
  return new URL(
    "models",
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  ).toString();
}

function getFallbackModelId(config: ApiConfig) {
  return normalizeImageModel(config.model) || DEFAULT_IMAGE_MODEL;
}

function toFallbackModel(id: string): OpenAIModel {
  return {
    id,
    object: "model",
    created: 0,
    owned_by: DEFAULT_MODEL_OWNER,
  };
}

function normalizeModel(model: unknown): OpenAIModel | null {
  if (!model || typeof model !== "object") return null;

  const source = model as Record<string, unknown>;
  const id = source.id;
  if (typeof id !== "string" || !id.trim()) return null;

  return {
    ...source,
    id: id.trim(),
    object: typeof source.object === "string" ? source.object : "model",
    created: typeof source.created === "number" ? source.created : 0,
    owned_by:
      typeof source.owned_by === "string"
        ? source.owned_by
        : DEFAULT_MODEL_OWNER,
  };
}

function getModelsFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];

  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) return data;

  return [];
}

function withFallbackModel(models: OpenAIModel[], fallbackModelId: string) {
  const seen = new Set<string>();
  const data: OpenAIModel[] = [];

  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    data.push(model);
  }

  if (!seen.has(fallbackModelId)) {
    data.push(toFallbackModel(fallbackModelId));
  }

  return data;
}

async function fetchUpstreamModels(config: ApiConfig) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(buildModelsUrl(config.baseUrl), {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    return getModelsFromPayload(payload)
      .map(normalizeModel)
      .filter((model): model is OpenAIModel => Boolean(model));
  } finally {
    clearTimeout(timeout);
  }
}

export async function getExternalModelsForUser(
  userId: string
): Promise<OpenAIModelList> {
  const userConfig = await getUserApiConfig(userId);
  const { config } = getEffectiveConfig(userConfig);
  const fallbackModelId = getFallbackModelId(config);

  try {
    const upstreamModels = await fetchUpstreamModels(config);
    return {
      object: "list",
      data: withFallbackModel(upstreamModels, fallbackModelId),
    };
  } catch (error) {
    logError(error, {
      source: "external-api",
      operation: "models.list",
      baseUrl: config.baseUrl,
    });

    return {
      object: "list",
      data: [toFallbackModel(fallbackModelId)],
    };
  }
}
