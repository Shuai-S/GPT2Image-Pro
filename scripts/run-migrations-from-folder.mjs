/**
 * 从指定目录执行 Drizzle PostgreSQL 迁移。
 *
 * 使用方：CI 的“上一正式 tag 增量升级”准备阶段。脚本让当前锁定的 Drizzle
 * 运行时读取 `git archive` 解出的旧版 migration folder，避免安装和执行旧版本
 * 的依赖脚本。当前版本迁移仍走生产同款 `db:migrate` 命令。
 */

import { createRequire } from "node:module";

// pnpm 严格依赖布局不会把 workspace 依赖提升到根 node_modules；从 database
// package 建立 require，保证脚本只使用该包声明并锁定的运行时。
const requireFromDatabase = createRequire(
  new URL("../packages/database/package.json", import.meta.url)
);
const { drizzle } = requireFromDatabase("drizzle-orm/node-postgres");
const { migrate } = requireFromDatabase("drizzle-orm/node-postgres/migrator");
const pg = requireFromDatabase("pg");

const [migrationsFolder] = process.argv.slice(2);
if (!migrationsFolder) {
  throw new Error("用法: node scripts/run-migrations-from-folder.mjs <目录>");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL 环境变量未设置");
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
});

try {
  await migrate(drizzle(pool), { migrationsFolder });
} finally {
  await pool.end();
}
