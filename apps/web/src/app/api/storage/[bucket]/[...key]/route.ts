import { getStorageProvider } from "@repo/shared/storage/providers";
import { type NextRequest, NextResponse } from "next/server";
import path from "node:path";

const GENERATIONS_BUCKET =
  process.env.NEXT_PUBLIC_GENERATIONS_BUCKET_NAME || "generations";

const ALLOWED_BUCKETS = new Set([
  process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME || "avatars",
  GENERATIONS_BUCKET,
]);

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const GENERATION_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800, immutable";
const PUBLIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ bucket: string; key: string[] }> }
) {
  const { bucket, key } = await params;
  const fileKey = key.join("/");

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "Bucket not allowed" }, { status: 403 });
  }

  if (
    !fileKey ||
    fileKey.includes("..") ||
    fileKey.startsWith("/") ||
    fileKey.includes("\\")
  ) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const ext = path.extname(fileKey).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || "application/octet-stream";

  try {
    const storage = await getStorageProvider();
    const data = await storage.getObject(fileKey, bucket);
    const cacheControl =
      bucket === GENERATIONS_BUCKET
        ? GENERATION_CACHE_CONTROL
        : PUBLIC_ASSET_CACHE_CONTROL;
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        "CDN-Cache-Control": cacheControl,
        "Cloudflare-CDN-Cache-Control": cacheControl,
        "Content-Length": String(data.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
