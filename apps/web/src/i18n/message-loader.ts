import type { AbstractIntlMessages } from "next-intl";

export const MESSAGE_GROUP_IDS = [
  "common",
  "marketing",
  "auth",
  "dashboard",
  "docs",
  "admin",
] as const;

export type MessageGroupId = (typeof MESSAGE_GROUP_IDS)[number];

export async function loadMessageGroup(
  locale: string,
  groupId: MessageGroupId
): Promise<AbstractIntlMessages> {
  const mod = (await import(`../../messages/${locale}/${groupId}.json`)) as {
    default: AbstractIntlMessages;
  };
  return mod.default;
}

export async function loadMessageGroups(
  locale: string,
  groupIds: readonly MessageGroupId[]
): Promise<AbstractIntlMessages> {
  const groups = await Promise.all(
    groupIds.map((groupId) => loadMessageGroup(locale, groupId))
  );
  return Object.assign({}, ...groups) as AbstractIntlMessages;
}
