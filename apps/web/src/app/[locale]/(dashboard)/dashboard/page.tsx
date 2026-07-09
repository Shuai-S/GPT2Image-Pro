import { db } from "@repo/database";
import { creditsBalance, generation } from "@repo/database/schema";
import { getServerSession } from "@repo/shared/auth/server";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { formatCredits } from "@repo/shared/credits/format";
import { logError } from "@repo/shared/logger";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { invokeOperation } from "@repo/shared/uol";
import "@repo/shared/uol/operations/referral";
import { getPlanCapabilitySnapshot } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { and, count, desc, eq } from "drizzle-orm";
import { Coins, Image as ImageIcon, ImagePlus } from "lucide-react";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { ImagePricingChartCardLazy } from "@/features/dashboard/components/image-pricing-chart-card-lazy";
import {
  getUserImageBackendPreference,
  listImageBackendGroupOptions,
} from "@/features/image-backend-pool/service";
import { RecentCreationsClient } from "@/features/image-generation/components/recent-creations-client";
import {
  getRuntimeImageBaseCreditPricing,
  getRuntimeModerationCreditPricing,
} from "@/features/image-generation/pricing-settings";
import { getImageBaseCreditPricing } from "@/features/image-generation/resolution";
import { hasLayeredMeta } from "@/features/psd-export/layered-meta";
import { Link } from "@/i18n/routing";

interface DashboardPageProps {
  searchParams?: Promise<{
    aff?: string | string[];
    aff_code?: string | string[];
    ref?: string | string[];
    invite?: string | string[];
  }>;
}

function pickReferralCode(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  // A-P0-3：改用 cache 化的 getServerSession，与 layout 共享同一查询结果，
  // 不再每页各自调 auth.api.getSession 打 DB。
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const user = session.user;
  const userId = user.id;
  const resolvedSearchParams = await searchParams;
  const referralCode =
    pickReferralCode(resolvedSearchParams?.aff) ??
    pickReferralCode(resolvedSearchParams?.aff_code) ??
    pickReferralCode(resolvedSearchParams?.ref) ??
    pickReferralCode(resolvedSearchParams?.invite);
  if (referralCode) {
    // WHY: 绑定失败（码失效、已绑定、DB 抖动）不应让 dashboard 首页 500，
    // 记日志后照常跳转清除 query 即可。
    // A-P0-3：role 经 cache() 与 layout 共享，无需重复 DB 查询。
    try {
      const role = await getUserRoleById(userId);
      await invokeOperation(
        "referral.bindInviterByCode",
        {
          code: referralCode,
          metadata: {
            source: "oauth-sign-up",
            path: "/dashboard",
          },
        },
        { type: "user", userId, role }
      );
    } catch (error) {
      logError(error, {
        source: "dashboard-referral-binding",
        userId,
        referralCode,
      });
    }
    redirect(`/${locale}/dashboard`);
  }
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);

  // A-P0-3：把原第二段 Promise.all 的 getUserPlan 前置依赖解开——capabilities
  // 依赖 userPlanInfo.plan，故仍分两段：先并行取聚合数据 + userPlan，再取
  // 依赖 plan 的 capabilities/backendGroups/preference。整体段数不变，但
  // session/role 已由 cache 复用 layout 结果，不再独立打 DB。
  const [
    balanceData,
    recentGenerations,
    totalGenerationsResult,
    imageBasePricing,
    moderationPricing,
    userPlanInfo,
  ] = await Promise.all([
    db.query.creditsBalance.findFirst({
      where: eq(creditsBalance.userId, userId),
    }),
    db
      .select()
      .from(generation)
      .where(
        and(eq(generation.userId, userId), eq(generation.status, "completed"))
      )
      .orderBy(desc(generation.createdAt))
      .limit(4),
    db
      .select({ count: count() })
      .from(generation)
      .where(eq(generation.userId, userId)),
    getRuntimeImageBaseCreditPricing(),
    getRuntimeModerationCreditPricing(),
    getUserPlan(userId),
  ]);

  const balance = formatCredits(balanceData?.balance ?? 0);
  const totalGenerations = totalGenerationsResult[0]?.count ?? 0;
  const normalizedImageBasePricing =
    getImageBaseCreditPricing(imageBasePricing);
  const [capabilities, backendGroups, selectedBackendGroupId] =
    await Promise.all([
      getPlanCapabilitySnapshot(userPlanInfo.plan),
      listImageBackendGroupOptions({ plan: userPlanInfo.plan }),
      getUserImageBackendPreference(userId, userPlanInfo.plan),
    ]);
  const activeBackendGroup =
    backendGroups.find((group) => group.id === selectedBackendGroupId) ||
    backendGroups.find((group) => group.isDefault) ||
    backendGroups[0] ||
    null;

  const generationsWithUrls = recentGenerations.map((gen) => ({
    id: gen.id,
    prompt: gen.prompt,
    revisedPrompt: gen.revisedPrompt,
    model: gen.model,
    size: gen.size,
    status: gen.status,
    creditsConsumed: gen.creditsConsumed,
    storageKey: gen.storageKey,
    storageBucket: gen.storageBucket,
    imageUrl: buildSignedStorageImageUrl(gen.storageKey, gen.storageBucket),
    isLayered: hasLayeredMeta(gen.metadata),
    createdAt: gen.createdAt.toISOString(),
  }));

  return (
    <div className="container mx-auto px-4 py-6 md:px-6">
      <div className="space-y-8">
        {/* Page header */}
        <div>
          <h1 className="font-serif text-2xl font-medium">
            {copy("Dashboard", "控制台")}
          </h1>
          <p className="text-muted-foreground">
            {copy(`Welcome back, ${user.name}`, `欢迎回来，${user.name}`)}
          </p>
        </div>

        {/* Stats row */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Credits Balance Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {copy("Credits Balance", "积分余额")}
              </CardTitle>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{balance}</div>
              <p className="text-xs text-muted-foreground">
                {copy(
                  `Base price: ${formatCredits(
                    normalizedImageBasePricing.base1024Credits
                  )} at 1024x1024 · ${formatCredits(
                    normalizedImageBasePricing.base4kCredits
                  )} at 4K`,
                  `基础价：1024x1024 为 ${formatCredits(
                    normalizedImageBasePricing.base1024Credits
                  )} · 4K 为 ${formatCredits(
                    normalizedImageBasePricing.base4kCredits
                  )}`
                )}
              </p>
            </CardContent>
          </Card>

          {/* Images Generated Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {copy("Images Generated", "已生成图片")}
              </CardTitle>
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalGenerations}</div>
              <p className="text-xs text-muted-foreground">
                {copy("total images created", "累计创建图片")}
              </p>
            </CardContent>
          </Card>

          {/* Quick Create Card */}
          <Card className="border-dashed">
            <CardContent className="flex h-full flex-col items-center justify-center gap-3 p-6">
              <ImagePlus className="h-8 w-8 text-muted-foreground" />
              <Button asChild>
                <Link href="/dashboard/create">
                  {copy("Start Creating", "开始创作")}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <ImagePricingChartCardLazy
          billing={{
            agentRoundCredits: capabilities.billing.agentRoundCredits,
            chatRoundCredits: capabilities.billing.chatRoundCredits,
            groupMultiplier: activeBackendGroup?.billingMultiplier ?? 1,
            groupName: activeBackendGroup?.name ?? null,
            moderationBlockingEnabled:
              capabilities.features["moderation.blocking"],
            monthlyCredits: capabilities.limits.monthlyCredits,
            planName: userPlanInfo.planName,
          }}
          isZh={isZh}
          moderationPricing={moderationPricing}
          pricing={normalizedImageBasePricing}
        />

        {/* Recent Generations */}
        {generationsWithUrls.length > 0 && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-lg font-medium">
                {copy("Recent Creations", "最近创作")}
              </h2>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/gallery">
                  {copy("View All", "查看全部")}
                </Link>
              </Button>
            </div>
            <RecentCreationsClient initialGenerations={generationsWithUrls} />
          </div>
        )}
      </div>
    </div>
  );
}
