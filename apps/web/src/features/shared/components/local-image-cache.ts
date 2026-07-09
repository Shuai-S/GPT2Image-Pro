/**
 * 浏览器本地图片缓存工具
 *
 * 参考 sub2api-image 的历史图片缓存分层：localStorage 只保存轻量索引，
 * 图片本体放 IndexedDB。这里存 Blob 而非 data URL，减少大图缓存体积。
 * 供 CachedImage 在图库、历史、创作页等图片密集区域复用。
 */

const DB_NAME = "gpt2image_local_image_cache";
const DB_VERSION = 1;
const STORE_NAME = "images";
const META_KEY = "gpt2image.localImageCache.v1";
const MAX_CACHE_ENTRIES = 320;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const MAX_SINGLE_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const VOLATILE_QUERY_KEYS = new Set([
  "sig",
  "exp",
  "expires",
  "signature",
  "awsaccesskeyid",
  "x-amz-algorithm",
  "x-amz-credential",
  "x-amz-date",
  "x-amz-expires",
  "x-amz-security-token",
  "x-amz-signature",
  "x-amz-signedheaders",
  "x-goog-algorithm",
  "x-goog-credential",
  "x-goog-date",
  "x-goog-expires",
  "x-goog-signature",
  "x-goog-signedheaders",
]);

export interface LocalImageCacheEntry {
  cacheKey: string;
  sizeBytes: number;
  contentType: string;
  createdAt: number;
  lastAccessedAt: number;
}

interface LocalImageCacheMeta {
  version: 1;
  entries: Record<string, LocalImageCacheEntry>;
}

interface StoredImageRecord extends LocalImageCacheEntry {
  blob: Blob;
}

interface CachedImageBlob {
  blobUrl: string;
  contentType: string;
  sizeBytes: number;
  fromCache: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

// 同一 cacheKey 的并发解析去重表。WHY:列表项可能引用同一张图(如多卡片复用同一参考图),
// N 个 CachedImage effect 同时对同一 key 调 resolveLocalCachedImage 会触发 N 个独立
// IndexedDB transaction 与 N 次 lastAccessedAt+localStorage 写入。这里把同一 key 的
// 并发请求合并为单个 Promise,既省事务又避免重复 Blob URL$objPHPExcel。
const inflightResolve = new Map<string, Promise<CachedImageBlob | null>>();

/**
 * 预热本地图片缓存:提前打开 IndexedDB 连接,使后续各 CachedImage 的 effect 共享
 * 同一个已就绪连接而非各自排队打开。fire-and-forget,失败不影响展示。
 *
 * @param srcs - 列表中的图片原始 URL 集合(会自动过滤跨源/blob/data 等不可缓存项)。
 * @returns void。
 * @sideEffects 可能创建/打开 IndexedDB 连接。
 * @throws 不抛出异常。
 */
export function prefetchLocalImageCache(srcs: string[]): void {
  if (!canUseLocalImageCache()) return;
  // 仅打开连接,不主动发起网络抓取(与单实例语义保持一致:命中即用,未命中等懒加载)。
  void openImageCacheDB().catch(() => {
    // 打开失败只影响本地缓存能力,各 component 仍回退原 URL。
  });
  // 预计算 cacheKey 触发 normalize 早期失败剔除,避免 effect 内重复计算。无副作用。
  for (const src of srcs) {
    if (typeof src === "string") normalizeImageCacheKey(src);
  }
}

/**
 * 判断值是否为可用的元数据条目。
 *
 * @param value - 从 localStorage JSON 解析出的未知值。
 * @returns 值满足缓存元数据结构时返回 true。
 * @sideEffects 无副作用。
 * @throws 不抛出异常。
 */
function isLocalImageCacheEntry(value: unknown): value is LocalImageCacheEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.cacheKey === "string" &&
    typeof entry.sizeBytes === "number" &&
    typeof entry.contentType === "string" &&
    typeof entry.createdAt === "number" &&
    typeof entry.lastAccessedAt === "number"
  );
}

/**
 * 从 localStorage 读取并校验缓存索引。
 *
 * @returns 合法元数据；损坏、缺失或不可访问时返回空索引。
 * @sideEffects 读取 localStorage。
 * @throws 不抛出异常。
 */
function readCacheMeta(): LocalImageCacheMeta {
  try {
    const raw = globalThis.localStorage?.getItem(META_KEY);
    if (!raw) return { version: 1, entries: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { version: 1, entries: {} };
    }
    const value = parsed as Record<string, unknown>;
    if (value.version !== 1 || !value.entries) {
      return { version: 1, entries: {} };
    }
    const entries: Record<string, LocalImageCacheEntry> = {};
    for (const [key, entry] of Object.entries(
      value.entries as Record<string, unknown>
    )) {
      if (isLocalImageCacheEntry(entry)) {
        entries[key] = entry;
      }
    }
    return { version: 1, entries };
  } catch {
    return { version: 1, entries: {} };
  }
}

/**
 * 写入缓存索引。
 *
 * @param meta - 已校验并裁剪后的缓存索引。
 * @returns void。
 * @sideEffects 写入 localStorage。
 * @throws 不抛出异常，写入失败时缓存能力降级。
 */
function writeCacheMeta(meta: LocalImageCacheMeta): void {
  try {
    globalThis.localStorage?.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // localStorage 可能因隐私模式或配额限制不可写，图片展示继续走原 URL。
  }
}

/**
 * 打开图片缓存 IndexedDB。
 *
 * @returns 已初始化 object store 的数据库连接。
 * @sideEffects 可能创建 IndexedDB 数据库与 images object store。
 * @throws 浏览器不支持或打开失败时抛出，由上层回退原图。
 */
function openImageCacheDB(): Promise<IDBDatabase> {
  if (!("indexedDB" in globalThis)) {
    return Promise.reject(new Error("IndexedDB is not supported"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB open failed"));
  });

  return dbPromise;
}

/**
 * 判断查询参数是否属于签名或过期时间等易变鉴权参数。
 *
 * @param key - URL 查询参数名。
 * @returns 易变参数返回 true。
 * @sideEffects 无副作用。
 * @throws 不抛出异常。
 */
function isVolatileQueryKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    VOLATILE_QUERY_KEYS.has(normalized) ||
    normalized.startsWith("x-amz-") ||
    normalized.startsWith("x-goog-")
  );
}

/**
 * 生成稳定的同源图片缓存键。
 *
 * WHY：本站存储图 URL 会带 sig/exp，刷新页面时签名变化会绕开浏览器 HTTP 缓存。
 * 本函数移除易变签名参数，但保留路径、宽度段与业务查询参数，避免不同图互相命中。
 *
 * @param src - 图片原始 URL。
 * @param baseUrl - 相对 URL 的解析基准。
 * @returns 可缓存图片的稳定键；data/blob/跨源/非法 URL 返回 null。
 * @sideEffects 无副作用。
 * @throws 不抛出异常。
 */
export function normalizeImageCacheKey(
  src: string,
  baseUrl = globalThis.location?.href || "http://localhost"
): string | null {
  if (
    src.startsWith("data:") ||
    src.startsWith("blob:") ||
    src.startsWith("file:")
  ) {
    return null;
  }

  try {
    const base = new URL(baseUrl);
    const url = new URL(src, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.origin !== base.origin) {
      return null;
    }

    const retainedParams = Array.from(url.searchParams.entries())
      .filter(([key]) => !isVolatileQueryKey(key))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        const keyOrder = leftKey.localeCompare(rightKey);
        return keyOrder === 0 ? leftValue.localeCompare(rightValue) : keyOrder;
      });
    const searchParams = new URLSearchParams(retainedParams);
    const query = searchParams.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

/**
 * 判断当前浏览器是否支持本地图片缓存能力。
 *
 * @returns 支持 IndexedDB 与 Blob URL 时返回 true。
 * @sideEffects 无副作用。
 * @throws 不抛出异常。
 */
function canUseLocalImageCache(): boolean {
  return (
    typeof globalThis.window !== "undefined" &&
    "indexedDB" in globalThis &&
    typeof globalThis.URL?.createObjectURL === "function"
  );
}

/**
 * 从响应中提取图片 Blob 并校验大小与类型。
 *
 * @param response - fetch 返回的响应。
 * @returns 可展示的图片 Blob 信息；非图片或过大时返回 null。
 * @sideEffects 消费 response 的 body。
 * @throws Blob 读取失败时向上抛出，调用方统一回退原 URL。
 */
async function responseToImageBlob(
  response: Response
): Promise<{ blob: Blob; contentType: string; sizeBytes: number } | null> {
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    return null;
  }
  const blob = await response.blob();
  if (blob.size <= 0 || blob.size > MAX_SINGLE_IMAGE_BYTES) {
    return null;
  }
  return {
    blob,
    contentType: blob.type || contentType,
    sizeBytes: blob.size,
  };
}

/**
 * 从 IndexedDB 读取单张图片。
 *
 * @param db - 已打开的图片缓存数据库。
 * @param cacheKey - 稳定缓存键。
 * @returns 命中时返回缓存记录；未命中或读取失败时返回 null。
 * @sideEffects 读取 IndexedDB。
 * @throws 不抛出异常。
 */
async function getStoredImage(
  db: IDBDatabase,
  cacheKey: string
): Promise<StoredImageRecord | null> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(cacheKey);
    request.onsuccess = () => {
      const result: unknown = request.result;
      if (!result || typeof result !== "object") {
        resolve(null);
        return;
      }
      const record = result as StoredImageRecord;
      resolve(record.blob instanceof Blob ? record : null);
    };
    request.onerror = () => resolve(null);
  });
}

/**
 * 写入或更新单张图片缓存。
 *
 * @param db - 已打开的图片缓存数据库。
 * @param record - 图片 Blob 与索引字段。
 * @returns 写入成功返回 true。
 * @sideEffects 写入 IndexedDB。
 * @throws 不抛出异常。
 */
async function putStoredImage(
  db: IDBDatabase,
  record: StoredImageRecord
): Promise<boolean> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/**
 * 删除单张图片缓存。
 *
 * @param db - 已打开的图片缓存数据库。
 * @param meta - 当前缓存索引。
 * @param cacheKey - 要删除的稳定缓存键。
 * @returns void。
 * @sideEffects 删除 IndexedDB 记录并修改 meta.entries。
 * @throws 不抛出异常。
 */
async function deleteStoredImage(
  db: IDBDatabase,
  meta: LocalImageCacheMeta,
  cacheKey: string
): Promise<void> {
  delete meta.entries[cacheKey];
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(cacheKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/**
 * 按过期时间、容量与条数裁剪缓存。
 *
 * @param db - 已打开的图片缓存数据库。
 * @param meta - 当前缓存索引。
 * @returns void。
 * @sideEffects 可能删除 IndexedDB 记录并写入 localStorage。
 * @throws 不抛出异常。
 */
async function pruneCache(
  db: IDBDatabase,
  meta: LocalImageCacheMeta
): Promise<void> {
  const now = Date.now();
  for (const [cacheKey, entry] of Object.entries(meta.entries)) {
    if (now - entry.createdAt > MAX_CACHE_AGE_MS) {
      await deleteStoredImage(db, meta, cacheKey);
    }
  }

  const entries = Object.entries(meta.entries).sort(
    ([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt
  );
  let totalBytes = entries.reduce((sum, [, entry]) => sum + entry.sizeBytes, 0);

  while (entries.length > MAX_CACHE_ENTRIES || totalBytes > MAX_CACHE_BYTES) {
    const oldest = entries.shift();
    if (!oldest) break;
    const [cacheKey, entry] = oldest;
    totalBytes -= entry.sizeBytes;
    await deleteStoredImage(db, meta, cacheKey);
  }

  writeCacheMeta(meta);
}

/**
 * 从 IndexedDB 读取已持久化的图片并转成 Blob URL。
 *
 * @param db - 已打开的图片缓存数据库。
 * @param meta - 当前缓存索引。
 * @param cacheKey - 稳定缓存键。
 * @returns 命中时返回可展示 Blob URL；未命中返回 null。
 * @sideEffects 命中时更新 lastAccessedAt 与 localStorage。
 * @throws 不抛出异常。
 */
async function readCachedImage(
  db: IDBDatabase,
  meta: LocalImageCacheMeta,
  cacheKey: string
): Promise<CachedImageBlob | null> {
  const entry = meta.entries[cacheKey];
  if (!entry) return null;

  const record = await getStoredImage(db, cacheKey);
  if (!record) {
    delete meta.entries[cacheKey];
    writeCacheMeta(meta);
    return null;
  }

  const now = Date.now();
  const nextEntry: LocalImageCacheEntry = {
    cacheKey,
    sizeBytes: record.sizeBytes,
    contentType: record.contentType,
    createdAt: record.createdAt,
    lastAccessedAt: now,
  };
  meta.entries[cacheKey] = nextEntry;
  writeCacheMeta(meta);

  return {
    blobUrl: URL.createObjectURL(record.blob),
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    fromCache: true,
  };
}

/**
 * 从网络拉取图片并写入 IndexedDB。
 *
 * @param db - 已打开的图片缓存数据库。
 * @param meta - 当前缓存索引。
 * @param cacheKey - 稳定缓存键。
 * @param src - 原始图片 URL，仍用于服务端鉴权与下载。
 * @param signal - 组件卸载时的取消信号。
 * @returns 成功时返回可展示 Blob URL；失败返回 null。
 * @sideEffects 发起网络请求、写入 IndexedDB 和 localStorage。
 * @throws 不抛出异常，调用方可继续使用原始 URL。
 */
async function fetchAndCacheImage(
  db: IDBDatabase,
  meta: LocalImageCacheMeta,
  cacheKey: string,
  src: string,
  signal: AbortSignal
): Promise<CachedImageBlob | null> {
  try {
    const response = await fetch(src, {
      credentials: "same-origin",
      signal,
    });
    if (!response.ok) return null;

    const image = await responseToImageBlob(response);
    if (!image) return null;

    const now = Date.now();
    const record: StoredImageRecord = {
      cacheKey,
      blob: image.blob,
      sizeBytes: image.sizeBytes,
      contentType: image.contentType,
      createdAt: meta.entries[cacheKey]?.createdAt || now,
      lastAccessedAt: now,
    };

    const saved = await putStoredImage(db, record);
    if (!saved) return null;

    const { blob: _blob, ...entry } = record;
    meta.entries[cacheKey] = entry;
    await pruneCache(db, meta);

    return {
      blobUrl: URL.createObjectURL(image.blob),
      contentType: image.contentType,
      sizeBytes: image.sizeBytes,
      fromCache: false,
    };
  } catch {
    return null;
  }
}

/**
 * 解析图片 URL，优先返回本地缓存中的 Blob URL。
 *
 * @param src - 图片原始 URL。
 * @param signal - 组件卸载或 src 改变时的取消信号。
 * @param fetchOnMiss - 未命中时是否立即联网拉取并写入缓存。
 * @returns 可展示的 Blob URL；不支持或失败时返回 null。
 * @sideEffects 可能读取/写入 IndexedDB、localStorage，并发起一次网络请求。
 * @throws 不抛出异常。
 */
export async function resolveLocalCachedImage(
  src: string,
  signal: AbortSignal,
  fetchOnMiss = false
): Promise<CachedImageBlob | null> {
  if (!canUseLocalImageCache()) return null;
  const cacheKey = normalizeImageCacheKey(src);
  if (!cacheKey) return null;

  // 同 key 并发去重:复用正在进行中的解析 Promise,避免重复 IndexedDB 读取与写入。
  // 仅对无网络回退(fetchOnMiss=false)的列表场景去重,带 fetch 的单实例路径保持原行为。
  const existing = inflightResolve.get(cacheKey);
  if (existing && !fetchOnMiss) {
    return existing;
  }
  const run = (async (): Promise<CachedImageBlob | null> => {
    try {
      const db = await openImageCacheDB();
      const meta = readCacheMeta();
      const cached = await readCachedImage(db, meta, cacheKey);
      if (cached || signal.aborted) return cached;
      if (!fetchOnMiss) return null;
      return await fetchAndCacheImage(db, meta, cacheKey, src, signal);
    } catch {
      return null;
    }
  })();
  inflightResolve.set(cacheKey, run);
  try {
    const result = await run;
    return result;
  } finally {
    // 仅在当前 Promise 即为表内值时清理,避免被后续重复 key 的 Promise 误删。
    if (inflightResolve.get(cacheKey) === run) {
      inflightResolve.delete(cacheKey);
    }
  }
}

/**
 * 后台预热图片本地缓存。
 *
 * 供 CachedImage 在原始图片真正完成懒加载后调用。WHY：首屏未命中时不主动
 * 抢网络，而是等待浏览器按 loading/fetchPriority 调度图片；加载完成后再利用
 * HTTP 缓存或同 URL 请求写入 IndexedDB，下一次切换/刷新即可走本地 Blob。
 *
 * @param src - 图片原始 URL。
 * @returns void。
 * @sideEffects 可能发起网络请求并写入 IndexedDB/localStorage。
 * @throws 不抛出异常。
 */
export async function warmLocalImageCache(src: string): Promise<void> {
  if (!canUseLocalImageCache()) return;
  const cacheKey = normalizeImageCacheKey(src);
  if (!cacheKey) return;

  const controller = new AbortController();
  try {
    const db = await openImageCacheDB();
    const meta = readCacheMeta();
    if (meta.entries[cacheKey]) return;
    await fetchAndCacheImage(db, meta, cacheKey, src, controller.signal);
  } catch {
    // 预热失败只影响下一次是否命中本地缓存，不影响当前图片展示。
  }
}
