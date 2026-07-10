import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

const WORKSPACE_ROOT = "../..";

// 检测测试环境 (通过命令行参数或环境变量)
const isTestEnv =
  process.argv.includes("--test") || process.env.USE_TEST_DB === "true";

// 根据环境加载对应的环境变量文件
if (isTestEnv) {
  dotenv.config({ path: `${WORKSPACE_ROOT}/.env.test` });
} else {
  // pnpm --dir 会把 cwd 切到本包，因此显式从 monorepo 根目录读取。
  dotenv.config({ path: `${WORKSPACE_ROOT}/.env.local` });
  dotenv.config({ path: `${WORKSPACE_ROOT}/.env` });
}

// 确保环境变量存在 (drizzle-kit 命令运行时检查)
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL 环境变量未设置，请在 .env 文件中配置数据库连接"
  );
}

/**
 * Drizzle Kit 配置
 * 用于管理数据库迁移和 Schema 推送
 */
export default defineConfig({
  // 数据库 Schema 文件路径
  schema: "./src/schema.ts",

  // 迁移文件输出目录
  out: "./drizzle",

  // 数据库类型: PostgreSQL
  dialect: "postgresql",

  // 数据库连接配置 (从环境变量读取)
  dbCredentials: {
    url: databaseUrl,
  },

  // 启用详细日志
  verbose: true,

  // 启用严格模式 (迁移前需确认)
  strict: true,
});
