"use server";

import { z } from "zod";

import { adminAction, protectedAction } from "@repo/shared/safe-action";

import {
  deleteImageBackendGroup,
  deleteImageBackendMembers,
  fromSafetyOverride,
  getUserImageBackendPreference,
  importImageBackendAccounts,
  listAdminImageBackendPool,
  listImageBackendGroupOptions,
  listSelectableImageBackendGroups,
  setUserImageBackendPreference,
  upsertImageBackendAccount,
  upsertImageBackendApi,
  upsertImageBackendGroup,
} from "./service";

const nullableGroupIdSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value !== "default" ? value : null));

const safetyOverrideSchema = z.enum(["inherit", "enabled", "disabled"]);
const accountBackendSchema = z.enum(["web", "responses"]);

const withImageBackendPoolAdminAction = (name: string) =>
  adminAction.metadata({ action: `imageBackendPool.${name}` });

export const getSelectableImageBackendGroupsAction = protectedAction
  .metadata({ action: "imageBackendPool.selectableGroups" })
  .action(async ({ ctx }) => {
    const [groups, selectedGroupId] = await Promise.all([
      listSelectableImageBackendGroups(),
      getUserImageBackendPreference(ctx.userId),
    ]);
    return { groups, selectedGroupId };
  });

export const setUserImageBackendPreferenceAction = protectedAction
  .metadata({ action: "imageBackendPool.setPreference" })
  .schema(
    z.object({
      groupId: nullableGroupIdSchema,
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    await setUserImageBackendPreference(ctx.userId, parsedInput.groupId);
    return { success: true };
  });

export const getAdminImageBackendPoolAction =
  withImageBackendPoolAdminAction("list").action(async () => {
    const pool = await listAdminImageBackendPool();
    return pool;
  });

export const saveImageBackendGroupAction = withImageBackendPoolAdminAction(
  "saveGroup"
)
  .schema(
    z.object({
      id: z.string().trim().optional(),
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(500).optional(),
      isEnabled: z.boolean().default(true),
      isDefault: z.boolean().default(false),
      isUserSelectable: z.boolean().default(true),
      contentSafety: safetyOverrideSchema.default("inherit"),
      priority: z.coerce.number().int().min(0).max(10000).default(50),
    })
  )
  .action(async ({ parsedInput }) => {
    const id = await upsertImageBackendGroup({
      id: parsedInput.id,
      name: parsedInput.name,
      description: parsedInput.description || null,
      isEnabled: parsedInput.isEnabled,
      isDefault: parsedInput.isDefault,
      isUserSelectable: parsedInput.isUserSelectable,
      contentSafetyEnabled: fromSafetyOverride(parsedInput.contentSafety),
      priority: parsedInput.priority,
    });
    return { success: true, id };
  });

export const deleteImageBackendGroupAction = withImageBackendPoolAdminAction(
  "deleteGroup"
)
  .schema(z.object({ id: z.string().trim().min(1) }))
  .action(async ({ parsedInput }) => {
    await deleteImageBackendGroup(parsedInput.id);
    return { success: true };
  });

export const saveImageBackendAccountAction = withImageBackendPoolAdminAction(
  "saveAccount"
)
  .schema(
    z.object({
      id: z.string().trim().optional(),
      groupId: nullableGroupIdSchema,
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().max(200).optional(),
      accessToken: z.string().trim().optional(),
      refreshToken: z.string().trim().optional(),
      implementationMode: accountBackendSchema.default("web"),
      model: z.string().trim().max(120).optional(),
      contentSafetyEnabled: z.boolean().default(true),
      isEnabled: z.boolean().default(true),
      priority: z.coerce.number().int().min(0).max(10000).default(50),
      concurrency: z.coerce.number().int().min(1).max(100).default(1),
      status: z.string().trim().max(80).optional(),
    })
  )
  .action(async ({ parsedInput }) => {
    const id = await upsertImageBackendAccount({
      id: parsedInput.id,
      groupId: parsedInput.groupId,
      name: parsedInput.name,
      email: parsedInput.email || null,
      accessToken: parsedInput.accessToken || undefined,
      refreshToken: parsedInput.refreshToken || null,
      implementationMode: parsedInput.implementationMode,
      model: parsedInput.model || null,
      contentSafetyEnabled: parsedInput.contentSafetyEnabled,
      isEnabled: parsedInput.isEnabled,
      priority: parsedInput.priority,
      concurrency: parsedInput.concurrency,
      status: parsedInput.status || "active",
    });
    return { success: true, id };
  });

const importedAccountSchema = z.object({
  name: z.string().trim().optional(),
  email: z.string().trim().optional(),
  accessToken: z.string().trim().optional(),
  access_token: z.string().trim().optional(),
  token: z.string().trim().optional(),
  refreshToken: z.string().trim().optional(),
  refresh_token: z.string().trim().optional(),
  model: z.string().trim().optional(),
  priority: z.coerce.number().int().optional(),
  concurrency: z.coerce.number().int().optional(),
});

function parseSub2ApiAccounts(raw: string) {
  const parsed = JSON.parse(raw) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && "accounts" in parsed
      ? (parsed as { accounts?: unknown }).accounts
      : [];
  if (!Array.isArray(rows)) {
    throw new Error("导入内容需要是数组，或包含 accounts 数组。");
  }
  return rows
    .map((row) => importedAccountSchema.parse(row))
    .map((row) => ({
      name: row.name || row.email,
      email: row.email,
      accessToken: row.accessToken || row.access_token || row.token || "",
      refreshToken: row.refreshToken || row.refresh_token,
      model: row.model,
      priority: row.priority,
      concurrency: row.concurrency,
    }))
    .filter((row) => row.accessToken);
}

export const importImageBackendAccountsAction =
  withImageBackendPoolAdminAction("importAccounts")
    .schema(
      z.object({
        groupId: nullableGroupIdSchema,
        implementationMode: accountBackendSchema.default("web"),
        contentSafetyEnabled: z.boolean().default(true),
        json: z.string().trim().min(2),
      })
    )
    .action(async ({ parsedInput }) => {
      const accounts = parseSub2ApiAccounts(parsedInput.json);
      const ids = await importImageBackendAccounts({
        groupId: parsedInput.groupId,
        implementationMode: parsedInput.implementationMode,
        contentSafetyEnabled: parsedInput.contentSafetyEnabled,
        accounts,
      });
      return { success: true, count: ids.length };
    });

export const saveImageBackendApiAction = withImageBackendPoolAdminAction(
  "saveApi"
)
  .schema(
    z.object({
      id: z.string().trim().optional(),
      groupId: nullableGroupIdSchema,
      name: z.string().trim().min(1).max(120),
      baseUrl: z.string().trim().url(),
      apiKey: z.string().trim().optional(),
      model: z.string().trim().max(120).optional(),
      useStream: z.boolean().default(false),
      contentSafetyEnabled: z.boolean().default(true),
      isEnabled: z.boolean().default(true),
      priority: z.coerce.number().int().min(0).max(10000).default(50),
      status: z.string().trim().max(80).optional(),
    })
  )
  .action(async ({ parsedInput }) => {
    const id = await upsertImageBackendApi({
      id: parsedInput.id,
      groupId: parsedInput.groupId,
      name: parsedInput.name,
      baseUrl: parsedInput.baseUrl,
      apiKey: parsedInput.apiKey || undefined,
      model: parsedInput.model || null,
      useStream: parsedInput.useStream,
      contentSafetyEnabled: parsedInput.contentSafetyEnabled,
      isEnabled: parsedInput.isEnabled,
      priority: parsedInput.priority,
      status: parsedInput.status || "active",
    });
    return { success: true, id };
  });

export const deleteImageBackendMemberAction =
  withImageBackendPoolAdminAction("deleteMember")
    .schema(
      z.object({
        type: z.enum(["account", "api"]),
        id: z.string().trim().min(1),
      })
    )
    .action(async ({ parsedInput }) => {
      await deleteImageBackendMembers(
        parsedInput.type === "account"
          ? { accountIds: [parsedInput.id] }
          : { apiIds: [parsedInput.id] }
      );
      return { success: true };
    });

export const getImageBackendGroupOptionsAction = protectedAction
  .metadata({ action: "imageBackendPool.groupOptions" })
  .action(async () => {
    const groups = await listImageBackendGroupOptions();
    return { groups };
  });
