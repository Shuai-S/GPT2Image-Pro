import { roundCreditAmount } from "./resolution";

export type GenerationBillingPolicy = {
  chargeImageCredits: boolean;
  chargeModerationCredits: boolean;
  chargesCredits: boolean;
  mode: "full" | "moderation_only" | "none";
};

type CreditCostLike = {
  totalCredits: number;
  moderationOnlyCredits: number;
};

export function buildGenerationBillingPolicy(params: {
  useSiteImageCredits: boolean;
  moderationEnabled: boolean;
}): GenerationBillingPolicy {
  const chargeImageCredits = params.useSiteImageCredits;
  const chargeModerationCredits = params.moderationEnabled;
  return {
    chargeImageCredits,
    chargeModerationCredits,
    chargesCredits: chargeImageCredits || chargeModerationCredits,
    mode: chargeImageCredits
      ? "full"
      : chargeModerationCredits
        ? "moderation_only"
        : "none",
  };
}

export function getInitialGenerationCharge(params: {
  policy: GenerationBillingPolicy;
  isChatInput: boolean;
  chatRoundCredits: number;
  creditCost: CreditCostLike;
}) {
  if (params.policy.chargeImageCredits) {
    return params.isChatInput
      ? params.chatRoundCredits
      : params.creditCost.totalCredits;
  }

  if (params.policy.chargeModerationCredits) {
    return params.creditCost.moderationOnlyCredits;
  }

  return 0;
}

export function getModerationFailureCharge(params: {
  policy: GenerationBillingPolicy;
  moderationOnlyFailureSettlement: boolean;
  isChatInput: boolean;
  chatRoundCredits: number;
  chatModerationOnlyCredits: number;
  creditCost: CreditCostLike;
  initialCreditCharge: number;
}) {
  if (!params.policy.chargeModerationCredits) return 0;

  if (!params.policy.chargeImageCredits) {
    return params.creditCost.moderationOnlyCredits;
  }

  if (!params.moderationOnlyFailureSettlement) {
    return params.initialCreditCharge;
  }

  return params.isChatInput
    ? Math.min(params.chatModerationOnlyCredits, params.chatRoundCredits)
    : params.creditCost.moderationOnlyCredits;
}

export function getTextChatSuccessTargetCredits(params: {
  policy: GenerationBillingPolicy;
  chatRoundCredits: number;
  chatRoundCount: number;
  creditCost: CreditCostLike;
}) {
  if (params.policy.chargeImageCredits) {
    return roundCreditAmount(params.chatRoundCredits * params.chatRoundCount);
  }

  if (params.policy.chargeModerationCredits) {
    return params.creditCost.moderationOnlyCredits;
  }

  return 0;
}

export function getImageSuccessTargetCredits(params: {
  policy: GenerationBillingPolicy;
  isChatInput: boolean;
  chatRoundCredits: number;
  chatRoundCount: number;
  actualImageCredits: number;
  creditCost: CreditCostLike;
}) {
  if (params.policy.chargeImageCredits) {
    return roundCreditAmount(
      (params.isChatInput
        ? params.chatRoundCredits * params.chatRoundCount
        : 0) + params.actualImageCredits
    );
  }

  if (params.policy.chargeModerationCredits) {
    return params.creditCost.moderationOnlyCredits;
  }

  return 0;
}
