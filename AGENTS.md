# CLAUDE.md / AGENTS.md

> **镜像文件（Mirror Files）**：`CLAUDE.md` 与 `AGENTS.md` 内容**必须逐字一致**。
> 修改其中任意一个，必须同步修改另一个（建议「先改一个、再覆盖另一个」）。
>
> 本文件是 **所有贡献者 Agent 的共享长期记忆与行为准则**。
> 请不要依赖会话上下文，而是依赖本文件与 `./docs/` 作为持久化记忆。
> 本文件为 Claude Code（claude.ai/code）及任何协作 Agent 提供在本仓库工作的权威指引。

---

## 0. 协作准则（不可削减 / MUST）

> 本章为**强制约束**，优先级高于一切默认行为。任何提交、任何代码都必须满足本章要求。
> 三条底线：所有结论、代码与建议必须 **可追溯（Traceable）**、**可验证（Verifiable）**、**可解释（Explainable）**。

### 0.1 开源团队注释原则（Comment-First）

本项目是开源协作项目，代码会被**人类贡献者与 LLM Agent 共同阅读和维护**。因此：

- **每一个文件**：顶部必须有文件级注释，说明「这个文件是什么、负责什么、被谁使用、关键依赖」。
- **每一个函数 / 方法 / 组件**：必须有注释说明 **用途、参数、返回值、副作用、边界条件与失败模式**。
- **每一段关键逻辑**：复杂分支、算法、并发、事务、幂等、金额/积分计算、安全校验等，必须有**逐行或逐块**的行内注释解释 **"为什么这样写（WHY）"**，而不仅是"做了什么（WHAT）"。
- **标准**：注释要让**第一次接触该文件的人类工程师**和**没有上下文的 LLM**都能在不阅读其他文件的情况下理解这段代码的意图。
- **语言**：注释用**简体中文**，代码标识符用**英文**（与既有约定一致）。
- **同步**：修改代码时必须同步更新注释；**过期/错误的注释视为 Bug**。
- **禁止**：禁止用注释临时屏蔽代码（`// xxx`）后遗留；删除即彻底删除，不留「墓碑注释」。

> 说明：本仓库的注释要求**显式覆盖**任何「少写注释」的默认习惯。在本项目中，详尽且准确的注释是合规的一部分。

### 0.2 Git 与版本管理（MUST）

- **持续使用 Git 进行版本管理**：**每完成一部分就 commit**，保持小步、可回溯的提交粒度。
- **提交信息**：遵循 Conventional Commits，格式 `type(scope): 简述`，正文说明 WHY。常用 type：`feat / fix / refactor / docs / test / chore / perf / build / ci`。
- **关键节点设置 tag**：在里程碑、可发布点、重大重构完成处打 tag。
- **版本格式（Semantic Versioning + 预发布标识）**：

  ```
  v<MAJOR>.<MINOR>.<PATCH>-<alpha|beta|rc>.<N>
  例：v0.2.0-alpha.1   v1.0.0-beta.3   v2.0.0-rc.1   （正式发布去掉预发布后缀：v1.0.0）
  ```

  - `alpha`：内部测试 / 功能未稳定。
  - `beta`：功能完整、对外测试、可能存在已知问题。
  - `rc`（release candidate）：候选发布版，无已知阻塞性问题。
  - `MAJOR` 破坏性变更、`MINOR` 向后兼容的新功能、`PATCH` 向后兼容的修复。

- **分支策略**：开发工作在 **`dev`** 分支进行并推送。**`main` = 生产，`dev` = 测试。仅在用户明确要求时才合并 / 推送到 `main`。**
- **危险操作需确认**：`push --force`、`reset --hard`、删除分支/tag、改写已发布历史等，**必须先与用户确认**。
- **禁止** 使用 `--no-verify` 跳过校验来"让报错消失"；应修复根因。

### 0.3 代码健壮性（Robustness / MUST）

- **类型安全**：TypeScript `strict`；**禁止 `any`**（`noExplicitAny: error`），必要时用 `unknown` + 收窄。
- **边界处理**：对所有外部输入（用户输入、API、Webhook、DB 结果、第三方响应）做校验（优先 Zod）；不信任的数据一律视为可能非法。
- **错误处理**：不吞异常；要么处理、要么显式向上抛出并记录日志（Pino）。面向用户的错误信息友好、可定位；内部错误带足够上下文。
- **失败要安全（Fail-safe）**：金额/积分、扣费、配额、事务相关逻辑必须考虑**幂等**与**并发**；优先利用数据库约束（唯一索引、`onConflictDoNothing`）兜底，杜绝双花/少扣/多扣。
- **可选服务优雅降级**：Redis、Axiom、Sentry 等未配置时应跳过而非崩溃。
- **不留半成品**：不提交未完成实现、TODO 占位的"假完成"；确需分阶段时在 `./docs/TODO.md` 显式记录。
- **质量门（提交前必须全绿）**：
  ```bash
  turbo typecheck   # 类型检查
  turbo lint        # Biome lint（noExplicitAny / noUnusedImports = error）
  turbo test        # 单元测试（见 0.4）
  ```

### 0.4 测试覆盖（Testing / MUST）

- **新增/修改逻辑必须随附测试**：核心业务逻辑（积分、扣费、订阅、配额、鉴权、幂等、API 处理）**必须**有单元测试。
- **覆盖优先级**：金额/积分 > 鉴权与权限 > 数据写入与幂等 > 业务分支 > 纯展示。
- **测试要覆盖**：正常路径（happy path）+ 边界值 + 失败/异常路径 + 并发/重复请求（幂等）。
- **测试可独立运行**：`packages/shared`、`apps/web` 的 vitest 为**免 DB（DB-free）**单测；**纯函数应抽离到不 import `@repo/database` 的模块**中以便单测（import `db` 会触发 `DATABASE_URL` 校验而失败）。
- **修 Bug 先写复现测试**：先写出能复现的失败测试，再修复使其通过（回归保护）。
- **不为了通过而造假**：禁止 `skip`/注释掉断言/弱化断言来制造"绿灯"。

### 0.5 安全检查（Security / MUST）

- **机密绝不入库**：密钥、令牌、数据库口令等只存在于 `.env.local` / 部署环境，**严禁提交到 Git、严禁写入文档/日志/注释**。发现泄露立即提示用户轮换。
- **OWASP 红线**：警惕并防止 SQL 注入、XSS、CSRF、SSRF、命令注入、路径穿越、IDOR/越权访问等；写出不安全代码要立即修正。
- **鉴权与授权**：服务端动作走 `protectedAction` / `adminAction`；**每一处资源访问都要校验归属与权限**，不要只靠前端隐藏。
- **凭据转发**：向上游/第三方转发请求时，**不得携带客户端的 `Authorization`/Cookie**；仅对**第一方（same-origin）**地址转发凭据。
- **输入即不可信**：所有外部输入校验 + 适当转义/参数化；文件、URL、回调地址做白名单/同源校验，防 SSRF / DNS-rebinding。
- **最小权限**：API Key、令牌、数据库账号按最小权限授予；敏感操作留审计/日志（脱敏后）。
- **依赖安全**：引入/升级依赖前评估来源与维护状态；不随意降级安全相关依赖。
- **隐私**：遵循「纯中转 / 不记录」等隐私承诺的设计边界，不在该路径上落库或留存用户数据。

### 0.6 持久化记忆（Documentation as Memory / MUST）

使用 Markdown 在 `./docs/` 维护项目与开发文档，包含**项目简介、使用说明、已知问题、更新日志**等。这些是**所有贡献者 Agent 的共享长期记忆**——重要事项、决策、待办都必须 document 化：

- `./docs/MEMORY.md` — 实时关键记忆（索引）。
- `./docs/memory/` — 长期、大量记忆（按主题分文件）。
- `./docs/plan/` — 计划（按日期/主题）。
- `./docs/TODO.md` — 待办事项，并**定期清理**。
- 所有结论/方案/已知问题必须落到文档，保证 **可追溯 / 可验证 / 可解释**。

### 0.7 使命与工作方式

- **使命（不可削减）**：协助完成 项目维护（Maintenance）、功能开发（Feature Development）、Bug 修复（Bug Fixing）、代码与架构优化（Refactor & Optimization）。
- **子 Agent 分工**：
  - 独立任务使用 **子 Agent** 承接，避免上下文污染。
  - 并行的重复性任务使用 **子 Agent 并行** 执行，提高效率。
- **风险与影响**：不可逆/影响共享系统/破坏性操作前先确认；本地可逆操作（编辑、跑测试）可自由进行。

### 0.8 不确定即查，禁止猜测

- 遇到任何不确定或存疑的技术信息：
  - ❌ 禁止基于经验、直觉或"感觉差不多"作答或写码。
  - ✅ **必须优先使用工具或可靠资料获取依据**（读代码、查文档、跑验证）。
- 遇到无法解决的问题，可查找并自行安装相关 skill，确保不做没有把握的事。

---

## 1. Project Overview

GPT2Image-Pro is an AI-powered image generation platform. **Turborepo monorepo** with one Next.js app and three shared packages.

**Architecture:**
```
gpt2image-pro/
├── apps/
│   └── web/          # 主应用和管理后台
├── packages/
│   ├── database/     # Drizzle ORM schema + DB connection
│   ├── ui/           # Shadcn/UI components + theme
│   └── shared/       # 共享业务逻辑 (auth, credits, storage, payment, etc.)
├── docker-compose.yml
├── Dockerfile.web
└── turbo.json
```

**Deployment:** Docker Compose + Nginx reverse proxy + Certbot SSL on DigitalOcean

## 2. Commands

```bash
# Monorepo (root)
turbo dev                    # 启动所有 apps (Turbopack)
turbo build                  # 生产构建
turbo typecheck              # 类型检查
turbo lint                   # Biome lint
turbo test                   # 运行单元测试

# 单个 app
pnpm --filter @repo/web dev  # 主应用 (port 3000)

# 数据库
pnpm --filter @repo/database db:push     # Push schema
pnpm --filter @repo/database db:generate # Generate migrations
pnpm --filter @repo/database db:studio   # Drizzle Studio

# Docker 部署
docker compose build          # 构建镜像
docker compose up -d          # 启动服务
docker compose logs -f web    # 查看日志
```

> 注意：数据库迁移在本项目采用**手写、幂等的 SQL 迁移**并登记于 `meta/_journal.json`；**不要直接用 `drizzle-kit generate`**（snapshot 漂移时会进入交互模式）。

## 3. Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript (strict)
- **Build:** Turborepo, pnpm workspaces
- **Styling:** Tailwind CSS 4, Shadcn/UI, Radix UI, Framer Motion
- **Database:** PostgreSQL via Drizzle ORM
- **Auth:** Better Auth (email/password + GitHub + Google OAuth)
- **Validation:** Zod, React Hook Form, next-safe-action
- **Storage:** Cloudflare R2 / S3 via `@aws-sdk/client-s3`
- **Payment:** Creem (subscriptions + one-time purchases)
- **i18n:** next-intl (locales: `en`, `zh`)
- **Content:** Fumadocs MDX (docs, blog, legal)
- **Logging:** Pino + optional Axiom
- **Monitoring:** Optional Sentry
- **Linting / Formatting:** Biome
- **Testing:** Vitest

## 4. Architecture

### apps/web — 主应用

**Route Groups** (`apps/web/src/app/[locale]/`):
- `(marketing)/` — 公开页面 (首页, 定价, 博客, 法律)
- `(dashboard)/` — 用户面板和管理后台 (图片生成, 画廊, 设置, 工单, 用户管理, 系统设置). 需要认证
- `(auth)/` — 登录/注册/忘记密码
- `docs/` — Fumadocs 文档

**API Routes** (`apps/web/src/app/api/`):
- `auth/[...all]/` — Better Auth
- `webhooks/creem/` — 支付回调
- `storage/[bucket]/[...key]/` — 图片代理
- `upload/presigned/` — 预签名上传
- `search/` — 搜索 API
- `jobs/` — 内置定时任务的兼容 HTTP 入口

**Feature Modules** (`apps/web/src/features/`):
- `image-generation/` — 图片生成核心
- `external-api/` — 外部 v1 API（OpenAI 兼容）与鉴权（含纯中转 Key）
- `dashboard/` — 面板组件
- `marketing/` — 营销组件
- `settings/` — 用户设置
- `auth/` — 认证表单
- `blog/`, `analytics/`, `pseo/`

### packages/shared — 共享业务逻辑

Import pattern: `@repo/shared/<module>`

- `auth/` — Better Auth 配置 (client, server, admin)
- `credits/` — 积分系统 (core, actions, config, components, idempotency)
- `storage/` — 存储 providers (S3/R2/local)
- `payment/` — Creem API 客户端
- `support/` — 工单系统
- `subscription/` — 订阅管理（含套餐能力矩阵 plan-capabilities）
- `mail/` — 邮件模板
- `config/` — 站点配置, 支付配置, 订阅计划
- `system-settings/` — 系统设置（含管理后台面板）
- `components/` — 共享组件 (Providers, ModeToggle, etc.)
- `safe-action.ts` — next-safe-action tiers
- `logger/` — Pino logger
- `rate-limit/` — Upstash 限流
- `monitoring/` — Sentry

### packages/database

Import: `@repo/database` (db), `@repo/database/schema` (tables)

> 该包在模块加载时校验 `DATABASE_URL`；任何 import 它的模块都无法在 DB-free 单测中加载。**纯逻辑请抽离到不依赖该包的模块**。

### packages/ui

Import: `@repo/ui/components/<name>`, `@repo/ui/utils` (cn), `@repo/ui/globals.css`

### Server Action Tiers (`packages/shared/src/safe-action.ts`)

- `actionClient` — Base with logging
- `protectedAction` — Requires auth, provides `ctx.userId`
- `adminAction` — Requires admin role

### Credits System (`packages/shared/src/credits/core.ts`)

Double-entry bookkeeping with FIFO batch expiration. Atomic balance updates prevent double-spend.
**财务真相在 `credits_transaction`，而非 `generation` 行**（后者仅用于历史/画廊展示）。
扣费/发放均支持**请求级幂等**（`source_ref` + 偏唯一索引 + `onConflictDoNothing` / 23505 兜底）。

### Subscription Plans (`packages/shared/src/config/subscription-plan.ts`)

4 tiers (Free, Starter, Pro, Ultra). Single source of truth for monthly credits and plan limits.
套餐能力通过 `PLAN_CAPABILITY_KEYS` + `DEFAULT_PLAN_CAPABILITY_MATRIX` 描述，可由系统设置 `PLAN_CAPABILITY_MATRIX` 覆盖。
**新增能力位时需同步**：`plan-capabilities.ts`、`system-settings/definitions.ts` 示例、`system-settings-panel.tsx` 显示项（否则同步测试会失败）。

## 5. Coding Conventions

- **Language:** Chinese comments, English code（注释见 §0.1 注释原则）
- **Path alias:** `@/*` maps to `src/*` (within each app)
- **Cross-package imports:** `@repo/database`, `@repo/ui/*`, `@repo/shared/*`
- **Formatting:** Biome — double quotes, semicolons, 2-space indent
- **Lint rules:** `noExplicitAny: error`, `noUnusedImports: error`；TS `noUnusedLocals` / `noUnusedParameters`
- **Server Components by default** — `'use client'` only when needed
- **i18n navigation** — `Link`, `redirect`, `useRouter` from `@/i18n/routing`
- **Optional services degrade gracefully** — Redis, Axiom, Sentry skip when unconfigured

## 6. Environment Variables

See `.env.example`. Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. Configure the default image backend in the image backend pool instead of environment variables.

> 机密只放 `.env.local` / 部署环境，**严禁提交或写入文档/日志**（见 §0.5）。
