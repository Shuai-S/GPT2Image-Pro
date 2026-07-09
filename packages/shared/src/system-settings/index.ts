import { createHash } from "node:crypto";

import { db } from "@repo/database";
import { systemSetting } from "@repo/database/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { unstable_cache, updateTag } from "next/cache";

import {
  formatRegistrationEmailDomains,
  normalizeRegistrationEmailDomains,
  parseRegistrationEmailDomains,
  REGISTRATION_EMAIL_DOMAINS_SETTING_KEY,
} from "../auth/email-domain";
import { normalizeContactEmail } from "../config/contact";
import { logWarn } from "../logger";
import {
  getModelPricingRulesValidationIssues,
  MODEL_PRICING_RULES_SETTING_KEY,
} from "../model-pricing";
import {
  isSettingKey,
  SETTING_DEFINITION_BY_KEY,
  type SettingDefinition,
  type SettingKey,
  SYSTEM_SETTING_DEFINITIONS,
} from "./definitions";

export {
  SETTING_CATEGORIES,
  SETTING_DEFINITION_BY_KEY,
  type SettingCategory,
  type SettingDefinition,
  type SettingKey,
  type SettingValueType,
  SYSTEM_SETTING_DEFINITIONS,
} from "./definitions";

const CACHE_TTL_SECONDS = 60;
const SKIP_RUNTIME_SETTINGS_DB_ENV = "GPT2IMAGE_SKIP_RUNTIME_SETTINGS_DB";

/**
 * system-settings 全表快照在 Next data cache 中的失效 tag。
 *
 * 所有写入 system_setting 表的触点在 mutation 完成后须调用
 * `clearSystemSettingsCache()`(内部转发 `updateTag(SYSTEM_SETTINGS_CACHE_TAG)`)
 * 才能让 `unstable_cache` 在下次请求前刷新缓存。
 */
export const SYSTEM_SETTINGS_CACHE_TAG = "system-settings";

export type OperationFeatureKey =
  | "blog"
  | "textToImage"
  | "imageToImage"
  | "chat"
  | "agent"
  | "waterfall"
  | "video"
  | "infiniteCanvas"
  | "systemDocs"
  | "externalApi";

export type OperationFeatureFlags = Record<OperationFeatureKey, boolean>;

const OPERATION_FEATURE_SETTING_KEYS = {
  blog: "OPERATION_BLOG_ENABLED",
  textToImage: "OPERATION_TEXT_TO_IMAGE_ENABLED",
  imageToImage: "OPERATION_IMAGE_TO_IMAGE_ENABLED",
  chat: "OPERATION_CHAT_ENABLED",
  agent: "OPERATION_AGENT_ENABLED",
  waterfall: "OPERATION_WATERFALL_ENABLED",
  video: "OPERATION_VIDEO_ENABLED",
  infiniteCanvas: "OPERATION_INFINITE_CANVAS_ENABLED",
  systemDocs: "OPERATION_SYSTEM_DOCS_ENABLED",
  externalApi: "OPERATION_EXTERNAL_API_ENABLED",
} as const satisfies Record<OperationFeatureKey, SettingKey>;

// 运行期进程级"上次成功加载的设置快照",仅用作 unstable_cache 抛错时的兜底,
// 保持与原进程内 10s 缓存一致的"DB 异常回退旧值"容错语义。unstable_cache 命中
// 时不会更新本变量,因此它只在稳定请求成功后于一处写入,作为短暂的 stale 数据。
let lastGoodMap: Map<string, unknown> | undefined;

/**
 * 判断异常是否来自 Next data cache 上下文缺失。
 *
 * @param error - unstable_cache 抛出的未知异常。
 * @returns true 表示当前调用点不在 Next 请求/渲染缓存上下文内。
 * @sideEffects 无。
 */
function isNextDataCacheContextMissing(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("incrementalCache missing");
}

function normalizeStoredValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return value;
}

/**
 * 实际扫描 system_setting 全表并归一化为 Map(无缓存)。
 *
 * @returns 以 key→normalized value 形式返回当前整张配置表快照。
 * @sideEffects 全表扫描 system_setting,无 WHERE、无分页;调用方应经缓存包装器访问。
 */
async function querySystemSettingsMap(): Promise<Map<string, unknown>> {
  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
    })
    .from(systemSetting);

  const values = new Map<string, unknown>();
  for (const row of rows) {
    const normalized = normalizeStoredValue(row.value);
    if (normalized !== undefined) {
      values.set(row.key, normalized);
    }
  }
  return values;
}

/**
 * unstable_cache 包装的全表查询入口。
 *
 * WHY: generateMetadata/branding/运营开关等高频读路径原来每次都打 DB;改用
 * Next data cache(unstable_cache) 后二次访问命中缓存层不再触碰 DB,既改善
 * 所有页面 metadata 性能,又通过 SYSTEM_SETTINGS_CACHE_TAG 在 mutation 后
 * 即时失效,保持数据一致性。
 *
 * unstable_cache 只接受可序列化的缓存载荷;Map 不能直接被 JSON 序列化(会丢成
 * 普通对象、再读不回 Map),故内部以 entries 数组为缓存载荷,外层 loadSystemSettingsMap
 * 重建 Map。
 *
 * 回调无参数:全表查询不依赖可变入参,固定 keyParts ["system-settings-map"] 即可,
 * 配合 tag 做精准失效,而非按入参分桶。
 */
const cachedQuerySystemSettingsEntries = unstable_cache(
  async (): Promise<Array<[string, unknown]>> => {
    const map = await querySystemSettingsMap();
    return [...map.entries()];
  },
  ["system-settings-map"],
  { revalidate: CACHE_TTL_SECONDS, tags: [SYSTEM_SETTINGS_CACHE_TAG] }
);

/**
 * 读取整张 system_setting 表的归一化快照(带缓存 + stale fallback)。
 *
 * WHY: 先走 unstable_cache 命中 Next data cache;若缓存层抛错(如构建期 data cache
 * 不可用、序列化异常),退而复用模块级 lastGoodMap 上次成功结果,与原 10s 进程内
 * 缓存的"DB 异常复用旧值"语义一致,避免设置读取链因瞬时缓存故障导致全站功能掉线。
 *
 * @returns 当前生效的 system_settings 快照 Map。
 * @sideEffects 成功时刷新 lastGoodMap;失败且无兜底时向上抛错。
 */
async function loadSystemSettingsMap(): Promise<Map<string, unknown>> {
  try {
    const entries = await cachedQuerySystemSettingsEntries();
    const values = new Map<string, unknown>(entries);
    lastGoodMap = values;
    return values;
  } catch (error) {
    if (isNextDataCacheContextMissing(error)) {
      try {
        // WHY: instrumentation/register 与部分启动期后台任务运行在 Next 请求
        // 上下文之外，此时 unstable_cache 没有 incrementalCache 可用。这里直读
        // DB，保留启动期配置能力；页面/Server Action 路径仍走上方缓存入口。
        const values = await querySystemSettingsMap();
        lastGoodMap = values;
        return values;
      } catch (directError) {
        if (lastGoodMap) {
          logWarn(
            "System settings direct query unavailable; reusing stale snapshot",
            {
              error:
                directError instanceof Error
                  ? directError.message
                  : String(directError),
            }
          );
          return lastGoodMap;
        }
        throw directError;
      }
    }

    if (lastGoodMap) {
      logWarn("System settings cache unavailable; reusing stale snapshot", {
        error: error instanceof Error ? error.message : String(error),
      });
      return lastGoodMap;
    }
    throw error;
  }
}

/**
 * 判断当前进程是否只允许从环境变量读取运行时配置。
 *
 * @returns Docker/CI 构建期显式开启时返回 true。
 * @sideEffects 无。
 */
function shouldSkipRuntimeSettingsDb() {
  return process.env[SKIP_RUNTIME_SETTINGS_DB_ENV] === "1";
}

/**
 * 读取运行时配置的 DB 值，构建期可显式跳过 DB。
 *
 * @param key - 系统配置键。
 * @returns DB 中的配置值；构建期跳过时返回 undefined，由调用方回退环境变量或默认值。
 * @sideEffects 正常运行时读取 system_setting 表；构建期不触碰数据库连接。
 */
async function getRuntimeSystemSettingValue(key: SettingKey) {
  if (shouldSkipRuntimeSettingsDb()) return undefined;
  return getSystemSettingValue(key);
}

/**
 * 让 system-settings 全表缓存失效。
 *
 * WHY: 内部读路径已升级为 unstable_cache + tag,失效须用 `updateTag` 而非清进程变量。
 * 保留原导出名以避免破坏所有现有调用点(mutation/单测等);内部同时丢弃 lastGoodMap,
 * 使下一次 unstable_cache 抛错时不再复用过期兜底。
 *
 * @sideEffects 调用 Next 的 updateTag 标记 SYSTEM_SETTINGS_CACHE_TAG 为待失效;
 *              清空模块级 stale 兜底快照。
 */
export function clearSystemSettingsCache() {
  lastGoodMap = undefined;
  updateTag(SYSTEM_SETTINGS_CACHE_TAG);
}

export async function getSystemSettingValue(
  key: SettingKey
): Promise<unknown | undefined> {
  const values = await loadSystemSettingsMap();
  return values.get(key);
}

function parseJsonText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed) as unknown;
}

export async function getRuntimeSettingJson(key: SettingKey) {
  const value = await getRuntimeSystemSettingValue(key);
  if (value !== undefined) {
    if (typeof value === "string") return parseJsonText(value);
    return value;
  }

  const envValue = process.env[key];
  if (!envValue?.trim()) return undefined;
  return parseJsonText(envValue);
}

export async function getSystemSettingString(key: SettingKey) {
  const value = await getSystemSettingValue(key);
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export async function getRuntimeSettingString(key: SettingKey) {
  const value = await getRuntimeSystemSettingValue(key);
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return process.env[key]?.trim() || undefined;
}

/**
 * 读取公开注册允许使用的邮箱域名后缀。
 *
 * @returns 后台配置、环境变量或代码默认值解析出的域名列表。
 * @sideEffects 正常运行时读取 system_setting 表；构建期可按全局规则回退环境变量。
 */
export async function getRuntimeRegistrationEmailDomains() {
  return parseRegistrationEmailDomains(
    await getRuntimeSettingString(REGISTRATION_EMAIL_DOMAINS_SETTING_KEY)
  );
}

export async function getRuntimeSettingBoolean(
  key: SettingKey,
  fallback = false
) {
  const value = await getRuntimeSystemSettingValue(key);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string" && value.trim()) {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }

  const envValue = process.env[key];
  if (!envValue) return fallback;
  return ["1", "true", "yes", "on"].includes(envValue.toLowerCase());
}

/**
 * 读取单个运营功能开关。
 *
 * @param feature 运营功能标识。
 * @returns 功能启用时返回 true；未配置时默认启用，避免升级后误关线上功能。
 * @sideEffects 正常运行时读取 system_setting 表，构建期可按全局规则回退环境变量。
 */
export async function isOperationFeatureEnabled(feature: OperationFeatureKey) {
  return getRuntimeSettingBoolean(
    OPERATION_FEATURE_SETTING_KEYS[feature],
    true
  );
}

/**
 * 读取公开内容与创作功能的运营开关快照。
 *
 * @returns 所有运营功能开关的布尔快照。
 * @sideEffects 并发读取运行时系统设置；未配置的开关默认启用。
 */
export async function getRuntimeOperationFeatureFlags(): Promise<OperationFeatureFlags> {
  const entries = await Promise.all(
    Object.entries(OPERATION_FEATURE_SETTING_KEYS).map(
      async ([feature, key]) => [
        feature,
        await getRuntimeSettingBoolean(key, true),
      ]
    )
  );

  return Object.fromEntries(entries) as OperationFeatureFlags;
}

export async function getRuntimeSettingNumber(
  key: SettingKey,
  fallback: number,
  options?: { positive?: boolean; nonNegative?: boolean }
) {
  const isAllowedNumber = (candidate: number) => {
    if (!Number.isFinite(candidate)) return false;
    if (options?.positive) return candidate > 0;
    if (options?.nonNegative) return candidate >= 0;
    return true;
  };
  const value = await getRuntimeSystemSettingValue(key);
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (isAllowedNumber(numericValue)) {
    return numericValue;
  }

  const envRawValue = process.env[key]?.trim();
  if (envRawValue) {
    const envValue = Number(envRawValue);
    if (isAllowedNumber(envValue)) {
      return envValue;
    }
  }

  return fallback;
}

export async function getRuntimeSettingSelect<T extends string>(
  key: SettingKey,
  allowed: readonly T[],
  fallback: T
) {
  const value = await getRuntimeSettingString(key);
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function getProcessSettingString(key: SettingKey) {
  return process.env[key]?.trim() || undefined;
}

export function getProcessSettingBoolean(key: SettingKey, fallback = false) {
  const value = process.env[key];
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function getProcessSettingNumber(key: SettingKey, fallback: number) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function coerceValue(definition: SettingDefinition, value: unknown) {
  if (definition.valueType === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    }
    return Boolean(value);
  }

  if (definition.valueType === "number") {
    // WHY: 空白数值输入视为清空（删除行，回退默认值），与 string 类型一致；
    // 否则 Number("") === 0 会被范围校验误判，破坏"清空即重置"的后台 UX。
    if (typeof value === "string" && !value.trim()) {
      return "";
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${definition.label} 必须是有效数字`);
    }
    // WHY: 经济/安全语义键（积分、价格、审核超时等）在 definitions.ts 声明了业务
    // 上下界；S-C1 已把写入收紧为 superAdminAction，此处补 per-key 范围闭区间钳制，
    // 拒绝负积分/负价格/0 超时/异常巨大值等会破坏经济或安全语义的脏值落库。
    // 未声明 min/max 的键行为不变。
    if (definition.min !== undefined && numeric < definition.min) {
      throw new Error(`${definition.label} 不能小于 ${definition.min}`);
    }
    if (definition.max !== undefined && numeric > definition.max) {
      throw new Error(`${definition.label} 不能大于 ${definition.max}`);
    }
    return numeric;
  }

  if (definition.valueType === "json") {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        throw new Error(`${definition.label} 必须是有效 JSON`);
      }
      validateJsonSettingValue(definition, parsed);
      return parsed;
    }
    validateJsonSettingValue(definition, value);
    return value;
  }

  const text = typeof value === "string" ? value.trim() : String(value ?? "");
  if (definition.key === REGISTRATION_EMAIL_DOMAINS_SETTING_KEY) {
    const { domains, invalidDomains } = normalizeRegistrationEmailDomains(text);
    if (invalidDomains.length > 0) {
      throw new Error(
        `${definition.label} 包含无效域名: ${invalidDomains.join(", ")}`
      );
    }
    return domains.length > 0 ? formatRegistrationEmailDomains(domains) : "";
  }
  if (definition.key === "CONTACT_EMAIL" && text) {
    const email = normalizeContactEmail(text);
    if (!email) {
      throw new Error(`${definition.label} 必须是有效邮箱地址`);
    }
    return email;
  }
  if (definition.valueType === "select") {
    const allowed = definition.options?.map((option) => option.value) ?? [];
    if (text && !allowed.includes(text)) {
      throw new Error(`${definition.label} 的取值无效`);
    }
  }
  return text;
}

/**
 * 校验需要业务约束的 JSON 配置项。
 *
 * @param definition 设置定义。
 * @param value 已解析的 JSON 值。
 * @sideEffects 无；发现不可保存的业务结构时抛错。
 */
function validateJsonSettingValue(
  definition: SettingDefinition,
  value: unknown
) {
  if (definition.key !== MODEL_PRICING_RULES_SETTING_KEY) return;

  const issues = getModelPricingRulesValidationIssues(value);
  if (issues.length === 0) return;

  throw new Error(
    `${definition.label} 配置无效：${issues
      .map((issue) => issue.message)
      .join("；")}`
  );
}

function getProcessSettingValue(definition: SettingDefinition) {
  const envValue = process.env[definition.key]?.trim();
  if (!envValue) return undefined;
  return coerceValue(definition, envValue);
}

function getDefaultSettingValue(definition: SettingDefinition) {
  if (definition.secret) return undefined;
  if (definition.exampleValue !== undefined) return definition.exampleValue;
  if (definition.defaultValue !== undefined) return definition.defaultValue;
  return undefined;
}

function syncProcessEnvSetting(key: SettingKey, value: unknown) {
  if (value === null || value === undefined || value === "") {
    delete process.env[key];
    return;
  }

  process.env[key] =
    typeof value === "string"
      ? value.trim()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
}

export async function importSystemSettingsFromEnv(options?: {
  updatedBy?: string;
  overwrite?: boolean;
}) {
  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
    })
    .from(systemSetting);

  const storedKeys = new Set(
    rows
      .filter((row) => normalizeStoredValue(row.value) !== undefined)
      .map((row) => row.key)
  );
  const now = new Date();
  const values = SYSTEM_SETTING_DEFINITIONS.flatMap((definition) => {
    if (!options?.overwrite && storedKeys.has(definition.key)) return [];

    const value = getProcessSettingValue(definition);
    if (value === undefined || value === "") return [];

    return [
      {
        key: definition.key,
        value,
        isSecret: "secret" in definition && Boolean(definition.secret),
        ...(options?.updatedBy ? { updatedBy: options.updatedBy } : {}),
        updatedAt: now,
      },
    ];
  });

  if (values.length === 0) return [] as SettingKey[];

  await db
    .insert(systemSetting)
    .values(values)
    .onConflictDoUpdate({
      target: systemSetting.key,
      set: {
        value: sql`excluded.value`,
        isSecret: sql`excluded.is_secret`,
        updatedBy: sql`excluded.updated_by`,
        updatedAt: now,
      },
    });

  clearSystemSettingsCache();

  for (const { key, value } of values) {
    syncProcessEnvSetting(key, value);
  }

  return values.map((value) => value.key);
}

export async function initializeMissingSystemSettingsDefaults(options?: {
  updatedBy?: string;
}) {
  const now = new Date();
  await migrateLegacyModerationSettings(now, options?.updatedBy);
  await migrateLegacySub2ApiAutoSyncSettings(now, options?.updatedBy);

  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
    })
    .from(systemSetting);

  const storedKeys = new Set(
    rows
      .filter((row) => normalizeStoredValue(row.value) !== undefined)
      .map((row) => row.key)
  );
  const values = SYSTEM_SETTING_DEFINITIONS.flatMap((definition) => {
    if (storedKeys.has(definition.key)) return [];

    const value = getDefaultSettingValue(definition);
    if (value === undefined || value === "") return [];

    return [
      {
        key: definition.key,
        value,
        isSecret: false,
        ...(options?.updatedBy ? { updatedBy: options.updatedBy } : {}),
        updatedAt: now,
      },
    ];
  });

  if (values.length === 0) return [] as SettingKey[];

  await db.insert(systemSetting).values(values).onConflictDoNothing({
    target: systemSetting.key,
  });

  clearSystemSettingsCache();
  return values.map((value) => value.key);
}

async function migrateLegacyModerationSettings(now: Date, updatedBy?: string) {
  const legacyKeys = [
    "ALIYUN_MODERATION_PUBLIC_BASE_URL",
    "ALIYUN_MODERATION_BLOCK_RISK_LEVEL",
  ];
  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
    })
    .from(systemSetting)
    .where(
      inArray(systemSetting.key, [
        "CONTENT_MODERATION_PUBLIC_BASE_URL",
        ...legacyKeys,
      ])
    );

  const stored = new Map(
    rows
      .map((row) => [row.key, normalizeStoredValue(row.value)] as const)
      .filter(([, value]) => value !== undefined)
  );
  const legacyPublicBaseUrl = stored.get("ALIYUN_MODERATION_PUBLIC_BASE_URL");
  const hasPublicBaseUrl = stored.has("CONTENT_MODERATION_PUBLIC_BASE_URL");

  await db.transaction(async (tx) => {
    if (!hasPublicBaseUrl && legacyPublicBaseUrl !== undefined) {
      await tx
        .insert(systemSetting)
        .values({
          key: "CONTENT_MODERATION_PUBLIC_BASE_URL",
          value: legacyPublicBaseUrl,
          isSecret: false,
          ...(updatedBy ? { updatedBy } : {}),
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: systemSetting.key,
        });
    }

    await tx
      .delete(systemSetting)
      .where(inArray(systemSetting.key, legacyKeys));
  });

  clearSystemSettingsCache();
}

async function migrateLegacySub2ApiAutoSyncSettings(
  now: Date,
  updatedBy?: string
) {
  const legacyKeys = [
    "SUB2API_AUTO_SYNC_ENABLED",
    "SUB2API_AUTO_SYNC_INTERVAL_MINUTES",
    "SUB2API_AUTO_SYNC_SOURCE_GROUP_ID",
    "SUB2API_AUTO_SYNC_MODE",
    "SUB2API_AUTO_SYNC_ALLOW_MOBILE_RT",
    "SUB2API_AUTO_SYNC_PLAN_FILTER",
  ];
  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
    })
    .from(systemSetting)
    .where(
      inArray(systemSetting.key, ["SUB2API_AUTO_SYNC_TASKS", ...legacyKeys])
    );

  const stored = new Map(
    rows
      .map((row) => [row.key, normalizeStoredValue(row.value)] as const)
      .filter(([, value]) => value !== undefined)
  );
  const hasTasks = stored.has("SUB2API_AUTO_SYNC_TASKS");
  const hasLegacyConfig = legacyKeys.some((key) => stored.has(key));

  await db.transaction(async (tx) => {
    if (!hasTasks && hasLegacyConfig) {
      const enabled = parseBooleanLike(
        stored.get("SUB2API_AUTO_SYNC_ENABLED"),
        true
      );
      const allowMobileRtImport = parseBooleanLike(
        stored.get("SUB2API_AUTO_SYNC_ALLOW_MOBILE_RT"),
        false
      );
      const syncMode = allowMobileRtImport
        ? parseSyncMode(stored.get("SUB2API_AUTO_SYNC_MODE"))
        : "responses";
      const sourceGroupId = parseOptionalString(
        stored.get("SUB2API_AUTO_SYNC_SOURCE_GROUP_ID")
      );
      const planFilter = parseSub2ApiPlanFilter(
        stored.get("SUB2API_AUTO_SYNC_PLAN_FILTER")
      );
      const intervalMinutes = parsePositiveInteger(
        stored.get("SUB2API_AUTO_SYNC_INTERVAL_MINUTES"),
        720
      );
      const taskKey = [
        sourceGroupId || "all",
        allowMobileRtImport ? syncMode : "responses",
        allowMobileRtImport ? "mobile-allowed" : "codex-only",
        planFilter,
      ].join("|");
      await tx
        .insert(systemSetting)
        .values({
          key: "SUB2API_AUTO_SYNC_TASKS",
          value: [
            {
              id: `sub2api-${createHash("sha256").update(taskKey).digest("hex").slice(0, 16)}`,
              enabled,
              sourceGroupId,
              sourceGroupName: null,
              webGroupId: null,
              responsesGroupId: null,
              syncMode,
              allowMobileRtImport,
              contentSafetyEnabled: true,
              overwriteLocalUnavailableState: true,
              planFilter,
              intervalMinutes,
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
            },
          ],
          isSecret: false,
          ...(updatedBy ? { updatedBy } : {}),
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: systemSetting.key,
        });
    }

    await tx
      .delete(systemSetting)
      .where(inArray(systemSetting.key, legacyKeys));
  });

  clearSystemSettingsCache();
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseBooleanLike(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string" && value.trim()) {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return fallback;
}

function parsePositiveInteger(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function parseSyncMode(value: unknown) {
  return value === "web" || value === "both" ? value : "responses";
}

function parseSub2ApiPlanFilter(value: unknown) {
  return value === "all" ||
    value === "free" ||
    value === "plus" ||
    value === "pro" ||
    value === "non_free"
    ? value
    : "non_free";
}

export async function importMissingSystemSettingsFromEnv(updatedBy?: string) {
  return importSystemSettingsFromEnv(
    updatedBy === undefined ? undefined : { updatedBy }
  );
}

export async function setSystemSettings(
  entries: Array<{
    key: string;
    value: unknown;
    clear?: boolean;
  }>,
  updatedBy: string
) {
  const now = new Date();
  const changedKeys: SettingKey[] = [];
  const processEnvUpdates: Array<{ key: SettingKey; value: unknown }> = [];

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      if (!isSettingKey(entry.key)) {
        throw new Error(`未知配置项: ${entry.key}`);
      }

      const definition = SETTING_DEFINITION_BY_KEY.get(entry.key);
      if (!definition) {
        throw new Error(`未知配置项: ${entry.key}`);
      }

      if (entry.clear) {
        await tx.delete(systemSetting).where(eq(systemSetting.key, entry.key));
        changedKeys.push(entry.key);
        processEnvUpdates.push({ key: entry.key, value: undefined });
        continue;
      }

      if (
        definition.secret &&
        typeof entry.value === "string" &&
        !entry.value.trim()
      ) {
        continue;
      }

      const value = coerceValue(definition, entry.value);
      if (value === "") {
        await tx.delete(systemSetting).where(eq(systemSetting.key, entry.key));
        processEnvUpdates.push({ key: entry.key, value: undefined });
      } else {
        await tx
          .insert(systemSetting)
          .values({
            key: entry.key,
            value,
            isSecret: Boolean(definition.secret),
            updatedBy,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: systemSetting.key,
            set: {
              value,
              isSecret: Boolean(definition.secret),
              updatedBy,
              updatedAt: now,
            },
          });
        processEnvUpdates.push({ key: entry.key, value });
      }
      changedKeys.push(entry.key);
    }
  });

  clearSystemSettingsCache();

  // 同步进 process.env:邮件、鉴权等同步读取器只看 process.env，后台保存后若只写
  // DB/.env 文件，当前进程会继续使用旧配置，直到重启容器才生效。
  for (const update of processEnvUpdates) {
    syncProcessEnvSetting(update.key, update.value);
  }

  return changedKeys;
}

export async function getAdminSystemSettingsSnapshot() {
  const keys = SYSTEM_SETTING_DEFINITIONS.map((definition) => definition.key);
  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
      isSecret: systemSetting.isSecret,
      updatedAt: systemSetting.updatedAt,
    })
    .from(systemSetting)
    .where(inArray(systemSetting.key, keys));

  const stored = new Map(rows.map((row) => [row.key, row]));

  return SYSTEM_SETTING_DEFINITIONS.map((definition) => {
    const row = stored.get(definition.key);
    const envValue = process.env[definition.key];
    const hasStoredValue =
      row?.value !== undefined &&
      row.value !== null &&
      (typeof row.value !== "string" || row.value.trim().length > 0);
    const hasEnvValue =
      typeof envValue === "string" && envValue.trim().length > 0;
    const isSecret = "secret" in definition && Boolean(definition.secret);
    const displayValue = isSecret
      ? ""
      : hasStoredValue
        ? typeof row.value === "object"
          ? JSON.stringify(row.value, null, 2)
          : String(row.value)
        : hasEnvValue
          ? envValue.trim()
          : "";

    return {
      ...definition,
      value: displayValue,
      configured: hasStoredValue || hasEnvValue,
      stored: hasStoredValue,
      fromEnv: !hasStoredValue && hasEnvValue,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  });
}
