import type { BrandingConfig } from "@repo/shared/config/branding";
import Image from "next/image";

interface AuthLogoProps {
  branding: BrandingConfig;
}

/**
 * 认证页面 Logo 组件
 *
 * 用于登录、注册等认证页面的品牌标识展示
 * 图标 + 文字组合
 *
 * @param branding - 管理员配置的应用名称与 Logo。
 * @returns 认证页面品牌标识。
 * @sideEffects 无。
 */

export function AuthLogo({ branding }: AuthLogoProps) {
  return (
    <div className="flex items-center gap-2">
      <Image
        src={branding.logoUrl}
        alt={branding.name}
        width={28}
        height={28}
        className="h-7 w-7 shrink-0 object-contain"
        unoptimized
      />
      <span className="font-serif text-xl font-medium tracking-tight">
        {branding.name}
      </span>
    </div>
  );
}
