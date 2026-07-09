/**
 * 创作页服务端入口。
 *
 * 负责鉴权并并发装配套餐、余额、后端池、定价与运行时开关，再把可序列化快照交给客户端。
 */
import { getCurrentUser } from "@repo/shared/auth/server";

import { getCreditsBalance } from "@repo/shared/credits/core";
import { isContentModerationEnabled } from "@repo/shared/moderation";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { getPlanCapabilitySnapshot } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import {
  getRuntimeOperationFeatureFlags,
  getRuntimeSettingNumber,
} from "@repo/shared/system-settings";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import {
  getUserImageBackendPreference,
  listSelectableImageBackendGroups,
} from "@/features/image-backend-pool/service";
import { CreatePageClient } from "@/features/image-generation/components/create-page-client";
import {
  getEffectiveImageEditMaxReferenceImages,
  getRuntimeImageEditMaxReferenceImages,
} from "@/features/image-generation/edit-reference-limits";
import {
  getRuntimeImageBaseCreditPricing,
  getRuntimeModerationCreditPricing,
} from "@/features/image-generation/pricing-settings";
import { getUserRecentGenerations } from "@/features/image-generation/queries";
import { getUserApiConfig } from "@/features/image-generation/service";
import { getVideoPricingForUser } from "@/features/image-generation/video-operations";
import { hasLayeredMeta } from "@/features/psd-export/layered-meta";

const DEFAULT_FORCE_WEB_MIN_PIXELS = 660_000;
const DEFAULT_FORCE_WEB_MAX_PIXELS = 2_000_000;

/**
 * 渲染已登录用户的统一图像创作界面。
 *
 * @returns 创作页客户端组件；未登录时按当前语言重定向到登录页。
 * @sideEffects 读取用户、套餐、积分、后端池与运行时设置，不执行写操作。
 */
export default async function CreatePage() {
  const [user, locale] = await Promise.all([getCurrentUser(), getLocale()]);
  if (!user) redirect(`/${locale}/sign-in`);

  const planPromise = getUserPlan(user.id);
  const creditsPromise = getCreditsBalance(user.id);
  const recentGenerationsPromise = getUserRecentGenerations(user.id, 6);
  const moderationEnabledPromise = isContentModerationEnabled();
  const imageBasePricingPromise = getRuntimeImageBaseCreditPricing();
  const moderationPricingPromise = getRuntimeModerationCreditPricing();
  const forceWebMinPixelsPromise = getRuntimeSettingNumber(
    "IMAGE_FORCE_WEB_MIN_PIXELS",
    DEFAULT_FORCE_WEB_MIN_PIXELS,
    { nonNegative: true }
  );
  const forceWebMaxPixelsPromise = getRuntimeSettingNumber(
    "IMAGE_FORCE_WEB_MAX_PIXELS",
    DEFAULT_FORCE_WEB_MAX_PIXELS,
    { positive: true }
  );
  const videoPricingPromise = getVideoPricingForUser({ userId: user.id });
  const operationFlagsPromise = getRuntimeOperationFeatureFlags();
  const runtimeMaxEditImagesPromise = getRuntimeImageEditMaxReferenceImages();

  // 套餐相关读取只依赖 planPromise，其他读取不等待套餐，缩短首屏服务端关键路径。
  const capabilitiesPromise = planPromise.then(({ plan }) =>
    getPlanCapabilitySnapshot(plan)
  );
  const backendGroupsPromise = planPromise.then(({ plan }) =>
    listSelectableImageBackendGroups(plan)
  );
  const selectedBackendGroupIdPromise = planPromise.then(({ plan }) =>
    getUserImageBackendPreference(user.id, plan)
  );
  const userApiConfigPromise = planPromise.then(({ plan }) =>
    getUserApiConfig(user.id, plan)
  );

  const [
    plan,
    creditsData,
    recentGenerations,
    capabilities,
    backendGroups,
    selectedBackendGroupId,
    moderationEnabled,
    userApiConfig,
    imageBasePricing,
    moderationPricing,
    forceWebMinPixels,
    forceWebMaxPixels,
    videoPricing,
    operationFlags,
    runtimeMaxEditImages,
  ] = await Promise.all([
    planPromise,
    creditsPromise,
    recentGenerationsPromise,
    capabilitiesPromise,
    backendGroupsPromise,
    selectedBackendGroupIdPromise,
    moderationEnabledPromise,
    userApiConfigPromise,
    imageBasePricingPromise,
    moderationPricingPromise,
    forceWebMinPixelsPromise,
    forceWebMaxPixelsPromise,
    videoPricingPromise,
    operationFlagsPromise,
    runtimeMaxEditImagesPromise,
  ]);
  const uploadLimits = {
    maxFileSizeBytes: capabilities.limits.maxFileSizeBytes,
    maxUploadBytes: capabilities.limits.maxUploadBytes,
  };
  const effectiveMaxEditImages = getEffectiveImageEditMaxReferenceImages(
    capabilities.limits.maxEditImages,
    runtimeMaxEditImages
  );
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
      maxEditImages={effectiveMaxEditImages}
      backendGroups={backendGroups.map((group) => ({
        id: group.id,
        name: group.name,
        isDefault: group.isDefault,
        backendType: group.backendType,
        contentSafetyEnabled: group.contentSafetyEnabled,
        billingMultiplier: group.billingMultiplier,
        availableModels: group.availableModels,
      }))}
      selectedBackendGroupId={selectedBackendGroupId}
      customApiActive={Boolean(userApiConfig)}
      moderationEnabled={moderationEnabled}
      imageBasePricing={imageBasePricing}
      moderationPricing={moderationPricing}
      forceWebPixelRange={forceWebPixelRange}
      videoPricing={videoPricing}
      operationFlags={operationFlags}
    />
  );
}
