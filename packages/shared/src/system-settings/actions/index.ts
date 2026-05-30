"use server";

import { z } from "zod";

import { superAdminAction } from "../../safe-action";
import {
  getAdminSystemSettingsSnapshot,
  importSystemSettingsFromEnv,
  initializeMissingSystemSettingsDefaults,
  setSystemSettings,
} from "../index";
import { syncSystemSettingsToEnvFiles } from "../env-file";

const settingUpdateSchema = z.object({
  key: z.string().min(1),
  value: z.unknown().optional(),
  clear: z.boolean().optional(),
});

export const getSystemSettingsAction = superAdminAction
  .metadata({ action: "system-settings.get" })
  .action(async () => {
    const settings = await getAdminSystemSettingsSnapshot();
    return { settings };
  });

export const updateSystemSettingsAction = superAdminAction
  .metadata({ action: "system-settings.update" })
  .schema(
    z.object({
      settings: z.array(settingUpdateSchema).min(1),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const changedKeys = await setSystemSettings(
      parsedInput.settings.map((setting) => ({
        key: setting.key,
        value: setting.value,
        ...(setting.clear !== undefined ? { clear: setting.clear } : {}),
      })),
      ctx.userId
    );
    const envSync = await syncSystemSettingsToEnvFiles();

    return {
      success: true,
      changedKeys,
      envFiles: envSync.files,
      message: "系统设置已保存",
    };
  });

export const importSystemSettingsFromEnvAction = superAdminAction
  .metadata({ action: "system-settings.importEnv" })
  .schema(z.object({ overwrite: z.boolean().optional() }).optional())
  .action(async ({ parsedInput, ctx }) => {
    const importedKeys = await importSystemSettingsFromEnv({
      updatedBy: ctx.userId,
      overwrite: parsedInput?.overwrite ?? true,
    });
    const envSync = await syncSystemSettingsToEnvFiles();

    return {
      success: true,
      importedKeys,
      envFiles: envSync.files,
      message:
        importedKeys.length > 0
          ? `已导入 ${importedKeys.length} 个环境变量配置`
          : "没有可导入的环境变量配置",
    };
  });

export const initializeSystemSettingsDefaultsAction = superAdminAction
  .metadata({ action: "system-settings.initializeDefaults" })
  .action(async ({ ctx }) => {
    const initializedKeys = await initializeMissingSystemSettingsDefaults({
      updatedBy: ctx.userId,
    });
    const envSync = await syncSystemSettingsToEnvFiles();

    return {
      success: true,
      initializedKeys,
      envFiles: envSync.files,
      message:
        initializedKeys.length > 0
          ? `已初始化 ${initializedKeys.length} 个默认配置`
          : "默认配置已存在，无需初始化",
    };
  });
