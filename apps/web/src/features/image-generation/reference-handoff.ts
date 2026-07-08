export type ReferenceHandoffMode =
  | "image"
  | "chat"
  | "agent"
  | "waterfall"
  | "chat-web";

export type PendingReferenceHandoff = {
  id: string;
  mode: ReferenceHandoffMode;
  imageUrl: string;
  sourceId?: string;
  sourceName?: string;
  createdAt: number;
};

const STORAGE_KEY = "gpt2image_pending_create_reference_v1";
const MAX_AGE_MS = 10 * 60 * 1000;

function isBrowser() {
  return typeof window !== "undefined";
}

function isValidMode(value: unknown): value is ReferenceHandoffMode {
  return (
    value === "image" ||
    value === "chat" ||
    value === "agent" ||
    value === "waterfall" ||
    value === "chat-web"
  );
}

function normalizeHandoff(value: unknown): PendingReferenceHandoff | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.trim()) return null;
  if (typeof record.imageUrl !== "string" || !record.imageUrl.trim()) {
    return null;
  }
  if (!isValidMode(record.mode)) return null;
  const createdAt =
    typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
      ? record.createdAt
      : 0;
  if (!createdAt || Date.now() - createdAt > MAX_AGE_MS) return null;

  return {
    id: record.id,
    mode: record.mode,
    imageUrl: record.imageUrl,
    sourceId:
      typeof record.sourceId === "string" && record.sourceId.trim()
        ? record.sourceId
        : undefined,
    sourceName:
      typeof record.sourceName === "string" && record.sourceName.trim()
        ? record.sourceName
        : undefined,
    createdAt,
  };
}

export function writePendingReferenceHandoff(
  value: Omit<PendingReferenceHandoff, "createdAt">
) {
  if (!isBrowser()) return false;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...value, createdAt: Date.now() })
    );
    return true;
  } catch {
    return false;
  }
}

export function consumePendingReferenceHandoff(
  id?: string | null
): PendingReferenceHandoff | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = normalizeHandoff(JSON.parse(raw));
    if (!parsed || (id && parsed.id !== id)) return null;
    window.sessionStorage.removeItem(STORAGE_KEY);
    return parsed;
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function normalizeReferenceFetchUrl(imageUrl: string) {
  if (/^(https?:|data:|blob:)/i.test(imageUrl)) return imageUrl;
  if (!isBrowser()) return imageUrl;
  return new URL(imageUrl, window.location.origin).toString();
}
