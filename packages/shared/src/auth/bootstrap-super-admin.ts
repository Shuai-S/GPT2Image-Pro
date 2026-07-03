/**
 * 文件职责：自用模式启动期引导本地超级管理员账号与初始凭据文件。
 * 使用方：apps/web/src/instrumentation.ts 启动钩子与 UOL 内部 system operation。
 * 关键依赖：数据库 user/account 表、Better Auth 密码哈希、本地私有凭据文件。
 */
import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { account, db, user } from "@repo/database";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { normalizeUserRole } from "./roles";
import {
  isSelfUseModeEnabled,
  LOCAL_SUPER_ADMIN_EMAIL,
} from "./self-use-mode";

let bootstrapped = false;

type LocalAdminRecord = {
  id: string;
  email: string | null;
  role: string | null;
};

type InitialCredentials = {
  email: string;
  password: string;
  userId: string;
};

/**
 * 生成启动期本地超管随机密码。
 *
 * @returns base64url 编码的高熵密码。
 * @sideEffects 使用系统随机源。
 * @throws 当系统随机源不可用时抛出。
 */
function generatePassword() {
  return randomBytes(24).toString("base64url");
}

/**
 * 解析初始凭据文件路径。
 *
 * @returns 容器或本地进程内的凭据文件绝对/相对路径。
 * @sideEffects 读取 process.env。
 * @throws 不抛出。
 */
function credentialsPath() {
  return (
    process.env.GPT2IMAGE_BOOTSTRAP_CREDENTIALS_PATH?.trim() ||
    path.join(process.cwd(), ".gpt2image", "super-admin-credentials.txt")
  );
}

/**
 * 标准化未知异常，避免日志打印对象结构或敏感字段。
 *
 * @param error - 捕获到的未知异常。
 * @returns 可用于日志的短错误消息。
 * @sideEffects 无。
 * @throws 不抛出。
 */
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 判断 Node.js 文件系统异常码。
 *
 * @param error - 捕获到的未知异常。
 * @param code - 期望的 Node.js errno code。
 * @returns 异常是否携带目标 code。
 * @sideEffects 无。
 * @throws 不抛出。
 */
function isNodeErrorCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * 判断布尔环境变量是否显式启用。
 *
 * @param name - 环境变量名。
 * @returns true 表示值为 1/true/yes/on。
 * @sideEffects 读取 process.env。
 * @throws 不抛出。
 */
function isBooleanEnvEnabled(name: string) {
  const value = process.env[name]?.trim().toLowerCase();
  return (
    value === "1" || value === "true" || value === "yes" || value === "on"
  );
}

/**
 * 判断凭据文件是否已经存在。
 *
 * @returns true 表示目标路径存在，false 表示不存在。
 * @sideEffects 读取文件系统元数据。
 * @throws 除 ENOENT 外的文件系统错误会继续抛出，避免隐藏权限问题。
 */
async function credentialsFileExists() {
  try {
    await access(credentialsPath(), constants.F_OK);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

/**
 * 判断是否执行一次性本地超管密码恢复。
 *
 * @returns true 表示用户显式请求恢复且凭据文件当前不存在。
 * @sideEffects 读取环境变量和文件系统元数据。
 * @throws 文件系统权限异常会抛出，避免在不可验证状态下轮换密码。
 */
async function shouldResetLocalAdminPassword() {
  if (!isBooleanEnvEnabled("GPT2IMAGE_BOOTSTRAP_RESET_LOCAL_ADMIN_PASSWORD")) {
    return false;
  }

  // 只在凭据文件缺失时重置，防止环境变量遗留导致每次重启都轮换密码。
  return !(await credentialsFileExists());
}

/**
 * 写入初始凭据文件。
 *
 * @param input - 要落盘的本地超管邮箱、明文初始密码和用户 ID。
 * @returns 实际写入的凭据文件路径。
 * @sideEffects 创建目录并写入 0600 权限文件。
 * @throws 当目录或文件不可写时抛出，调用方必须阻止密码入库。
 */
async function writeInitialCredentialsFile(input: InitialCredentials) {
  const filePath = credentialsPath();
  const body = [
    "GPT2IMAGE self-use super admin credentials",
    "",
    `createdAt=${new Date().toISOString()}`,
    `email=${input.email}`,
    `password=${input.password}`,
    `userId=${input.userId}`,
    "",
    "Keep this file private. Delete it after saving the password elsewhere.",
    "",
  ].join("\n");

  try {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, body, { encoding: "utf8", mode: 0o600 });
    await chmod(filePath, 0o600);
    return filePath;
  } catch (error) {
    throw new Error(
      `failed to write bootstrap credentials file ${filePath}: ${errorMessage(
        error
      )}`
    );
  }
}

/**
 * 删除数据库变更失败后遗留的凭据文件。
 *
 * @param filePath - 刚写出的凭据文件路径。
 * @returns 无返回值。
 * @sideEffects 删除文件；删除失败时写入告警日志。
 * @throws 不抛出，避免覆盖原始数据库异常。
 */
async function removeStaleCredentialsFile(filePath: string) {
  try {
    await rm(filePath, { force: true });
  } catch (error) {
    console.warn(
      `[GPT2IMAGE] Failed to remove stale bootstrap credentials file ${filePath}: ${errorMessage(
        error
      )}`
    );
  }
}

/**
 * 先写凭据文件，再执行账号密码数据库变更。
 *
 * @param input - 将要写入文件的本地超管凭据。
 * @param mutateAccount - 创建或更新密码账号的数据库操作。
 * @returns 无返回值。
 * @sideEffects 写入凭据文件并修改数据库；数据库失败时删除刚写出的文件。
 * @throws 文件写入或数据库变更失败时抛出。
 */
async function persistCredentialsBeforeAccountMutation(
  input: InitialCredentials,
  mutateAccount: () => Promise<void>
) {
  const filePath = await writeInitialCredentialsFile(input);

  try {
    await mutateAccount();
  } catch (error) {
    await removeStaleCredentialsFile(filePath);
    throw error;
  }

  console.warn(
    `[GPT2IMAGE] Self-use super admin initialized. Email: ${input.email}. Password written to credentials file: ${filePath}`
  );
}

/**
 * 查询硬编码本地超管邮箱对应的用户。
 *
 * @returns 找到时返回用户基础信息，否则返回 undefined。
 * @sideEffects 读取数据库。
 * @throws 数据库查询失败时抛出。
 */
async function findLocalAdmin(): Promise<LocalAdminRecord | undefined> {
  const [record] = await db
    .select({
      id: user.id,
      email: user.email,
      role: user.role,
    })
    .from(user)
    .where(eq(user.email, LOCAL_SUPER_ADMIN_EMAIL))
    .limit(1);

  return record;
}

/**
 * 判断用户是否已有 Better Auth credential 账号。
 *
 * @param userId - 目标用户 ID。
 * @returns true 表示已有密码账号。
 * @sideEffects 读取数据库。
 * @throws 数据库查询失败时抛出。
 */
async function hasCredentialAccount(userId: string) {
  const [record] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, "credential"))
    )
    .limit(1);

  return Boolean(record);
}

/**
 * 创建 Better Auth credential 账号。
 *
 * @param userId - 要绑定的用户 ID。
 * @param password - 明文初始密码，仅用于生成哈希，不会落库。
 * @returns 无返回值。
 * @sideEffects 写入 account 表。
 * @throws 哈希或数据库写入失败时抛出。
 */
async function createCredentialAccount(userId: string, password: string) {
  await db.insert(account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(password),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * 更新 Better Auth credential 账号密码。
 *
 * @param userId - 要重置密码的本地超管用户 ID。
 * @param password - 新明文密码，仅用于生成哈希，不会落库。
 * @returns 无返回值。
 * @sideEffects 更新 account 表。
 * @throws 哈希或数据库写入失败时抛出。
 */
async function updateCredentialAccountPassword(
  userId: string,
  password: string
) {
  await db
    .update(account)
    .set({
      password: await hashPassword(password),
      updatedAt: new Date(),
    })
    .where(
      and(eq(account.userId, userId), eq(account.providerId, "credential"))
    );
}

/**
 * 将本地超管邮箱用户提升为 super_admin。
 *
 * @param userId - 要提升的用户 ID。
 * @returns 无返回值。
 * @sideEffects 更新 user 表 role/emailVerified/updatedAt。
 * @throws 数据库写入失败时抛出。
 */
async function promoteLocalSuperAdmin(userId: string) {
  await db
    .update(user)
    .set({
      role: "super_admin",
      emailVerified: true,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId));
}

/**
 * 补齐或恢复已存在的本地超管账号。
 *
 * @param record - 本地超管邮箱对应的现有用户。
 * @returns 无返回值。
 * @sideEffects 可能提升角色、创建密码账号或按显式环境变量重置密码。
 * @throws 文件系统或数据库操作失败时抛出。
 */
async function ensureLocalSuperAdmin(record: LocalAdminRecord) {
  const needsRolePromotion = normalizeUserRole(record.role) !== "super_admin";
  const hasCredential = await hasCredentialAccount(record.id);

  if (!hasCredential) {
    const password = generatePassword();
    await persistCredentialsBeforeAccountMutation(
      {
        email: LOCAL_SUPER_ADMIN_EMAIL,
        password,
        userId: record.id,
      },
      async () => {
        if (needsRolePromotion) {
          await promoteLocalSuperAdmin(record.id);
        }
        await createCredentialAccount(record.id, password);
      }
    );
    return;
  }

  if (await shouldResetLocalAdminPassword()) {
    const password = generatePassword();
    await persistCredentialsBeforeAccountMutation(
      {
        email: LOCAL_SUPER_ADMIN_EMAIL,
        password,
        userId: record.id,
      },
      async () => {
        if (needsRolePromotion) {
          await promoteLocalSuperAdmin(record.id);
        }
        await updateCredentialAccountPassword(record.id, password);
      }
    );
    return;
  }

  if (needsRolePromotion) {
    await promoteLocalSuperAdmin(record.id);
  }
}

/**
 * 创建全新的本地超管账号并写出初始凭据。
 *
 * @returns 无返回值。
 * @sideEffects 写凭据文件，写入 user/account 表。
 * @throws 文件系统或数据库操作失败时抛出。
 */
async function createLocalSuperAdmin() {
  const userId = randomUUID();
  const password = generatePassword();

  await persistCredentialsBeforeAccountMutation(
    {
      email: LOCAL_SUPER_ADMIN_EMAIL,
      password,
      userId,
    },
    async () => {
      await db.insert(user).values({
        id: userId,
        name: "GPT2IMAGE Super Admin",
        email: LOCAL_SUPER_ADMIN_EMAIL,
        emailVerified: true,
        role: "super_admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await createCredentialAccount(userId, password);
    }
  );
}

/**
 * 在自用模式启动时引导本地超级管理员。
 *
 * @returns 无返回值。
 * @sideEffects 读取系统设置、读写数据库、必要时写入初始凭据文件。
 * @throws 不向外抛出；启动期失败会写告警并让应用继续启动。
 */
export async function bootstrapSelfUseSuperAdmin() {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    if (!(await isSelfUseModeEnabled())) return;

    const existingLocalAdmin = await findLocalAdmin();
    if (existingLocalAdmin) {
      await ensureLocalSuperAdmin(existingLocalAdmin);
      return;
    }

    const [existingSuperAdmin] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, "super_admin"))
      .limit(1);

    if (existingSuperAdmin) return;

    await createLocalSuperAdmin();
  } catch (error) {
    console.warn(
      `[GPT2IMAGE] Self-use super admin bootstrap skipped: ${errorMessage(
        error
      )}`
    );
  }
}
