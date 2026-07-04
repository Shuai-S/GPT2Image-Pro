/**
 * 邀请链接归因路由
 *
 * 使用方：用户分享的 /[locale]/invite/[code] 链接。
 * 关键依赖：NextResponse Cookie、referral 纯规则与运行时系统设置。
 */

import {
  getReferralProfileByCode,
  isReferralEnabled,
} from "@repo/shared/referral";
import {
  isValidReferralCode,
  normalizeReferralCode,
  REFERRAL_ATTRIBUTION_COOKIE,
} from "@repo/shared/referral/rules";
import { getRuntimeSettingNumber } from "@repo/shared/system-settings";
import { type NextRequest, NextResponse } from "next/server";

/**
 * 处理邀请链接并跳转注册页。
 *
 * @param request - 当前请求。
 * @param params - locale 与邀请码路由参数。
 * @returns 带归因 Cookie 的注册页重定向响应。
 * @sideEffects 设置短期邀请归因 Cookie。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string; code: string }> }
) {
  const { locale, code } = await params;
  const normalizedCode = normalizeReferralCode(code);
  const signUpUrl = new URL(`/${locale}/sign-up`, request.url);
  const codeProfile =
    isValidReferralCode(normalizedCode) && (await isReferralEnabled())
      ? await getReferralProfileByCode(normalizedCode)
      : null;

  if (codeProfile) {
    signUpUrl.searchParams.set("ref", codeProfile.referralCode);
  }

  const response = NextResponse.redirect(signUpUrl);
  if (!codeProfile) {
    return response;
  }

  const ttlDays = Math.trunc(
    await getRuntimeSettingNumber("REFERRAL_COOKIE_TTL_DAYS", 30, {
      positive: true,
    })
  );
  response.cookies.set(REFERRAL_ATTRIBUTION_COOKIE, codeProfile.referralCode, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlDays * 24 * 60 * 60,
  });

  return response;
}
