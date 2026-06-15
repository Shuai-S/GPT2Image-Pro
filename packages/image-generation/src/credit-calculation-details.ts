export type GenerationCreditDetails = {
  actualImageCredits: number | null;
  actualSize: string | null;
  baseCredits: number | null;
  billableImageOutputCount: number | null;
  billingGroupId: string | null;
  billingMultiplier: number;
  chatCredits: number | null;
  chatRoundCount: number | null;
  chatRoundCredits: number | null;
  imageModerationCount: number | null;
  mode: string | null;
  moderationCredits: number | null;
  requestedSize: string | null;
  requestedTotalCredits: number | null;
  textModerationCount: number | null;
  totalCredits: number;
  upstreamImageOutputCount: number | null;
};

type CreditCostRecord = {
  baseCredits: number | null;
  imageModerationCount: number | null;
  moderationCredits: number | null;
  textModerationCount: number | null;
  totalCredits: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readPositiveNumber(value: unknown): number | null {
  const numeric = readNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readCreditCost(value: unknown): CreditCostRecord | null {
  if (!isRecord(value)) return null;
  return {
    baseCredits: readNumber(value.baseCredits),
    imageModerationCount: readNumber(value.imageModerationCount),
    moderationCredits: readNumber(value.moderationCredits),
    textModerationCount: readNumber(value.textModerationCount),
    totalCredits: readNumber(value.totalCredits),
  };
}

function sumCreditCosts(
  value: unknown,
  key: keyof CreditCostRecord
): number | null {
  if (!Array.isArray(value)) return null;
  let total = 0;
  let found = false;
  for (const item of value) {
    const creditCost = readCreditCost(item);
    const amount = creditCost?.[key];
    if (typeof amount === "number") {
      total += amount;
      found = true;
    }
  }
  return found ? Math.round((total + Number.EPSILON) * 100) / 100 : null;
}

export function extractGenerationCreditDetails(
  metadata: unknown,
  creditsConsumed: number
): GenerationCreditDetails | null {
  if (!isRecord(metadata)) return null;

  const backend = isRecord(metadata.backend) ? metadata.backend : {};
  const outputImage = isRecord(metadata.outputImage) ? metadata.outputImage : {};
  const creditCost = readCreditCost(metadata.creditCost);
  const requestedCreditCost = readCreditCost(outputImage.requestedCreditCost);
  const actualCreditCost = readCreditCost(outputImage.actualCreditCost);
  const perOutputCreditCosts = outputImage.perOutputCreditCosts;
  const chatTextOnlyCharge = isRecord(metadata.chatTextOnlyCharge)
    ? metadata.chatTextOnlyCharge
    : null;
  const billingMultiplier =
    readPositiveNumber(metadata.billingMultiplier) ??
    readPositiveNumber(backend.billingMultiplier) ??
    1;
  const chatRoundCredits =
    readNumber(outputImage.chatRoundCredits) ??
    readNumber(chatTextOnlyCharge?.chatRoundCredits);
  const chatRoundCount =
    readNumber(outputImage.chatRoundCount) ??
    readNumber(chatTextOnlyCharge?.chatRoundCount);
  const chatCredits =
    readNumber(chatTextOnlyCharge?.credits) ??
    (chatRoundCredits !== null && chatRoundCount !== null
      ? Math.round(
          (chatRoundCredits * chatRoundCount + Number.EPSILON) * 100
        ) / 100
      : null);

  const actualImageCredits =
    sumCreditCosts(perOutputCreditCosts, "totalCredits") ??
    actualCreditCost?.totalCredits ??
    null;
  const baseCredits =
    sumCreditCosts(perOutputCreditCosts, "baseCredits") ??
    actualCreditCost?.baseCredits ??
    creditCost?.baseCredits ??
    null;
  const moderationCredits =
    sumCreditCosts(perOutputCreditCosts, "moderationCredits") ??
    actualCreditCost?.moderationCredits ??
    creditCost?.moderationCredits ??
    null;

  return {
    actualImageCredits,
    actualSize: readString(outputImage.actualSize),
    baseCredits,
    billableImageOutputCount: readNumber(outputImage.billableImageOutputCount),
    billingGroupId:
      readString(metadata.billingGroupId) ?? readString(backend.billingGroupId),
    billingMultiplier,
    chatCredits,
    chatRoundCount,
    chatRoundCredits,
    imageModerationCount:
      sumCreditCosts(perOutputCreditCosts, "imageModerationCount") ??
      actualCreditCost?.imageModerationCount ??
      creditCost?.imageModerationCount ??
      null,
    mode: readString(metadata.mode),
    moderationCredits,
    requestedSize: readString(outputImage.requestedSize),
    requestedTotalCredits:
      requestedCreditCost?.totalCredits ?? creditCost?.totalCredits ?? null,
    textModerationCount:
      sumCreditCosts(perOutputCreditCosts, "textModerationCount") ??
      actualCreditCost?.textModerationCount ??
      creditCost?.textModerationCount ??
      null,
    totalCredits: creditsConsumed,
    upstreamImageOutputCount: readNumber(outputImage.upstreamImageOutputCount),
  };
}
