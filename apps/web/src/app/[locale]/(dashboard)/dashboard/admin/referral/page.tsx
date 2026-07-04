import { getUserRoleById } from "@repo/shared/auth/role-server";
import { canAccessAdminArea } from "@repo/shared/auth/roles";
import { getServerSession } from "@repo/shared/auth/server";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import type {
  ReferralAdminBindingRow,
  ReferralAdminCommissionRow,
  ReferralAdminListResult,
  ReferralAdminProfileRow,
  ReferralAdminTransferRow,
} from "@repo/shared/referral";
import { invokeOperation } from "@repo/shared/uol";
import "@repo/shared/uol/operations/referral";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { AdminReferralDashboard } from "@/features/referral/components/admin-referral-dashboard";

/**
 * 生成邀请返佣管理页 metadata。
 *
 * @returns 带运行时品牌名的标题与描述。
 * @sideEffects 读取 system_setting 表。
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getRuntimeBrandingConfig();

  return {
    title: `Referral Admin | ${branding.name}`,
    description: `Audit referral commissions and transfers in ${branding.name}`,
  };
}

/**
 * 邀请返佣管理页面。
 *
 * @returns 邀请档案、绑定、返佣账本和转积分记录管理界面。
 * @sideEffects 未登录或无管理员权限时重定向；读取 referral 管理端 UOL 数据。
 */
export default async function AdminReferralPage() {
  const [session, locale] = await Promise.all([
    getServerSession(),
    getLocale(),
  ]);

  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const role = await getUserRoleById(session.user.id);
  if (!canAccessAdminArea(role)) {
    redirect(`/${locale}/dashboard`);
  }

  const principal = { type: "user" as const, userId: session.user.id, role };
  const [profiles, bindings, ledger, transfers] = await Promise.all([
    invokeOperation<ReferralAdminListResult<ReferralAdminProfileRow>>(
      "admin.referral.listProfiles",
      { page: 1, pageSize: 20 },
      principal
    ),
    invokeOperation<ReferralAdminListResult<ReferralAdminBindingRow>>(
      "admin.referral.listBindings",
      { page: 1, pageSize: 20 },
      principal
    ),
    invokeOperation<ReferralAdminListResult<ReferralAdminCommissionRow>>(
      "admin.referral.listCommissionLedger",
      { page: 1, pageSize: 20, status: "all" },
      principal
    ),
    invokeOperation<ReferralAdminListResult<ReferralAdminTransferRow>>(
      "admin.referral.listTransfers",
      { page: 1, pageSize: 20, status: "all" },
      principal
    ),
  ]);

  return (
    <AdminReferralDashboard
      profiles={profiles}
      bindings={bindings}
      ledger={ledger}
      transfers={transfers}
      locale={locale}
    />
  );
}
