export type ResponsesImageGenerationOutputItem = {
  type?: string;
  result?:
    | string
    | {
        b64_json?: unknown;
        base64?: unknown;
        image?: unknown;
        data?: unknown;
      };
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function extractResponsesImageCallBase64(
  item: ResponsesImageGenerationOutputItem | undefined
) {
  if (item?.type !== "image_generation_call") return undefined;
  const result = item.result;
  if (typeof result === "string") {
    const trimmed = result.trim();
    return trimmed || undefined;
  }
  if (!isPlainRecord(result)) return undefined;
  for (const key of ["b64_json", "base64", "image", "data"] as const) {
    const value = result[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
