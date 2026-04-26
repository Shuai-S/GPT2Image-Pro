import type { StorageProvider } from "../types";

const BASE_DIR = process.env.LOCAL_STORAGE_PATH || "./storage";

async function getFs() {
  return await import("node:fs/promises");
}

async function getPath() {
  return (await import("node:path")).default;
}

async function safePath(bucket: string, key: string): Promise<string> {
  if (key.includes("..") || bucket.includes("..")) {
    throw new Error("Invalid path: directory traversal not allowed");
  }
  const path = await getPath();
  const filePath = path.join(BASE_DIR, bucket, key);

  // 防止路径遍历攻击：确保解析后的路径在允许的目录范围内
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(BASE_DIR, bucket);
  if (
    !resolvedPath.startsWith(resolvedBase + path.sep) &&
    resolvedPath !== resolvedBase
  ) {
    throw new Error("Invalid path: directory traversal not allowed");
  }

  return filePath;
}

export const localProvider: StorageProvider = {
  async getSignedUrl(key: string, bucket: string): Promise<string> {
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
    const filePath = await safePath(bucket, key);
    const fs = await getFs();
    try {
      await fs.unlink(filePath);
    } catch {
      // File may not exist
    }
  },

  async getObject(key: string, bucket: string): Promise<Buffer> {
    const filePath = await safePath(bucket, key);
    const fs = await getFs();
    return fs.readFile(filePath) as Promise<Buffer>;
  },

  async putObject(
    key: string,
    bucket: string,
    data: Buffer,
    _contentType: string
  ): Promise<void> {
    const filePath = await safePath(bucket, key);
    const fs = await getFs();
    const path = await getPath();
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, data);
  },
};
