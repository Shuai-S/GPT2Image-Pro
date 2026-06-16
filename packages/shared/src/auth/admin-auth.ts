import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@repo/database";
import * as schema from "@repo/database/schema";

// 运行时检查：管理员认证密钥必须独立配置，不得与用户侧共享
if (!process.env.ADMIN_BETTER_AUTH_SECRET) {
  console.warn(
    "[admin-auth] ADMIN_BETTER_AUTH_SECRET 未设置。" +
      "管理员认证将无法正常工作。" +
      "此密钥必须独立于 BETTER_AUTH_SECRET 单独配置。"
  );
}

/**
 * 管理员独立 Better Auth 实例
 *
 * 与用户认证完全隔离：使用独立的 admin_user/admin_session/admin_account/admin_verification 表。
 * Cookie 前缀为 "admin"（cookie 名为 "admin.session_token"），防止与用户侧 cookie 冲突。
 * 仅支持邮箱/密码登录，不开放社交登录。
 *
 * 关键设计：
 * - drizzle adapter 的 schema 映射：key 仍为 Better Auth 内部模型名 (user/session/account/verification)，
 *   value 为实际的 admin_* drizzle table 对象。adapter 内部通过 key 查找对应 table 对象，
 *   然后直接传给 drizzle-orm 的 insert/select/update/delete，drizzle 从 pgTable() 声明解析实际 SQL 表名。
 * - 独立 secret (ADMIN_BETTER_AUTH_SECRET)，必须单独配置，不回退到共享密钥。
 * - 独立 baseURL (ADMIN_AUTH_URL)，默认 http://localhost:3001。
 */
export const adminAuth = betterAuth({
  /**
   * 基础 URL 配置
   * 管理员独立入口，与用户侧 BETTER_AUTH_URL 隔离
   */
  baseURL:
    process.env.ADMIN_AUTH_URL || "http://localhost:3001",

  /**
   * 独立密钥
   * 必须单独设置 ADMIN_BETTER_AUTH_SECRET，不得与用户侧共享密钥
   */
  secret: process.env.ADMIN_BETTER_AUTH_SECRET,

  /**
   * 数据库配置
   * 使用 drizzle adapter，schema 映射到 admin_* 表
   */
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.adminUser,
      session: schema.adminSession,
      account: schema.adminAccount,
      verification: schema.adminVerification,
    },
  }),

  /**
   * 仅支持邮箱/密码登录
   * 管理员不开放社交登录，降低攻击面
   *
   * 安全策略：
   * - disableSignUp: 禁止通过 API 注册管理员账户，管理员只能通过数据库或种子脚本创建
   * - rateLimit: 限制每 IP 每 60 秒最多 5 次登录尝试，防止暴力破解
   */
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    rateLimit: {
      window: 60,
      max: 5,
    },
  },

  /**
   * 会话配置
   *
   * 安全策略：
   * - expiresIn 24h: 管理员会话缩短至 24 小时，降低令牌泄露后的风险窗口
   * - updateAge 4h: 每 4 小时强制刷新会话，及时同步权限变更
   * - cookieCache 禁用: 确保每次请求都查询数据库验证会话有效性，
   *   防止已撤销的会话因缓存继续生效
   */
  session: {
    expiresIn: 24 * 60 * 60,
    updateAge: 4 * 60 * 60,
    cookieCache: {
      enabled: false,
    },
  },

  /**
   * 高级配置
   */
  advanced: {
    // cookie 前缀为 "admin"，cookie 名变为 "admin.session_token"
    // 与用户侧 "better-auth.session_token" 完全隔离
    cookiePrefix: "admin",
  },
});

/**
 * 导出类型以供其他模块使用
 */
export type AdminAuth = typeof adminAuth;
