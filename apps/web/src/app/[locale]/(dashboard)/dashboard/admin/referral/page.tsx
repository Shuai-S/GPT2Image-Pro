import { getUserRoleById } from "@repo/shared/auth/role-server";
import { canAccessAdminArea } from "@repo/shared/auth/roles";
import { getServerSession } from "@repo/shared/auth/server";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { logError } from "@repo/shared/logger";
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

function emptyReferralList<T>(
  page = 1,
  pageSize = 20
): ReferralAdminListResult<T> {
  return {
    items: [],
    total: 0,
    page,
    pageSize,
  };
}

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
  let loadError: string | null = null;
  let profiles: ReferralAdminListResult<ReferralAdminProfileRow>;
  let bindings: ReferralAdminListResult<ReferralAdminBindingRow>;
  let ledger: ReferralAdminListResult<ReferralAdminCommissionRow>;
  let transfers: ReferralAdminListResult<ReferralAdminTransferRow>;

  try {
    [profiles, bindings, ledger, transfers] = await Promise.all([
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
  } catch (error) {
    // WHY: 邀请返佣是新增模块，生产库未执行迁移时不应让整个管理后台
    // Server Component 崩溃。记录内部错误，首屏降级为空数据并提示管理员处理。
    logError(error, {
      source: "admin-referral-page-load",
      adminUserId: session.user.id,
    });
    loadError = "邀请返佣数据暂时不可用，请确认数据库迁移已执行后刷新。";
    profiles = emptyReferralList<ReferralAdminProfileRow>();
    bindings = emptyReferralList<ReferralAdminBindingRow>();
    ledger = emptyReferralList<ReferralAdminCommissionRow>();
    transfers = emptyReferralList<ReferralAdminTransferRow>();
  }

  return (
    <AdminReferralDashboard
      profiles={profiles}
      bindings={bindings}
      ledger={ledger}
      transfers={transfers}
      locale={locale}
      initialError={loadError}
    />
  );
}
