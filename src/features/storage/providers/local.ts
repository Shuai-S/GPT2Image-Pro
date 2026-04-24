import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { StorageProvider } from "../types";

const BASE_DIR = process.env.LOCAL_STORAGE_PATH || "./storage";

function safePath(bucket: string, key: string): string {
  if (key.includes("..") || bucket.includes("..")) {
    throw new Error("Invalid path: directory traversal not allowed");
  }
  return path.join(BASE_DIR, bucket, key);
}

function getContentType(key: string): string {
  const ext = path.extname(key).toLowerCase();
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  return types[ext] || "application/octet-stream";
}

export const localProvider: StorageProvider = {
  async getSignedUrl(key: string, bucket: string): Promise<string> {
    const generationsBucket =
      process.env.NEXT_PUBLIC_GENERATIONS_BUCKET_NAME || "generations";
    if (bucket === generationsBucket) {
      return `/api/storage/${bucket}/${key}`;
    }
    return `/api/storage/${bucket}/${key}`;
  },

  async getSignedUploadUrl(
    key: string,
    bucket: string,
    _contentType: string
  ): Promise<string> {
    return `/api/storage/${bucket}/${key}`;
  },

  async deleteObject(key: string, bucket: string): Promise<void> {
    const filePath = safePath(bucket, key);
    try {
      await unlink(filePath);
    } catch {
      // File may not exist
    }
  },

  async getObject(key: string, bucket: string): Promise<Buffer> {
    const filePath = safePath(bucket, key);
    return readFile(filePath);
  },

  async putObject(
    key: string,
    bucket: string,
    data: Buffer,
    _contentType: string
  ): Promise<void> {
    const filePath = safePath(bucket, key);
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, data);
  },
};

export { getContentType };
