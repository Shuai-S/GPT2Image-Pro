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
  selectedGroupId?: string | null;
  selectedGroupMetadata?: Record<string, unknown> | null;
  selectedMemberGroupId?: string | null;
  selectedMemberGroupMetadata?: Record<string, unknown> | null;
}) {
  const selectedMultiplier = getGroupBillingMultiplier(
    input.selectedGroupMetadata
  );
  const memberGroupId = input.selectedMemberGroupId ?? null;
  const selectedGroupId = input.selectedGroupId ?? null;

  if (!memberGroupId || memberGroupId === selectedGroupId) {
    return selectedMultiplier;
  }

  return normalizeGroupBillingMultiplier(
    selectedMultiplier *
      getGroupBillingMultiplier(input.selectedMemberGroupMetadata)
  );
}
