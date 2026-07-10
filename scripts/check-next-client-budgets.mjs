/**
 * Next.js App Router 客户端资源预算门禁。
 *
 * 从生产构建的 RSC client-reference manifest 读取每个关键页面实际关联的唯一 JS/CSS
 * chunk，并以 gzip-9 计算传输体积。脚本同时计入 Next root/polyfill chunk，防止共享依赖
 * 膨胀被单页清单遗漏；任一页面或单 chunk 超限时退出 1。
 */

import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";

const KIB = 1024;
const MAX_SINGLE_JS_GZIP_BYTES = 155 * KIB;

const ROUTE_BUDGETS = [
  {
    name: "marketing-home",
    manifest: "[locale]/(marketing)/page",
    routeKey: "/[locale]/(marketing)/page",
    maxJsGzipBytes: 420 * KIB,
    maxCssGzipBytes: 45 * KIB,
  },
  {
    name: "docs",
    manifest: "[locale]/docs/[[...slug]]/page",
    routeKey: "/[locale]/docs/[[...slug]]/page",
    maxJsGzipBytes: 450 * KIB,
    maxCssGzipBytes: 45 * KIB,
  },
  {
    name: "create",
    manifest: "[locale]/(dashboard)/dashboard/create/page",
    routeKey: "/[locale]/(dashboard)/dashboard/create/page",
    maxJsGzipBytes: 525 * KIB,
    maxCssGzipBytes: 45 * KIB,
  },
  {
    name: "canvas",
    manifest: "[locale]/(dashboard)/dashboard/canvas/page",
    routeKey: "/[locale]/(dashboard)/dashboard/canvas/page",
    maxJsGzipBytes: 535 * KIB,
    maxCssGzipBytes: 45 * KIB,
  },
  {
    name: "admin-settings",
    manifest: "[locale]/(dashboard)/dashboard/admin/settings/page",
    routeKey: "/[locale]/(dashboard)/dashboard/admin/settings/page",
    maxJsGzipBytes: 505 * KIB,
    maxCssGzipBytes: 45 * KIB,
  },
];

/** 把 manifest 中的 /_next/static 路径规范为相对 .next 的路径。 */
function normalizeChunkPath(value) {
  return value.replace(/^\/_next\//, "").replace(/^\/+/, "");
}

/**
 * 解析 Next 生成的 client-reference JavaScript。
 *
 * manifest 只应对隔离的 globalThis.__RSC_MANIFEST 赋值；沙箱不暴露 require/process，
 * 读取后还会校验目标 routeKey 存在。
 */
function readClientManifest(filePath, routeKey) {
  const context = { globalThis: {} };
  runInNewContext(readFileSync(filePath, "utf8"), context, {
    filename: filePath,
    timeout: 1_000,
  });
  const manifest = context.globalThis.__RSC_MANIFEST?.[routeKey];
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Missing client manifest route: ${routeKey}`);
  }
  return manifest;
}

/** 收集页面 clientModules/entry 文件中去重后的 JS 与非内联 CSS chunk。 */
function collectRouteChunks(clientManifest, buildManifest) {
  const js = new Set();
  const css = new Set();

  for (const entry of Object.values(clientManifest.clientModules ?? {})) {
    for (const chunk of entry.chunks ?? []) {
      if (typeof chunk === "string") js.add(normalizeChunkPath(chunk));
    }
  }
  for (const chunks of Object.values(clientManifest.entryJSFiles ?? {})) {
    for (const chunk of chunks ?? []) {
      if (typeof chunk === "string") js.add(normalizeChunkPath(chunk));
    }
  }
  for (const files of Object.values(clientManifest.entryCSSFiles ?? {})) {
    for (const file of files ?? []) {
      if (!file?.inlined && typeof file?.path === "string") {
        css.add(normalizeChunkPath(file.path));
      }
    }
  }
  for (const chunk of [
    ...(buildManifest.rootMainFiles ?? []),
    ...(buildManifest.polyfillFiles ?? []),
  ]) {
    if (typeof chunk === "string") js.add(normalizeChunkPath(chunk));
  }
  return { js, css };
}

/** 读取并 gzip 一个 .next 内部 chunk，拒绝绝对路径或目录穿越。 */
function gzipChunk(nextDir, relativePath) {
  const absolute = resolve(nextDir, relativePath);
  const root = `${resolve(nextDir)}${sep}`;
  if (!absolute.startsWith(root)) {
    throw new Error(`Chunk escaped .next directory: ${relativePath}`);
  }
  return gzipSync(readFileSync(absolute), { level: 9 }).byteLength;
}

/** 计算一个 chunk 集合的 gzip 总量和最大单文件。 */
function measureChunks(nextDir, chunks) {
  const files = [...chunks].map((file) => ({
    file,
    gzipBytes: gzipChunk(nextDir, file),
  }));
  return {
    files,
    totalBytes: files.reduce((total, file) => total + file.gzipBytes, 0),
    largest: files.toSorted((a, b) => b.gzipBytes - a.gzipBytes)[0],
  };
}

/** 把字节格式化成便于 CI 日志审阅的 KiB。 */
function formatKib(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}

/** 执行全部关键路由预算检查并设置进程退出码。 */
function main() {
  const nextDir = resolve(process.cwd(), "apps/web/.next");
  const appServerDir = resolve(nextDir, "server/app");
  const failures = [];

  for (const budget of ROUTE_BUDGETS) {
    const clientManifestPath = resolve(
      appServerDir,
      `${budget.manifest}_client-reference-manifest.js`
    );
    const buildManifestPath = resolve(
      appServerDir,
      budget.manifest,
      "build-manifest.json"
    );
    const clientManifest = readClientManifest(
      clientManifestPath,
      budget.routeKey
    );
    const buildManifest = JSON.parse(readFileSync(buildManifestPath, "utf8"));
    const chunks = collectRouteChunks(clientManifest, buildManifest);
    const js = measureChunks(nextDir, chunks.js);
    const css = measureChunks(nextDir, chunks.css);

    console.log(
      `${budget.name}: JS ${formatKib(js.totalBytes)} / ${formatKib(
        budget.maxJsGzipBytes
      )}, CSS ${formatKib(css.totalBytes)} / ${formatKib(
        budget.maxCssGzipBytes
      )}`
    );
    if (js.totalBytes > budget.maxJsGzipBytes) {
      failures.push(`${budget.name} JS gzip budget exceeded`);
    }
    if (css.totalBytes > budget.maxCssGzipBytes) {
      failures.push(`${budget.name} CSS gzip budget exceeded`);
    }
    if (
      js.largest &&
      js.largest.gzipBytes > MAX_SINGLE_JS_GZIP_BYTES
    ) {
      failures.push(
        `${budget.name} chunk ${js.largest.file} is ${formatKib(
          js.largest.gzipBytes
        )}; max ${formatKib(MAX_SINGLE_JS_GZIP_BYTES)}`
      );
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`ERROR: ${failure}`);
    process.exitCode = 1;
  }
}

main();
