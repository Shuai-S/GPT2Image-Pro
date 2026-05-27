# GPT2Image-Pro

GPT2Image-Pro 是一个面向生图业务的 SaaS 平台。仓库采用 pnpm workspace monorepo，主应用位于 `apps/web`，共享能力位于 `packages/*`。

README 只保留项目入口和最小运行信息。接口字段、后端调度、计费、Agent、队列、Sub2API、部署细节等以站内系统文档为准：

- 公开系统文档：`/docs/system`
- 登录后台文档：`/dashboard/backend-help`
- 线上部署 Runbook：[docs/deploy-superapi.md](docs/deploy-superapi.md)

## 核心能力

- 文生图、图生图/编辑、逐行批量、历史瀑布流、对话生图和 Codex 风格 Agent 自动迭代。
- OpenAI 兼容外接接口：`/v1/images/generations`、`/v1/images/edits`、`/v1/responses`、`/v1/agents/images`、`/v1/models`、`/v1/credits`。
- 后端池支持 Web 账号、Codex/Responses 账号和 OpenAI 兼容外接 API，包含分组、优先级、权重、并发、冷却、错误标记和分组倍率。
- 套餐能力矩阵可配置功能权限、上传限制、批量数量、并发、月积分、审核策略、Chat/Agent 轮次计费和外接 API 权限。
- 支持订阅、按量积分包、API Key 独立额度、积分流水、工单、公告、状态监控、SLA 和三级管理员。
- 支持 Sub2API PostgreSQL 同步、RT/AT 导入、Go ChatGPT Web TLS sidecar、cron 任务和可配置静态资源版本前缀。

## 技术栈

| 分类 | 技术 |
| --- | --- |
| Monorepo | pnpm workspace, Turbo |
| Web | Next.js 16, React 19, TypeScript, next-intl, Fumadocs |
| UI | Tailwind CSS 4, Radix UI, shadcn 风格组件, lucide-react |
| 数据库 | PostgreSQL, Drizzle ORM |
| 认证 | Better Auth |
| 支付 | Creem, Epay |
| 存储 | 本地存储, S3/R2/MinIO 兼容 |
| 任务 | Inngest, crontab HTTP jobs |
| 监控 | Pino, Axiom, Sentry |
| Web 代理 | Go tls-client sidecar |

## 目录结构

```text
apps/
  web/                 # 用户站、管理后台、外接 API、cron route
  admin/               # 独立管理站骨架
packages/
  shared/              # 认证、配置、积分、支付、审核、系统设置、能力矩阵
  database/            # Drizzle schema/client
  ui/                  # 基础 UI 组件
services/
  chatgpt-web-proxy/   # ChatGPT Web TLS sidecar
docs/                  # 运维文档和补充说明
storage/               # 本地存储默认目录
```

> 仓库中仍保留部分历史 `src/` 目录代码；当前主业务以 `apps/web` 和 `packages/*` 为准。

## 快速开始

```bash
git clone git@github.com:MoYeRanqianzhi/GPT2Image-Pro.git
cd GPT2Image-Pro
pnpm install
cp .env.example .env.local
mkdir -p apps/web
cp .env.local apps/web/.env.local
pnpm db:push
pnpm dev:web
```

至少需要配置：

```env
DATABASE_URL=postgresql://user:password@host:5432/gpt2image
BETTER_AUTH_SECRET=<random-secret>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

开发地址默认是 `http://localhost:3000`。

## 常用命令

```bash
pnpm dev:web                 # 启动用户站
pnpm build:web               # 构建用户站
pnpm typecheck               # workspace 类型检查
pnpm test                    # workspace 测试
pnpm --filter @repo/shared test:matrix
pnpm db:generate
pnpm db:push
pnpm db:studio
```

## 配置模型

运行时配置优先读取数据库 `system_setting`，未配置时回退到环境变量。后台“系统设置”保存后会尽量同步到常见的 `apps/web/.env.local` 路径，但数据库仍是后台配置的主来源。

首次启动会写入缺失的非密钥默认配置，例如套餐能力矩阵、套餐价格、按量积分包、审核和后端冷却默认值；已有数据库配置不会被覆盖。

## 页面入口

用户侧：

- `/dashboard/create`：文生图、图生图、Chat、Agent、瀑布流
- `/dashboard/gallery`：图库，含成品图和 Agent 草图
- `/dashboard/history`：任务历史、失败原因、积分明细
- `/dashboard/billing`：账单与用量
- `/dashboard/external-api`：本站对外 API Key 和额度
- `/dashboard/backend-help`：系统文档
- `/dashboard/support`：工单
- `/dashboard/announcements`：公告

管理员侧：

- `/dashboard/admin/users`：用户、套餐、积分、API Key 额度和角色
- `/dashboard/admin/settings`：系统设置、生图后端池、能力矩阵、Sub2API 同步
- `/dashboard/admin/status`：SLA、成功率、耗时、错误历史
- `/dashboard/admin/announcements`：公告管理

管理员角色分为 `super_admin`、`admin`、`observer_admin`。权限边界见 `/docs/system`。

## 部署

通用生产部署可以使用源码构建、PM2/systemd 或 Docker。Superapi 线上实例使用 systemd release + Nginx 静态 alias + 双端口灰度，具体命令以 [docs/deploy-superapi.md](docs/deploy-superapi.md) 为准。

关键原则：

- 生产构建前同步根目录 `.env.local` 和 `apps/web/.env.local`。
- 每次前端构建更换 `NEXT_PUBLIC_ASSET_PREFIX`，避免浏览器或 CDN 拿旧 chunk。
- 使用 Nginx 静态 alias 时，先同步 `apps/web/.next/static`，再切换公网服务。
- Go sidecar、crontab、Sub2API 同步任务的完整配置见 `/docs/system` 和部署 Runbook。

## 测试

```bash
pnpm test
pnpm --filter @repo/shared test:matrix
pnpm --filter @repo/web test -- responses-native-state
pnpm --filter @repo/shared typecheck
pnpm --filter @repo/web typecheck
```

## 仓库卫生

不要提交真实 `.env`、HAR 抓包、rollout 日志、运维记忆或 `.turbo` 输出。当前 `.gitignore` 已覆盖这些本地文件。若需要记录运维细节，优先写入 `docs/deploy-superapi.md` 这类可公开的、已脱敏文档。

## License

MIT
