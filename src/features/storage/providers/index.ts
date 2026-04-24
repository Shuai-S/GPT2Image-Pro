import type { StorageProvider } from "../types";

let cachedProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cachedProvider) return cachedProvider;

  if (process.env.STORAGE_ENDPOINT) {
    const { s3Provider } = require("./s3") as { s3Provider: StorageProvider };
    cachedProvider = s3Provider;
  } else {
    const { localProvider } = require("./local") as {
      localProvider: StorageProvider;
    };
    cachedProvider = localProvider;
  }

  return cachedProvider;
}
