/**
 * Adobe 直连端到端联调脚本（最小依赖，不经过 admin service 层）。
 *
 *   DATABASE_URL=postgresql://postgres:password@127.0.0.1:5433/gpt2image \
 *   CHATGPT_WEB_PROXY_URL=http://127.0.0.1:3021 \
 *   ADOBE_TEST_COOKIE_FILE=/tmp/adobe-test-cookie.json \
 *   npx tsx scripts/test-adobe-direct-e2e.ts
 */
import fs from "node:fs";
import { db } from "@repo/database";
import { imageBackendAdobe } from "@repo/database/schema";
import {
  ProxyFireflyTransport,
  refreshAccessTokenFromCookie,
} from "@repo/shared/adobe/firefly-direct";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

function loadCookieInput(): string {
  const file = process.env.ADOBE_TEST_COOKIE_FILE?.trim();
  if (file) return fs.readFileSync(file, "utf8");
  const raw = process.env.ADOBE_TEST_COOKIE?.trim();
  if (raw) return raw;
  throw new Error("Set ADOBE_TEST_COOKIE or ADOBE_TEST_COOKIE_FILE");
}

async function ensureDirectBackend(): Promise<string> {
  const existing = await db
    .select({ id: imageBackendAdobe.id })
    .from(imageBackendAdobe)
    .where(eq(imageBackendAdobe.mode, "direct"))
    .limit(1);
  if (existing[0]?.id) return existing[0].id;

  const id = nanoid();
  await db.insert(imageBackendAdobe).values({
    id,
    name: "E2E Direct Adobe",
    mode: "direct",
    baseUrl: "",
    apiKey: "",
    enabledModels: ["gpt-image", "nano-banana"],
    defaultRatio: "1x1",
    defaultResolution: "2k",
    supportsVideo: false,
    contentSafetyEnabled: false,
    isEnabled: true,
    alwaysActive: true,
    priority: 100,
    concurrency: 5,
  });
  return id;
}

async function main() {
  const cookieInput = loadCookieInput();
  const proxyUrl = (
    process.env.FIREFLY_PROXY_URL?.trim() ||
    process.env.CHATGPT_WEB_PROXY_URL?.trim() ||
    "http://127.0.0.1:3021"
  ).replace(/\/+$/, "");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  console.log("== Adobe direct E2E ==");
  console.log(`proxy: ${proxyUrl}`);
  console.log(`proxy health: ${await fetch(`${proxyUrl}/healthz`).then((r) => r.text())}`);

  const adobeId = await ensureDirectBackend();
  console.log(`backend id: ${adobeId}`);

  const transport = new ProxyFireflyTransport({
    proxyUrl,
    secret: process.env.CHATGPT_WEB_PROXY_SECRET?.trim() || "",
    sessionKey: `adobe-e2e-${adobeId}`,
  });

  console.log("\n[1/3] IMS refresh from cookie...");
  const refresh = await refreshAccessTokenFromCookie(transport, cookieInput, {
    fetchAccount: true,
  });
  console.log(
    `  ok: token len=${refresh.accessToken.length}, expiresIn=${refresh.expiresIn}, account=${refresh.account?.email || refresh.account?.displayName || "unknown"}`
  );

  const { importAdobeAccount, runAdobeDirectImageRequest } = await import(
    "../apps/web/src/features/image-generation/adobe-direct.ts"
  );

  console.log("\n[2/3] importAdobeAccount...");
  const account = await importAdobeAccount({
    adobeId,
    name: "E2E cookie account",
    cookie: cookieInput,
  });
  console.log(
    `  ok: accountId=${account.id}, email=${account.email || "-"}, name=${account.displayName || "-"}`
  );

  console.log("\n[3/3] text-to-image generate...");
  const started = Date.now();
  const result = await runAdobeDirectImageRequest(
    {
      backend: {
        id: adobeId,
        type: "adobe",
        adobeMode: "direct",
        adobeEnabledModels: ["gpt-image"],
        adobeDefaultRatio: "1x1",
        adobeDefaultResolution: "2k",
      },
    },
    { prompt: "a red apple on white background, product photo", size: "1024x1024" }
  );
  const elapsed = Date.now() - started;

  if (result.error) {
    throw new Error(`generate failed (${elapsed}ms): ${result.error}`);
  }

  const bytes = Buffer.from(result.imageBase64 || "", "base64");
  const outDir = new URL("../storage/adobe-e2e/", import.meta.url);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = new URL(`e2e-${Date.now()}.png`, outDir);
  fs.writeFileSync(outFile, bytes);
  console.log(`  ok (${elapsed}ms): ${bytes.length} bytes -> ${outFile.pathname}`);
  console.log("\nAll checks passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
