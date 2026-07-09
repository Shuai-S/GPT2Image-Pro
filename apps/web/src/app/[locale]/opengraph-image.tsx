import {
  createOgImageResponse,
  OG_IMAGE_SIZE,
} from "@repo/shared/components/og-image-template";
import { siteConfig } from "@repo/shared/config";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { getRuntimeSiteUrl } from "@repo/shared/config/site-runtime";

/**
 * Open Graph 图片配置
 */
export const alt = siteConfig.name;
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";

/**
 * 动态生成 Open Graph 图片
 */
export default async function Image() {
  const [branding, siteUrl] = await Promise.all([
    getRuntimeBrandingConfig(),
    getRuntimeSiteUrl(),
  ]);
  return createOgImageResponse({ branding, siteUrl });
}
