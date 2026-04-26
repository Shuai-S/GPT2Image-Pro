import { readFile } from "node:fs/promises";
import path, { resolve, sep } from "node:path";
import { type NextRequest, NextResponse } from "next/server";

const BASE_DIR = process.env.LOCAL_STORAGE_PATH || "./storage";

const ALLOWED_BUCKETS = new Set([
  process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME || "avatars",
  process.env.NEXT_PUBLIC_GENERATIONS_BUCKET_NAME || "generations",
]);

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ bucket: string; key: string[] }> }
) {
  const { bucket, key } = await params;
  const fileKey = key.join("/");

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "Bucket not allowed" }, { status: 403 });
  }

  if (fileKey.includes("..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const filePath = path.join(BASE_DIR, bucket, fileKey);

  // 防止路径遍历攻击：确保解析后的路径在允许的目录范围内
  const resolvedPath = resolve(filePath);
  const resolvedBase = resolve(BASE_DIR, bucket);
  if (
    !resolvedPath.startsWith(resolvedBase + sep) &&
    resolvedPath !== resolvedBase
  ) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const ext = path.extname(fileKey).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || "application/octet-stream";

  try {
    const data = await readFile(filePath);
    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, immutable",
        "Content-Length": String(data.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
