import type { SubscriptionPlan } from "../../config/subscription-plan";
import { getPlanLimits, megabytesToBytes } from "./plan-capabilities";

export type PlanUploadLimits = {
  maxFileSizeBytes: number;
  maxUploadBytes: number;
};

export async function getPlanUploadLimits(
  plan: SubscriptionPlan
): Promise<PlanUploadLimits> {
  const limits = await getPlanLimits(plan);

  return {
    maxFileSizeBytes: megabytesToBytes(limits.maxFileMb),
    maxUploadBytes: megabytesToBytes(limits.maxUploadMb),
  };
}

export async function getAllPlanUploadLimits(): Promise<
  Record<SubscriptionPlan, PlanUploadLimits>
> {
  const plans: SubscriptionPlan[] = [
    "free",
    "starter",
    "pro",
    "ultra",
    "enterprise",
  ];
  const entries = await Promise.all(
    plans.map(async (plan) => [plan, await getPlanUploadLimits(plan)] as const)
  );

  return Object.fromEntries(entries) as Record<
    SubscriptionPlan,
    PlanUploadLimits
  >;
}
