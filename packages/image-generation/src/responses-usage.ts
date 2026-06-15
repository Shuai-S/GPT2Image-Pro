import type { ResponsesTokenUsage } from "./types";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getUsageNumber(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function extractResponsesTokenUsage(
  payload: unknown
): ResponsesTokenUsage | undefined {
  if (!isPlainRecord(payload)) return undefined;
  const usage = isPlainRecord(payload.usage) ? payload.usage : payload;
  if (!isPlainRecord(usage)) return undefined;

  const inputTokens = getUsageNumber(usage, "input_tokens");
  const outputTokens = getUsageNumber(usage, "output_tokens");
  const totalTokens = getUsageNumber(usage, "total_tokens");
  const inputDetails = isPlainRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : undefined;
  const cachedInputTokens =
    getUsageNumber(inputDetails || {}, "cached_tokens") ??
    getUsageNumber(inputDetails || {}, "cache_read_input_tokens") ??
    getUsageNumber(usage, "cached_input_tokens");

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cachedInputTokens === undefined
  ) {
    return undefined;
  }

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
  };
}
