export function normalizeGroupBillingMultiplier(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(100, Math.max(0.01, Math.round(parsed * 100) / 100));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getGroupBillingMultiplier(
  metadata: Record<string, unknown> | null | undefined
) {
  const groupMetadata = asRecord(metadata);
  return normalizeGroupBillingMultiplier(
    groupMetadata.billingMultiplier ??
      groupMetadata.creditMultiplier ??
      groupMetadata.costMultiplier
  );
}

export function getEffectiveBillingMultiplierForSelectedGroup(input: {
  selectedGroupMetadata?: Record<string, unknown> | null;
  selectedMemberGroupMetadata?: Record<string, unknown> | null;
}) {
  return getGroupBillingMultiplier(input.selectedGroupMetadata);
}
