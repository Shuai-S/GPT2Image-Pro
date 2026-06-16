import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, account, user } from "@repo/database";
import { adminUser, adminAccount } from "@repo/database/schema";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { normalizeUserRole } from "./roles";
import {
  isSelfUseModeEnabled,
  LOCAL_SUPER_ADMIN_EMAIL,
} from "./self-use-mode";

let bootstrapped = false;
let adminBootstrapped = false;

function generatePassword() {
  return randomBytes(24).toString("base64url");
}

function credentialsPath() {
  return (
    process.env.GPT2IMAGE_BOOTSTRAP_CREDENTIALS_PATH?.trim() ||
    path.join(process.cwd(), ".gpt2image", "super-admin-credentials.txt")
  );
}

async function persistInitialCredentials(input: {
  email: string;
  password: string;
  userId: string;
}) {
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
    console.warn(
      `[GPT2IMAGE] Self-use super admin initialized. Email: ${input.email}. Password written to credentials file: ${filePath}`
    );
  } catch (error) {
    console.warn(
      `[GPT2IMAGE] Self-use super admin initialized. Email: ${input.email}. Failed to write credentials file (${
        error instanceof Error ? error.message : String(error)
      }); re-run after fixing file permissions to capture the generated password.`
    );
  }
}

async function findLocalAdmin() {
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

async function hasCredentialAccount(userId: string) {
  const [record] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .limit(1);

  return Boolean(record);
}

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

export async function bootstrapSelfUseSuperAdmin() {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    if (!(await isSelfUseModeEnabled())) return;

    const [existingSuperAdmin] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, "super_admin"))
      .limit(1);

    if (existingSuperAdmin) return;

    const existingLocalAdmin = await findLocalAdmin();
    if (existingLocalAdmin) {
      if (normalizeUserRole(existingLocalAdmin.role) !== "super_admin") {
        await db
          .update(user)
          .set({
            role: "super_admin",
            emailVerified: true,
            updatedAt: new Date(),
          })
          .where(eq(user.id, existingLocalAdmin.id));
      }

      if (!(await hasCredentialAccount(existingLocalAdmin.id))) {
        const password = generatePassword();
        await createCredentialAccount(existingLocalAdmin.id, password);
        await persistInitialCredentials({
          email: LOCAL_SUPER_ADMIN_EMAIL,
          password,
          userId: existingLocalAdmin.id,
        });
      }
      return;
    }

    const userId = randomUUID();
    const password = generatePassword();
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
    await persistInitialCredentials({
      email: LOCAL_SUPER_ADMIN_EMAIL,
      password,
      userId,
    });
  } catch (error) {
    console.warn(
      `[GPT2IMAGE] Self-use super admin bootstrap skipped: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * 从凭据文件解析 email 和 password 字段。
 *
 * 凭据文件格式为简单的 key=value 行（由 persistInitialCredentials 写入），
 * 本函数逐行扫描提取 email 和 password。解析失败或字段缺失返回 null。
 */
function parseCredentialsFile(
  content: string
): { email: string; password: string } | null {
  let email: string | undefined;
  let password: string | undefined;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("email=")) {
      email = trimmed.slice("email=".length);
    } else if (trimmed.startsWith("password=")) {
      password = trimmed.slice("password=".length);
    }
  }
  if (!email || !password) {
    return null;
  }
  return { email, password };
}

/**
 * 管理员侧初始账户引导（admin_user / admin_account 表）。
 *
 * 逻辑：
 * 1. 检查 admin_user 表是否已有任何行，有则跳过（仅首次空库执行）。
 * 2. 读取 GPT2IMAGE_BOOTSTRAP_CREDENTIALS_PATH 指向的凭据文件，
 *    若未设置则回退到默认路径。解析出 email + password。
 * 3. 直接 insert admin_user + admin_account（credential），
 *    与用户侧 bootstrapSelfUseSuperAdmin 共用同一份凭据，
 *    使首位用户同时拥有平台 super_admin 和管理端 admin 身份。
 *
 * 设计约束：
 * - admin_auth 的 disableSignUp=true，管理员只能通过 DB 或本引导创建。
 * - 密码哈希使用 better-auth/crypto 的 hashPassword，与用户侧一致。
 * - 幂等：admin_user 表非空即短路返回；email 唯一约束兜底。
 */
export async function bootstrapAdminUser() {
  if (adminBootstrapped) return;
  adminBootstrapped = true;

  try {
    // 凭据文件路径：优先 env 变量，回退到默认路径
    const filePath = credentialsPath();

    // 1. admin_user 表已有行则跳过
    const [existing] = await db
      .select({ id: adminUser.id })
      .from(adminUser)
      .limit(1);

    if (existing) return;

    // 2. 读取并解析凭据文件
    let fileContent: string;
    try {
      fileContent = await readFile(filePath, { encoding: "utf8" });
    } catch {
      // 凭据文件不存在或不可读，跳过引导
      // （可能 bootstrapSelfUseSuperAdmin 尚未运行或写入失败）
      console.warn(
        "[GPT2IMAGE] Admin user bootstrap skipped: " +
          `credentials file not readable at ${filePath}`
      );
      return;
    }

    const creds = parseCredentialsFile(fileContent);
    if (!creds) {
      console.warn(
        "[GPT2IMAGE] Admin user bootstrap skipped: " +
          "credentials file missing email or password fields"
      );
      return;
    }

    // 3. 创建 admin_user + admin_account
    const userId = randomUUID();
    const now = new Date();

    await db.insert(adminUser).values({
      id: userId,
      name: "GPT2IMAGE Admin",
      email: creds.email,
      emailVerified: true,
      role: "admin",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(adminAccount).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: await hashPassword(creds.password),
      createdAt: now,
      updatedAt: now,
    });

    console.warn(
      `[GPT2IMAGE] Admin user bootstrapped from credentials file.` +
        ` Email: ${creds.email}`
    );
  } catch (error) {
    console.warn(
      `[GPT2IMAGE] Admin user bootstrap skipped: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
