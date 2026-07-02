/**
 * ChatGPT Web cf_clearance 后备的纯函数(DB-free,便于单测)。
 *
 * 职责:判定 Cloudflare 挑战页、从 FlareSolverr 返回的 cookies 拼 Cookie 串、把 cf_clearance
 *   注入请求头(含按 UA 的 Chrome 大版本重建 Sec-Ch-Ua*,消 UA 与 Sec-Ch-Ua 打架的破绽)。
 * 使用方:chatgpt-web-clearance.ts(有状态部分)与 chatgpt-web.ts(注入/重试)。
 * 无 @repo 依赖,故可在 apps/web 的 DB-free vitest 下单测。
 */

/** 一份可复用的 Cloudflare 清关凭据:Cookie 串、签发它的浏览器 UA、过期时刻(ms)。 */
export type WebClearance = {
  cookie: string;
  userAgent: string;
  expiresAt: number;
};

/** FlareSolverr solution.cookies 的单项(字段可能缺失)。 */
export type FlareSolverrCookie = { name?: string; value?: string };

// 要透传的 CF cookie:cf_clearance 是关键;__cf_bm/_cfuvid/__cflb 一并带,增强与浏览器会话一致性。
const CLEARANCE_COOKIE_NAMES = new Set([
  "cf_clearance",
  "__cf_bm",
  "_cfuvid",
  "__cflb",
]);

/**
 * 判定一个上游响应是否为 Cloudflare 挑战/拦截页。
 * 仅 403/503 才可能是挑战;再按响应体特征串判定(照抄上游 _is_cloudflare_challenge 的特征)。
 */
export function isCloudflareChallenge(
  status: number,
  bodyText: string
): boolean {
  if (status !== 403 && status !== 503) return false;
  const b = bodyText.toLowerCase();
  return (
    b.includes("just a moment") ||
    b.includes("attention required") ||
    b.includes("cf-chl-") ||
    b.includes("__cf_chl_") ||
    b.includes("cf-browser-verification") ||
    b.includes("challenge-platform")
  );
}

/** 从 FlareSolverr 的 cookies 里拼出要透传的 Cookie 串(只保留 CLEARANCE_COOKIE_NAMES)。 */
export function buildClearanceCookie(
  cookies: readonly FlareSolverrCookie[]
): string {
  return cookies
    .filter((c): c is { name: string; value: string } =>
      Boolean(c.name && c.value && CLEARANCE_COOKIE_NAMES.has(c.name))
    )
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/** 从 UA 粗解平台名(给 Sec-Ch-Ua-Platform)。 */
function platformFromUserAgent(ua: string): string {
  if (/Windows/.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "macOS";
  if (/Android/.test(ua)) return "Android";
  if (/Linux/.test(ua)) return "Linux";
  return "Windows";
}

/**
 * 把 cf_clearance 注入请求头(原地改写 headers):
 *   - 覆盖 User-Agent 为签发 clearance 的那个 UA(cf_clearance 绑 UA,必须一致);
 *   - 加 Cookie(已有则追加);
 *   - 按该 UA 的 Chrome 大版本重建 Sec-Ch-Ua*(否则写死的 Edge143 与新 UA 不一致=新破绽)。
 */
export function applyClearanceHeaders(
  headers: Record<string, string>,
  clearance: WebClearance
): void {
  headers["User-Agent"] = clearance.userAgent;
  headers.Cookie = headers.Cookie
    ? `${headers.Cookie}; ${clearance.cookie}`
    : clearance.cookie;
  const major = clearance.userAgent.match(/Chrome\/(\d+)/)?.[1];
  if (major) {
    headers["Sec-Ch-Ua"] =
      `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not?A_Brand";v="24"`;
    headers["Sec-Ch-Ua-Full-Version-List"] =
      `"Chromium";v="${major}.0.0.0", "Google Chrome";v="${major}.0.0.0", "Not?A_Brand";v="24.0.0.0"`;
    headers["Sec-Ch-Ua-Full-Version"] = `"${major}.0.0.0"`;
  }
  headers["Sec-Ch-Ua-Platform"] =
    `"${platformFromUserAgent(clearance.userAgent)}"`;
}
