/**
 * 运行时站点公开地址解析。
 *
 * 职责：让通用 Docker 镜像在启动后读取部署域名，而非继续使用构建期冻结的
 * NEXT_PUBLIC_APP_URL。使用方：metadata、canonical、sitemap、robots 与 JSON-LD。
 */
import { siteConfig } from "./site";

const DEFAULT_SITE_URL = "https://gpt2image.com";
const MAX_SITE_URL_LENGTH = 2048;

export interface RuntimeSiteUrlInput {
  configuredUrl?: string | undefined;
  environmentUrl?: string | undefined;
  authUrl?: string | undefined;
  fallbackUrl?: string | undefined;
}

/**
 * 按动态键读取运行时环境变量。
 *
 * @param key 环境变量名。
 * @returns 当前进程中的值；未配置时返回 undefined。
 * @sideEffects 读取进程环境。动态键阻止 Next.js 在构建时内联 NEXT_PUBLIC_*。
 */
function getRuntimeEnvironmentVariable(key: string): string | undefined {
  return process.env[key];
}

/**
 * 规范化一个候选站点地址。
 *
 * @param value 后台或环境变量提供的绝对 URL。
 * @returns 无凭据、query、hash 与尾斜杠的 HTTP(S) URL；非法输入返回 null。
 * @sideEffects 无。
 */
function normalizeSiteUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > MAX_SITE_URL_LENGTH) return null;

  try {
    const url = new URL(trimmed);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }

    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * 从运行时候选项中选出公开站点地址。
 *
 * @param input.configuredUrl 后台设置或动态环境变量，优先级最高。
 * @param input.environmentUrl 当前容器启动时注入的公开站点地址。
 * @param input.authUrl Better Auth 的运行时公开地址，作为可靠部署兜底。
 * @param input.fallbackUrl 构建期站点默认值，最后使用。
 * @returns 规范化后的公开 HTTP(S) 地址，所有候选非法时返回项目默认地址。
 * @sideEffects 无。
 */
export function resolveRuntimeSiteUrl(input: RuntimeSiteUrlInput): string {
  for (const candidate of [
    input.configuredUrl,
    input.environmentUrl,
    input.authUrl,
    input.fallbackUrl,
    DEFAULT_SITE_URL,
  ]) {
    const normalized = normalizeSiteUrl(candidate);
    if (normalized) return normalized;
  }

  return DEFAULT_SITE_URL;
}

/**
 * 读取当前部署的公开站点地址。
 *
 * @returns 后台设置、运行时环境或静态默认值解析出的站点地址。
 * @sideEffects 正常运行时读取带缓存的 system_settings；构建期按全局规则跳过 DB。
 */
export async function getRuntimeSiteUrl(): Promise<string> {
  const { getRuntimeSettingString } = await import("../system-settings");
  const configuredUrl = await getRuntimeSettingString("NEXT_PUBLIC_APP_URL");

  return resolveRuntimeSiteUrl({
    configuredUrl,
    environmentUrl: getRuntimeEnvironmentVariable("NEXT_PUBLIC_APP_URL"),
    authUrl: getRuntimeEnvironmentVariable("BETTER_AUTH_URL"),
    fallbackUrl: siteConfig.url,
  });
}
