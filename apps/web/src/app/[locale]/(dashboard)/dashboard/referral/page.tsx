import { getUserRoleById } from "@repo/shared/auth/role-server";
import { getServerSession } from "@repo/shared/auth/server";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { getRuntimeSiteUrl } from "@repo/shared/config/site-runtime";
import type { ReferralOverview } from "@repo/shared/referral";
import { invokeOperation } from "@repo/shared/uol";
import "@repo/shared/uol/operations/referral";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { ReferralDashboard } from "@/features/referral/components/referral-dashboard";

/**
 * 生成邀请返利页面 metadata。
 *
 * @returns 带运行时品牌名称的页面标题与描述。
 * @sideEffects 读取 system_setting 表。
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getRuntimeBrandingConfig();

  return {
    title: `Referral | ${branding.name}`,
    description: `Invite users and convert rewards into ${branding.name} credits`,
  };
}

/**
 * 邀请返利页面。
 *
 * @returns 当前用户的邀请码、返佣统计和转积分入口。
 * @sideEffects 未登录时重定向；读取并惰性解冻到期返佣。
 */
export default async function ReferralPage() {
  const [session, locale, origin] = await Promise.all([
    getServerSession(),
    getLocale(),
    getRuntimeSiteUrl(),
  ]);

  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const role = await getUserRoleById(session.user.id);
  const overview = await invokeOperation<ReferralOverview>(
    "referral.getMyReferralOverview",
    {},
    { type: "user", userId: session.user.id, role }
  );
  const inviteUrl = new URL("/sign-up", origin);
  inviteUrl.searchParams.set("aff", overview.referralCode);
  const inviteLink = inviteUrl.toString();

  return (
    <ReferralDashboard
      overview={overview}
      inviteLink={inviteLink}
      locale={locale}
    />
  );
}
