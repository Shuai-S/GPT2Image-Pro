import { siteConfig } from "./site";

/**
 * 运行时品牌配置。
 *
 * 使用方：Next.js 服务端 layout/page 在渲染前读取后传给客户端组件。
 * 关键依赖：system-settings 负责从 DB 读取管理员配置，并回退到环境变量。
 */
export interface BrandingConfig {
  name: string;
  description: string;
  logoUrl: string;
  ogImageUrl: string;
}

interface BrandingInput {
  name?: string | undefined;
  description?: string | undefined;
  logoUrl?: string | undefined;
  ogImageUrl?: string | undefined;
}

const DEFAULT_LOGO_URL = "/assets/icon.png";
const DEFAULT_OG_IMAGE_URL = "/og-image.png";
const MAX_BRAND_NAME_LENGTH = 60;
const MAX_BRAND_DESCRIPTION_LENGTH = 240;

/**
 * 规范化品牌文本，限制长度以保护导航和 metadata 输出。
 *
 * @param value - 管理员配置的文本。
 * @param fallback - 文本为空时使用的默认值。
 * @param max - 允许输出的最大字符数。
 * @returns 去除首尾空白并截断后的文本。
 * @sideEffects 无。
 */
function normalizeText(
  value: string | undefined,
  fallback: string,
  max: number
) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

/**
 * 规范化管理员配置的品牌资源 URL。
 *
 * @param value - 管理员配置的 URL 或同源路径。
 * @param fallback - 配置为空或非法时使用的兜底路径。
 * @returns 允许浏览器加载的 http(s) URL 或同源绝对路径。
 * @sideEffects 无。
 * @throws 不抛出异常；非法 URL 会回退 fallback。
 */
export function normalizeBrandAssetUrl(
  value: string | undefined,
  fallback: string
) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (trimmed.length > 2048) return fallback;

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 把 DB/env 中的原始品牌配置收敛为组件可直接渲染的配置。
 *
 * @param input - 未规范化的品牌配置字段。
 * @returns 带完整兜底值的品牌配置。
 * @sideEffects 无。
 * @throws 不抛出异常。
 */
export function resolveBrandingConfig(input: BrandingInput): BrandingConfig {
  return {
    name: normalizeText(input.name, siteConfig.name, MAX_BRAND_NAME_LENGTH),
    description: normalizeText(
      input.description,
      siteConfig.description,
      MAX_BRAND_DESCRIPTION_LENGTH
    ),
    logoUrl: normalizeBrandAssetUrl(input.logoUrl, DEFAULT_LOGO_URL),
    ogImageUrl: normalizeBrandAssetUrl(input.ogImageUrl, DEFAULT_OG_IMAGE_URL),
  };
}

/**
 * 读取管理员配置的运行时品牌信息。
 *
 * @returns 可用于页面、导航、SEO 与邮件主题的品牌配置。
 * @sideEffects 读取 system_settings 表；底层带短 TTL 缓存。
 * @throws DB 访问异常会向上抛出，由调用方所属页面/动作处理。
 */
export async function getRuntimeBrandingConfig(): Promise<BrandingConfig> {
  const { getRuntimeSettingString } = await import("../system-settings");
  const [name, description, logoUrl, ogImageUrl] = await Promise.all([
    getRuntimeSettingString("NEXT_PUBLIC_APP_NAME"),
    getRuntimeSettingString("NEXT_PUBLIC_APP_DESCRIPTION"),
    getRuntimeSettingString("NEXT_PUBLIC_APP_LOGO_URL"),
    getRuntimeSettingString("NEXT_PUBLIC_APP_OG_IMAGE"),
  ]);

  return resolveBrandingConfig({
    name,
    description,
    logoUrl,
    ogImageUrl,
  });
}
