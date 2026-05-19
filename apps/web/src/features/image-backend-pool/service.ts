import { createHash } from "node:crypto";
import { db } from "@repo/database";
import {
  externalApiKey,
  imageBackendAccount,
  imageBackendApi,
  imageBackendGroup,
  userImageBackendPreference,
} from "@repo/database/schema";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { ApiConfig } from "@/features/image-generation/types";

import type {
  ImageBackendAccountBackend,
  ContentSafetyOverride,
  ImageBackendGroupSummary,
  ImageBackendRequestKind,
} from "./types";

type ResolveBackendOptions = {
  userId: string;
  apiKeyId?: string;
  requestKind: ImageBackendRequestKind;
};

type PoolMember =
  | {
      type: "api";
      id: string;
      groupId: string | null;
      name: string;
      baseUrl: string;
      apiKey: string;
      model: string | null;
      useStream: boolean;
      contentSafetyEnabled: boolean;
      priority: number;
      lastUsedAt: Date | null;
      createdAt: Date;
    }
  | {
      type: "account";
      id: string;
      groupId: string | null;
      name: string;
      accessToken: string;
      model: string | null;
      implementationMode: string;
      contentSafetyEnabled: boolean;
      priority: number;
      lastUsedAt: Date | null;
      createdAt: Date;
    };

export type ResolvedImageBackendPoolConfig = {
  config: ApiConfig;
  groupId: string | null;
  memberId: string;
  memberType: "api" | "account";
  contentSafetyEnabled: boolean;
};

const CHATGPT_CODEX_RESPONSES_URL =
  "https://chatgpt.com/backend-api/codex";

function normalizeAccountBackend(value?: string | null): ImageBackendAccountBackend {
  return value === "responses" ? "responses" : "web";
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function hashBackendCredential(value: string) {
  return createHash("sha256").update(value.trim()).digest("hex");
}

export function fromSafetyOverride(value: ContentSafetyOverride) {
  if (value === "enabled") return true;
  if (value === "disabled") return false;
  return null;
}

function effectiveContentSafety(
  groupValue: boolean | null,
  memberValue: boolean
) {
  return groupValue ?? memberValue;
}

function memberTimestamp(value: Date | string | null | undefined) {
  if (!value) return 0;
  return new Date(value).getTime();
}

async function getDefaultGroupId() {
  const [defaultGroup] = await db
    .select({ id: imageBackendGroup.id })
    .from(imageBackendGroup)
    .where(
      and(eq(imageBackendGroup.isEnabled, true), eq(imageBackendGroup.isDefault, true))
    )
    .orderBy(asc(imageBackendGroup.priority), asc(imageBackendGroup.createdAt))
    .limit(1);

  if (defaultGroup) return defaultGroup.id;

  const [firstGroup] = await db
    .select({ id: imageBackendGroup.id })
    .from(imageBackendGroup)
    .where(eq(imageBackendGroup.isEnabled, true))
    .orderBy(asc(imageBackendGroup.priority), asc(imageBackendGroup.createdAt))
    .limit(1);

  return firstGroup?.id ?? null;
}

async function resolveRequestedGroupId(options: ResolveBackendOptions) {
  if (options.apiKeyId) {
    const [key] = await db
      .select({ groupId: externalApiKey.generationGroupId })
      .from(externalApiKey)
      .where(eq(externalApiKey.id, options.apiKeyId))
      .limit(1);
    if (key?.groupId) return key.groupId;
  }

  const [preference] = await db
    .select({ groupId: userImageBackendPreference.groupId })
    .from(userImageBackendPreference)
    .where(eq(userImageBackendPreference.userId, options.userId))
    .limit(1);

  return preference?.groupId || (await getDefaultGroupId());
}

async function ensureGroupUsable(groupId: string | null) {
  if (!groupId) return null;
  const [group] = await db
    .select()
    .from(imageBackendGroup)
    .where(and(eq(imageBackendGroup.id, groupId), eq(imageBackendGroup.isEnabled, true)))
    .limit(1);
  return group ?? null;
}

async function selectPoolMember(
  groupId: string | null,
  requestKind: ImageBackendRequestKind
): Promise<PoolMember | null> {
  const apiGroupFilter = groupId ? eq(imageBackendApi.groupId, groupId) : sql`true`;
  const accountGroupFilter = groupId
    ? eq(imageBackendAccount.groupId, groupId)
    : sql`true`;

  const [apiRows, accountRows] = await Promise.all([
    db
      .select()
      .from(imageBackendApi)
      .where(and(eq(imageBackendApi.isEnabled, true), apiGroupFilter))
      .orderBy(
        asc(imageBackendApi.priority),
        asc(imageBackendApi.lastUsedAt),
        asc(imageBackendApi.createdAt)
      )
      .limit(50),
    db
    .select()
    .from(imageBackendAccount)
    .where(and(eq(imageBackendAccount.isEnabled, true), accountGroupFilter))
    .orderBy(
      asc(imageBackendAccount.priority),
      asc(imageBackendAccount.lastUsedAt),
      asc(imageBackendAccount.createdAt)
    )
      .limit(50),
  ]);

  const apiMembers: PoolMember[] = apiRows.map((row) => ({
    type: "api",
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: row.model,
    useStream: row.useStream,
    contentSafetyEnabled: row.contentSafetyEnabled,
    priority: row.priority,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  }));

  const accountMembers: PoolMember[] = accountRows
    .filter((row) => {
      const backend = normalizeAccountBackend(row.implementationMode);
      return requestKind !== "responses" || backend === "responses";
    })
    .map((row) => ({
      type: "account",
      id: row.id,
      groupId: row.groupId,
      name: row.name,
      accessToken: row.accessToken,
      model: row.model,
      implementationMode: row.implementationMode,
      contentSafetyEnabled: row.contentSafetyEnabled,
      priority: row.priority,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
    }));

  return [...apiMembers, ...accountMembers]
    .sort((left, right) => {
      const priorityDiff = left.priority - right.priority;
      if (priorityDiff !== 0) return priorityDiff;
      const lastUsedDiff =
        memberTimestamp(left.lastUsedAt) - memberTimestamp(right.lastUsedAt);
      if (lastUsedDiff !== 0) return lastUsedDiff;
      return memberTimestamp(left.createdAt) - memberTimestamp(right.createdAt);
    })[0] ?? null;
}

export async function resolveImageBackendPoolConfig(
  options: ResolveBackendOptions
): Promise<ResolvedImageBackendPoolConfig | null> {
  const requestedGroupId = await resolveRequestedGroupId(options);
  const group = await ensureGroupUsable(requestedGroupId);
  if (!group) return null;

  const member = await selectPoolMember(group.id, options.requestKind);
  if (!member) return null;

  const contentSafetyEnabled = effectiveContentSafety(
    group.contentSafetyEnabled,
    member.contentSafetyEnabled
  );

  if (member.type === "api") {
    await db
      .update(imageBackendApi)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(imageBackendApi.id, member.id));
    return {
      config: {
        baseUrl: stripTrailingSlash(member.baseUrl),
        apiKey: member.apiKey,
        model: member.model || undefined,
        useStream: member.useStream,
        supportsPromptOptimizationControl: true,
        contentSafetyEnabled,
        backend: {
          type: "pool-api",
          id: member.id,
          groupId: group.id,
          requestKind: options.requestKind,
        },
      },
      groupId: group.id,
      memberId: member.id,
      memberType: "api",
      contentSafetyEnabled,
    };
  }

  await db
    .update(imageBackendAccount)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(imageBackendAccount.id, member.id));

  const implementationMode = normalizeAccountBackend(member.implementationMode);
  const isResponsesBackend = implementationMode === "responses";

  return {
    config: {
      baseUrl: isResponsesBackend
        ? CHATGPT_CODEX_RESPONSES_URL
        : "https://chatgpt.com",
      apiKey: member.accessToken,
      model: member.model || undefined,
      contentSafetyEnabled,
      headers: isResponsesBackend
        ? {
            "OpenAI-Beta": "responses=experimental",
            originator: "codex_cli_rs",
            "User-Agent": "codex_cli_rs/0.1.0",
          }
        : undefined,
      backend: {
        type: "pool-account",
        id: member.id,
        groupId: group.id,
        requestKind: options.requestKind,
        accountBackend: implementationMode,
      },
    },
    groupId: group.id,
    memberId: member.id,
    memberType: "account",
    contentSafetyEnabled,
  };
}

export async function listImageBackendGroupOptions(options?: {
  userSelectableOnly?: boolean;
}) {
  return await db
    .select({
      id: imageBackendGroup.id,
      name: imageBackendGroup.name,
      description: imageBackendGroup.description,
      isDefault: imageBackendGroup.isDefault,
      isUserSelectable: imageBackendGroup.isUserSelectable,
      isEnabled: imageBackendGroup.isEnabled,
      priority: imageBackendGroup.priority,
    })
    .from(imageBackendGroup)
    .where(
      options?.userSelectableOnly
        ? and(
            eq(imageBackendGroup.isEnabled, true),
            eq(imageBackendGroup.isUserSelectable, true)
          )
        : eq(imageBackendGroup.isEnabled, true)
    )
    .orderBy(asc(imageBackendGroup.priority), asc(imageBackendGroup.createdAt));
}

export async function listSelectableImageBackendGroups() {
  return await listImageBackendGroupOptions({ userSelectableOnly: true });
}

export async function getUserImageBackendPreference(userId: string) {
  const [preference] = await db
    .select({ groupId: userImageBackendPreference.groupId })
    .from(userImageBackendPreference)
    .where(eq(userImageBackendPreference.userId, userId))
    .limit(1);
  return preference?.groupId ?? null;
}

export async function setUserImageBackendPreference(
  userId: string,
  groupId: string | null
) {
  if (groupId) {
    const [group] = await db
      .select({ id: imageBackendGroup.id })
      .from(imageBackendGroup)
      .where(
        and(
          eq(imageBackendGroup.id, groupId),
          eq(imageBackendGroup.isEnabled, true),
          eq(imageBackendGroup.isUserSelectable, true)
        )
      )
      .limit(1);
    if (!group) throw new Error("生图分组不存在或不可选择");
  }

  const [existing] = await db
    .select({ id: userImageBackendPreference.id })
    .from(userImageBackendPreference)
    .where(eq(userImageBackendPreference.userId, userId))
    .limit(1);

  if (existing) {
    await db
      .update(userImageBackendPreference)
      .set({ groupId, updatedAt: new Date() })
      .where(eq(userImageBackendPreference.id, existing.id));
  } else {
    await db.insert(userImageBackendPreference).values({
      id: nanoid(),
      userId,
      groupId,
    });
  }
}

type UpsertGroupInput = {
  id?: string;
  name: string;
  description?: string | null;
  isEnabled: boolean;
  isDefault: boolean;
  isUserSelectable: boolean;
  contentSafetyEnabled: boolean | null;
  priority: number;
};

export async function upsertImageBackendGroup(input: UpsertGroupInput) {
  if (input.isDefault) {
    await db.update(imageBackendGroup).set({
      isDefault: false,
      updatedAt: new Date(),
    });
  }

  if (input.id) {
    await db
      .update(imageBackendGroup)
      .set({
        name: input.name,
        description: input.description || null,
        isEnabled: input.isEnabled,
        isDefault: input.isDefault,
        isUserSelectable: input.isUserSelectable,
        contentSafetyEnabled: input.contentSafetyEnabled,
        priority: input.priority,
        updatedAt: new Date(),
      })
      .where(eq(imageBackendGroup.id, input.id));
    return input.id;
  }

  const id = nanoid();
  await db.insert(imageBackendGroup).values({
    id,
    name: input.name,
    description: input.description || null,
    isEnabled: input.isEnabled,
    isDefault: input.isDefault,
    isUserSelectable: input.isUserSelectable,
    contentSafetyEnabled: input.contentSafetyEnabled,
    priority: input.priority,
  });
  return id;
}

export async function deleteImageBackendGroup(groupId: string) {
  await db
    .delete(imageBackendGroup)
    .where(eq(imageBackendGroup.id, groupId));
}

type UpsertAccountInput = {
  id?: string;
  groupId?: string | null;
  name: string;
  email?: string | null;
  accessToken?: string;
  refreshToken?: string | null;
  implementationMode: ImageBackendAccountBackend;
  model?: string | null;
  contentSafetyEnabled: boolean;
  isEnabled: boolean;
  priority: number;
  concurrency: number;
  status?: string;
};

export async function upsertImageBackendAccount(input: UpsertAccountInput) {
  const update = {
    groupId: input.groupId || null,
    name: input.name,
    email: input.email || null,
    refreshToken: input.refreshToken || null,
    implementationMode: normalizeAccountBackend(input.implementationMode),
    model: input.model || null,
    contentSafetyEnabled: input.contentSafetyEnabled,
    isEnabled: input.isEnabled,
    priority: input.priority,
    concurrency: input.concurrency,
    status: input.status || "active",
    updatedAt: new Date(),
  };

  if (input.id) {
    await db
      .update(imageBackendAccount)
      .set(
        input.accessToken
          ? {
              ...update,
              accessToken: input.accessToken,
              credentialHash: hashBackendCredential(input.accessToken),
            }
          : update
      )
      .where(eq(imageBackendAccount.id, input.id));
    return input.id;
  }

  if (!input.accessToken) {
    throw new Error("accessToken is required");
  }

  const id = nanoid();
  await db.insert(imageBackendAccount).values({
    id,
    ...update,
    accessToken: input.accessToken,
    credentialHash: hashBackendCredential(input.accessToken),
  });
  return id;
}

type ImportAccountInput = {
  groupId?: string | null;
  implementationMode: ImageBackendAccountBackend;
  contentSafetyEnabled: boolean;
  accounts: Array<{
    name?: string | null;
    email?: string | null;
    accessToken: string;
    refreshToken?: string | null;
    model?: string | null;
    priority?: number | null;
    concurrency?: number | null;
  }>;
};

export async function importImageBackendAccounts(input: ImportAccountInput) {
  const imported: string[] = [];
  for (const [index, account] of input.accounts.entries()) {
    const accessToken = account.accessToken.trim();
    if (!accessToken) continue;
    const id = await upsertImageBackendAccount({
      groupId: input.groupId,
      name:
        account.name?.trim() ||
        account.email?.trim() ||
        `导入账号 ${index + 1}`,
      email: account.email?.trim() || null,
      accessToken,
      refreshToken: account.refreshToken?.trim() || null,
      implementationMode: input.implementationMode,
      model: account.model?.trim() || null,
      contentSafetyEnabled: input.contentSafetyEnabled,
      isEnabled: true,
      priority: account.priority ?? 50,
      concurrency: account.concurrency ?? 1,
    });
    imported.push(id);
  }
  return imported;
}

type UpsertApiInput = {
  id?: string;
  groupId?: string | null;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model?: string | null;
  useStream: boolean;
  contentSafetyEnabled: boolean;
  isEnabled: boolean;
  priority: number;
  status?: string;
};

export async function upsertImageBackendApi(input: UpsertApiInput) {
  const update = {
    groupId: input.groupId || null,
    name: input.name,
    baseUrl: stripTrailingSlash(input.baseUrl),
    model: input.model || null,
    useStream: input.useStream,
    contentSafetyEnabled: input.contentSafetyEnabled,
    isEnabled: input.isEnabled,
    priority: input.priority,
    status: input.status || "active",
    updatedAt: new Date(),
  };

  if (input.id) {
    await db
      .update(imageBackendApi)
      .set(input.apiKey ? { ...update, apiKey: input.apiKey } : update)
      .where(eq(imageBackendApi.id, input.id));
    return input.id;
  }

  if (!input.apiKey) {
    throw new Error("apiKey is required");
  }

  const id = nanoid();
  await db.insert(imageBackendApi).values({
    id,
    ...update,
    apiKey: input.apiKey,
  });
  return id;
}

export async function deleteImageBackendMembers(input: {
  accountIds?: string[];
  apiIds?: string[];
}) {
  if (input.accountIds?.length) {
    await db
      .delete(imageBackendAccount)
      .where(inArray(imageBackendAccount.id, input.accountIds));
  }
  if (input.apiIds?.length) {
    await db
      .delete(imageBackendApi)
      .where(inArray(imageBackendApi.id, input.apiIds));
  }
}

export async function listAdminImageBackendPool() {
  const groups = await db
    .select()
    .from(imageBackendGroup)
    .orderBy(asc(imageBackendGroup.priority), asc(imageBackendGroup.createdAt));
  const accountCounts = await db
    .select({ groupId: imageBackendAccount.groupId, value: count() })
    .from(imageBackendAccount)
    .groupBy(imageBackendAccount.groupId);
  const apiCounts = await db
    .select({ groupId: imageBackendApi.groupId, value: count() })
    .from(imageBackendApi)
    .groupBy(imageBackendApi.groupId);
  const accountCountMap = new Map(
    accountCounts.map((item) => [item.groupId, Number(item.value)])
  );
  const apiCountMap = new Map(
    apiCounts.map((item) => [item.groupId, Number(item.value)])
  );

  const summaries: ImageBackendGroupSummary[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    description: group.description,
    isEnabled: group.isEnabled,
    isDefault: group.isDefault,
    isUserSelectable: group.isUserSelectable,
    contentSafetyEnabled: group.contentSafetyEnabled,
    priority: group.priority,
    apiCount: apiCountMap.get(group.id) ?? 0,
    accountCount: accountCountMap.get(group.id) ?? 0,
  }));

  const accounts = await db
    .select({
      id: imageBackendAccount.id,
      groupId: imageBackendAccount.groupId,
      name: imageBackendAccount.name,
      email: imageBackendAccount.email,
      implementationMode: imageBackendAccount.implementationMode,
      model: imageBackendAccount.model,
      contentSafetyEnabled: imageBackendAccount.contentSafetyEnabled,
      isEnabled: imageBackendAccount.isEnabled,
      priority: imageBackendAccount.priority,
      concurrency: imageBackendAccount.concurrency,
      status: imageBackendAccount.status,
      lastUsedAt: imageBackendAccount.lastUsedAt,
      createdAt: imageBackendAccount.createdAt,
    })
    .from(imageBackendAccount)
    .orderBy(asc(imageBackendAccount.priority), desc(imageBackendAccount.createdAt));

  const apis = await db
    .select({
      id: imageBackendApi.id,
      groupId: imageBackendApi.groupId,
      name: imageBackendApi.name,
      baseUrl: imageBackendApi.baseUrl,
      model: imageBackendApi.model,
      interfaceMode: imageBackendApi.interfaceMode,
      useStream: imageBackendApi.useStream,
      contentSafetyEnabled: imageBackendApi.contentSafetyEnabled,
      isEnabled: imageBackendApi.isEnabled,
      priority: imageBackendApi.priority,
      status: imageBackendApi.status,
      lastUsedAt: imageBackendApi.lastUsedAt,
      createdAt: imageBackendApi.createdAt,
    })
    .from(imageBackendApi)
    .orderBy(asc(imageBackendApi.priority), desc(imageBackendApi.createdAt));

  return {
    groups: summaries,
    accounts,
    apis,
  };
}
