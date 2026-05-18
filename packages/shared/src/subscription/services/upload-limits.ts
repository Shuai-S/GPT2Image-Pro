import {
  getPlanPrivileges,
  PLAN_UPLOAD_LIMIT_SETTING_KEYS,
  type SubscriptionPlan,
} from "../../config/subscription-plan";
import { getRuntimeSettingNumber } from "../../system-settings";

const BYTES_PER_MB = 1024 * 1024;

function megabytesToBytes(value: number) {
  return Math.floor(value * BYTES_PER_MB);
}

export type PlanUploadLimits = {
  maxFileSizeBytes: number;
  maxUploadBytes: number;
};

export async function getPlanUploadLimits(
  plan: SubscriptionPlan
): Promise<PlanUploadLimits> {
  const privileges = getPlanPrivileges(plan);
  const keys = PLAN_UPLOAD_LIMIT_SETTING_KEYS[plan];

  const [maxFileMb, maxUploadMb] = await Promise.all([
    getRuntimeSettingNumber(
      keys.maxFileMb,
      privileges.maxFileSizeBytes / BYTES_PER_MB,
      { positive: true }
    ),
    getRuntimeSettingNumber(
      keys.maxUploadMb,
      privileges.maxUploadBytes / BYTES_PER_MB,
      { positive: true }
    ),
  ]);

  return {
    maxFileSizeBytes: megabytesToBytes(maxFileMb),
    maxUploadBytes: megabytesToBytes(maxUploadMb),
  };
}

export async function getAllPlanUploadLimits(): Promise<
  Record<SubscriptionPlan, PlanUploadLimits>
> {
  const entries = await Promise.all(
    (Object.keys(PLAN_UPLOAD_LIMIT_SETTING_KEYS) as SubscriptionPlan[]).map(
      async (plan) => [plan, await getPlanUploadLimits(plan)] as const
    )
  );

  return Object.fromEntries(entries) as Record<
    SubscriptionPlan,
    PlanUploadLimits
  >;
}
