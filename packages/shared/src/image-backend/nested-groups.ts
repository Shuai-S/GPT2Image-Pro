export type ImageBackendGroupBackendType =
  | "mixed"
  | "web"
  | "responses"
  | "adobe";

type NestedGroupValidationInput = {
  groupId?: string;
  backendType: ImageBackendGroupBackendType;
  childGroupIds?: string[];
  groups: Array<{
    id: string;
    name: string;
    backendType: ImageBackendGroupBackendType;
    childGroupIds?: string[];
  }>;
};

export function normalizeChildGroupIds(childGroupIds?: string[]) {
  return Array.from(
    new Set(
      (childGroupIds || [])
        .map((childGroupId) => childGroupId.trim())
        .filter(Boolean)
    )
  );
}

export function validateNestedGroupConfig(input: NestedGroupValidationInput) {
  if (input.groupId && input.backendType === "mixed") {
    const parent = input.groups.find(
      (group) =>
        group.id !== input.groupId &&
        normalizeChildGroupIds(group.childGroupIds).includes(
          input.groupId as string
        )
    );
    if (parent) {
      return {
        ok: false as const,
        error: `分组「${parent.name}」已嵌套当前分组，被嵌套的分组不能设为 mixed`,
      };
    }
  }

  if (input.backendType !== "mixed") {
    return { ok: true as const, childGroupIds: [] };
  }

  const childGroupIds = normalizeChildGroupIds(input.childGroupIds);
  if (input.groupId && childGroupIds.includes(input.groupId)) {
    return { ok: false as const, error: "分组不能嵌套自身" };
  }

  const groupMap = new Map(input.groups.map((group) => [group.id, group]));
  for (const childGroupId of childGroupIds) {
    const childGroup = groupMap.get(childGroupId);
    if (!childGroup) {
      return { ok: false as const, error: "子分组不存在，不能保存嵌套分组" };
    }
    if (childGroup.backendType === "mixed") {
      return {
        ok: false as const,
        error: "只允许 mixed 分组内嵌套非 mixed 分组",
      };
    }
    if (normalizeChildGroupIds(childGroup.childGroupIds).length) {
      return {
        ok: false as const,
        error: "分组嵌套只允许一层，子分组不能再包含子分组",
      };
    }
  }

  return { ok: true as const, childGroupIds };
}
