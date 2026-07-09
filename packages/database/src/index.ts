import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeonWs } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * 数据库连接配置
 *
 * 支持两种模式:
 * 1. Neon Serverless WebSocket (生产/测试环境) - 支持事务，兼容 Node.js 和 Edge Runtime
 * 2. 标准 PostgreSQL (本地开发/Docker) - 使用连接池
 *
 * 注意: Neon 始终使用 WebSocket 模式以支持事务
 * - Node.js 环境: 需要 ws 包提供 WebSocket
 * - Edge Runtime (CF Workers/Vercel Edge): 使用原生 WebSocket API
 */

// 确保环境变量存在
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL 环境变量未设置，请在 .env 文件中配置数据库连接"
  );
}

const databaseUrl = process.env.DATABASE_URL;

/**
 * 检测是否使用 Neon Serverless
 */
const isNeon = databaseUrl.includes("neon.tech");

/**
 * 检测是否在 Node.js 环境
 * Edge Runtime (CF Workers, Vercel Edge) 没有 process.versions.node
 */
const isNodeJs = typeof process !== "undefined" && process.versions?.node;

/**
 * 数据库连接池参数（显式调参）
 *
 * 历史上 new Pool / new NeonPool 均未设 max、connectionTimeoutMillis、
 * idleTimeoutMillis 等，全部走 pg 默认值（max=10、idle 无显式上限、connection
 * 无超时），在高并发或网络抖动时容易出现连接泄漏与请求挂死。此处改为显式设值：
 * - max: 连接池最大连接数。默认 20，兼顾本地开发与中小规模生产负载；可通过
 *   DB_POOL_MAX 在不同部署环境按需放大。
 * - connectionTimeoutMillis: 建连超时。默认 10s，避免 DNS/认证挂起阻塞请求；
 *   建连阶段失败应快速抛错交给上层重试，而非永久挂起。
 * - idleTimeoutMillis: 空闲连接回收。默认 30s，及时释放闲置连接，避免长连接
 *   占用数据库 side（Postgres 默认 max_connections 较小，长空闲会挤占配额）。
 * Neon WebSocket Pool 同样支持这些参数；Edge Runtime 不使用 Node 连接池，但
 * 显式传参对行为无副作用且可读性更好。
 */
function poolSize(): number {
  const raw = process.env.DB_POOL_MAX;
  if (!raw) return 20;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return parsed;
}

function numberEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

const POOL_MAX = poolSize();
const CONNECTION_TIMEOUT_MILLIS = numberEnv("DB_CONNECTION_TIMEOUT_MILLIS", 10_000);
const IDLE_TIMEOUT_MILLIS = numberEnv("DB_IDLE_TIMEOUT_MILLIS", 30_000);

/**
 * 创建数据库实例
 * - Neon: 使用 WebSocket 连接 (支持事务，兼容 Node.js 和 Edge)
 * - 标准 PG: 使用连接池 (本地开发/Docker)
 */
function createDatabaseConnection() {
  if (isNeon) {
    // Node.js 环境需要手动设置 WebSocket 构造函数
    // Edge Runtime (CF Workers, Vercel Edge) 有原生 WebSocket，无需设置
    if (isNodeJs) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ws = require("ws");
      neonConfig.webSocketConstructor = ws;
    }

    // 使用 WebSocket 连接池，支持事务
    const pool = new NeonPool({
      connectionString: databaseUrl,
      max: POOL_MAX,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
      idleTimeoutMillis: IDLE_TIMEOUT_MILLIS,
    });
    return drizzleNeonWs(pool, { schema });
  }

  // 标准 PostgreSQL 连接池 (本地开发/Docker)
  const pool = new Pool({
    connectionString: databaseUrl,
    max: POOL_MAX,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
    idleTimeoutMillis: IDLE_TIMEOUT_MILLIS,
  });
  return drizzlePg(pool, { schema });
}

// 导出数据库实例
export const db = createDatabaseConnection();

// 导出 Schema 以便在其他地方使用
export * from "./schema";
