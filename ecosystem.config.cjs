/**
 * PM2 多进程配置
 *
 * 单容器内启动 4 个 Next.js 独立进程，分别绑定不同端口。
 * Nginx 按 Host header 反代到对应端口。
 *
 * 各 app 的 standalone 产物由 Dockerfile.multi 构建阶段产出，
 * COPY 后目录结构为 /app/apps/<name>/.next/standalone/apps/<name>/server.js。
 * 因为 Next.js standalone 会把 monorepo 根的 node_modules 拷到 standalone 根，
 * 而多 app 的 standalone 产物合并后共用同一份根 node_modules，
 * 所以 server.js 的路径为 apps/<name>/server.js（相对于 /app 工作目录）。
 */
module.exports = {
  apps: [
    {
      name: "web",
      script: "apps/web/server.js",
      // 主应用内存上限，超出后 PM2 自动重启进程
      max_memory_restart: "1G",
      env: {
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
      },
    },
    {
      name: "admin",
      script: "apps/admin/server.js",
      // 管理后台流量较低，内存上限适当收紧
      max_memory_restart: "512M",
      env: {
        PORT: 3001,
        HOSTNAME: "0.0.0.0",
      },
    },
    {
      name: "api",
      script: "apps/api/server.js",
      // API 服务需处理图像生成请求，内存上限与主应用一致
      max_memory_restart: "1G",
      env: {
        PORT: 3002,
        HOSTNAME: "0.0.0.0",
      },
    },
    {
      name: "platform",
      script: "apps/platform/server.js",
      // 营销/文档站为纯静态内容，内存占用最低
      max_memory_restart: "256M",
      env: {
        PORT: 3003,
        HOSTNAME: "0.0.0.0",
      },
    },
  ],
};
