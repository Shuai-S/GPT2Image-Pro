import {
  createOgImageResponse,
  OG_IMAGE_SIZE,
} from "@repo/shared/components/og-image-template";
import { siteConfig } from "@repo/shared/config";

/**
 * Twitter 图片配置
 */
export const alt = siteConfig.name;
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";

/**
 * 动态生成 Twitter 图片
 */
export default async function Image() {
  return createOgImageResponse();
}
