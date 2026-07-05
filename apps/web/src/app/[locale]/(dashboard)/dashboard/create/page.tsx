import { getCurrentUser } from "@repo/shared/auth/server";

import { getCreditsBalance } from "@repo/shared/credits/core";
import { isContentModerationEnabled } from "@repo/shared/moderation";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { getPlanCapabilitySnapshot } from "@repo/shared/subscription/services/plan-capabilities";
import { getPlanUploadLimits } from "@repo/shared/subscription/services/upload-limits";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import {
  getRuntimeOperationFeatureFlags,
  getRuntimeSettingNumber,
} from "@repo/shared/system-settings";
import { getAppTimeZone } from "@repo/shared/time-zone/server";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import {
  getUserImageBackendPreference,
  listSelectableImageBackendGroups,
} from "@/features/image-backend-pool/service";
import { CreatePageClient } from "@/features/image-generation/components/create-page-client";
import { getRuntimeImageBaseCreditPricing } from "@/features/image-generation/pricing-settings";
import { getUserRecentGenerations } from "@/features/image-generation/queries";
import { getUserApiConfig } from "@/features/image-generation/service";
import { getVideoPricingForUser } from "@/features/image-generation/video-operations";
import { hasLayeredMeta } from "@/features/psd-export/layered-meta";

const DEFAULT_FORCE_WEB_MIN_PIXELS = 660_000;
const DEFAULT_FORCE_WEB_MAX_PIXELS = 2_000_000;

export default async function CreatePage() {
  const user = await getCurrentUser();
  const locale = await getLocale();
  if (!user) redirect(`/${locale}/sign-in`);

  const [creditsData, recentGenerations, plan, userApiConfig, timeZone] =
    await Promise.all([
      getCreditsBalance(user.id),
      getUserRecentGenerations(user.id, 6),
      getUserPlan(user.id),
      getUserApiConfig(user.id),
      getAppTimeZone(),
    ]);
  const [
    uploadLimits,
    backendGroups,
    selectedBackendGroupId,
    moderationEnabled,
  ] = await Promise.all([
    getPlanUploadLimits(plan.plan),
    listSelectableImageBackendGroups(plan.plan),
    getUserImageBackendPreference(user.id, plan.plan),
    isContentModerationEnabled(),
  ]);
  const [
    capabilities,
    imageBasePricing,
    forceWebMinPixels,
    forceWebMaxPixels,
    videoPricing,
    operationFlags,
  ] = await Promise.all([
    getPlanCapabilitySnapshot(plan.plan),
    getRuntimeImageBaseCreditPricing(),
    getRuntimeSettingNumber(
      "IMAGE_FORCE_WEB_MIN_PIXELS",
      DEFAULT_FORCE_WEB_MIN_PIXELS,
      { nonNegative: true }
    ),
    getRuntimeSettingNumber(
      "IMAGE_FORCE_WEB_MAX_PIXELS",
      DEFAULT_FORCE_WEB_MAX_PIXELS,
      { positive: true }
    ),
    getVideoPricingForUser({ userId: user.id }),
    getRuntimeOperationFeatureFlags(),
  ]);
  const forceWebPixelRange = {
    minPixels: Math.min(forceWebMinPixels, forceWebMaxPixels),
    maxPixels: Math.max(forceWebMinPixels, forceWebMaxPixels),
  };

  const balance = creditsData?.balance || 0;

  const recents = recentGenerations.map((g) => ({
    id: g.id,
    prompt: g.prompt,
    revisedPrompt: g.revisedPrompt,
    model: g.model,
    size: g.size,
    creditsConsumed: g.creditsConsumed,
    status: g.status,
    imageUrl: buildSignedStorageImageUrl(g.storageKey, g.storageBucket),
    isLayered: hasLayeredMeta(g.metadata),
    createdAt: g.createdAt.toISOString(),
  }));

  return (
    <CreatePageClient
      balance={balance}
      recentGenerations={recents}
      plan={plan.plan}
      capabilities={capabilities}
      uploadLimits={uploadLimits}
      backendGroups={backendGroups.map((group) => ({
        id: group.id,
        name: group.name,
        isDefault: group.isDefault,
        backendType: group.backendType,
        contentSafetyEnabled: group.contentSafetyEnabled,
        billingMultiplier: group.billingMultiplier,
      }))}
      selectedBackendGroupId={selectedBackendGroupId}
      customApiActive={Boolean(userApiConfig)}
      moderationEnabled={moderationEnabled}
      imageBasePricing={imageBasePricing}
      forceWebPixelRange={forceWebPixelRange}
      timeZone={timeZone}
      videoPricing={videoPricing}
      operationFlags={operationFlags}
    />
  );
}
