/**
 * ChatGPT Web cf_clearance 后备(默认关闭)。
 *
 * 职责:当 Cloudflare 真的对 chatgpt.com 出挑战时,经 FlareSolverr(走与出图请求同一 WARP 出口)
 *   解挑战、拿 cf_clearance cookie + 该浏览器 UA,缓存供注入,失效自刷新。
 * 使用方:chatgpt-web.ts 的 getHeaders(初始注入,读进程内缓存)+ fetchChatGptWeb(命中挑战→刷新→重试)。
 * 依赖:运行时设置 CHATGPT_WEB_CLEARANCE_MODE(off/flaresolverr,默认 off)、FLARESOLVERR_URL、
 *   CHATGPT_WEB_CLEARANCE_PROXY_URL(FlareSolverr 的出口,须与 3021 代理同一 WARP)、
 *   CHATGPT_WEB_CLEARANCE_TIMEOUT_SEC、CHATGPT_WEB_CLEARANCE_REFRESH_SEC。
 *
 * 边界/WHY:
 *   - 默认 off 时 refreshClearance 直接返回 null、缓存永不填充、getActiveClearance 恒为 null →
 *     对现有链路零影响(不注入任何 Cookie/UA)。仅显式开启才生效。
 *   - cf_clearance 绑「出口 IP + UA」,故 FlareSolverr 必须与 3021 代理走同一 WARP 出口,
 *     且注入时用 FlareSolverr 返回的 UA(见 chatgpt-web-clearance-util.applyClearanceHeaders)。
 *   - per-key in-flight 锁防惊群(FlareSolverr 解一次数秒~数十秒,避免并发重复打)。
 *   - 纯进程内缓存(不落库):重启后失效重取,简单且避免 metadata 并发写。
 */
import { logWarn } from "@repo/shared/logger";
import {
  buildClearanceCookie,
  type WebClearance,
} from "./chatgpt-web-clearance-util";

const CHATGPT_URL = "https://chatgpt.com/";

// 按账号(getWebSessionKey)缓存 clearance;in-flight 锁按同 key 去重。
const cache = new Map<string, WebClearance>();
const inflight = new Map<string, Promise<WebClearance | null>>();

// 配置读 env(经 systemd EnvironmentFile / gpt2image-shared/.env.local 注入进程),
// 非 SettingKey 白名单,故不走 getRuntimeSettingString;开启须设 env 并重启单元(见文件头注释)。
function settingStr(key: string, fallback = ""): string {
  return (process.env[key]?.trim() || fallback).trim();
}

/** cf_clearance 后备是否启用(默认 off)。 */
export function isClearanceEnabled(): boolean {
  return (
    settingStr("CHATGPT_WEB_CLEARANCE_MODE", "off").toLowerCase() ===
    "flaresolverr"
  );
}

/** 同步取缓存里未过期的 clearance(供 getHeaders 注入);无/过期返回 null。 */
export function getActiveClearance(sessionKey: string): WebClearance | null {
  const c = cache.get(sessionKey);
  if (!c) return null;
  if (Date.now() >= c.expiresAt) {
    cache.delete(sessionKey);
    return null;
  }
  return c;
}

type FlareSolverrResp = {
  status?: string;
  message?: string;
  solution?: {
    status?: number;
    userAgent?: string;
    cookies?: { name?: string; value?: string }[];
  };
};

/**
 * 经 FlareSolverr(走 WARP 出口)解 chatgpt.com,拿 cf_clearance+UA,写缓存并返回。
 * 未启用直接返回 null;in-flight 去重;任何失败返回 null 并记 warn(不抛,后备失败不阻断主链路)。
 */
export async function refreshClearance(
  sessionKey: string
): Promise<WebClearance | null> {
  if (!isClearanceEnabled()) return null;
  const existing = inflight.get(sessionKey);
  if (existing) return existing;
  const task = doRefresh(sessionKey).finally(() => inflight.delete(sessionKey));
  inflight.set(sessionKey, task);
  return task;
}

async function doRefresh(sessionKey: string): Promise<WebClearance | null> {
  const base = settingStr("FLARESOLVERR_URL", "http://127.0.0.1:8191").replace(
    /\/$/,
    ""
  );
  const proxyUrl = settingStr(
    "CHATGPT_WEB_CLEARANCE_PROXY_URL",
    "socks5://warp:1080"
  );
  const timeoutSec =
    Number(settingStr("CHATGPT_WEB_CLEARANCE_TIMEOUT_SEC", "60")) || 60;
  const refreshSec =
    Number(settingStr("CHATGPT_WEB_CLEARANCE_REFRESH_SEC", "3600")) || 3600;
  try {
    const body: Record<string, unknown> = {
      cmd: "request.get",
      url: CHATGPT_URL,
      maxTimeout: timeoutSec * 1000,
    };
    if (proxyUrl) body.proxy = { url: proxyUrl };
    const resp = await fetch(`${base}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout((timeoutSec + 20) * 1000),
    });
    const data = (await resp.json()) as FlareSolverrResp;
    const sol = data.solution;
    if (data.status !== "ok" || !sol) {
      logWarn("cf_clearance 刷新失败", {
        sessionKey,
        message: data.message,
      });
      return null;
    }
    const cookie = buildClearanceCookie(
      Array.isArray(sol.cookies) ? sol.cookies : []
    );
    const ua = (sol.userAgent || "").trim();
    if (!cookie.includes("cf_clearance=") || !ua) {
      logWarn("cf_clearance 刷新未拿到有效 clearance/UA", { sessionKey });
      return null;
    }
    const clearance: WebClearance = {
      cookie,
      userAgent: ua,
      expiresAt: Date.now() + refreshSec * 1000,
    };
    cache.set(sessionKey, clearance);
    logWarn("cf_clearance 已刷新", { sessionKey, ua });
    return clearance;
  } catch (error) {
    logWarn("cf_clearance 刷新异常", {
      sessionKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
