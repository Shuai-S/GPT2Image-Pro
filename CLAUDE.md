# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

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

## Commands

```bash
# Monorepo (root)
turbo dev                    # 启动所有 apps (Turbopack)
turbo build                  # 生产构建
turbo typecheck              # 类型检查
turbo lint                   # Biome lint

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

## Tech Stack

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
- **Linting:** Biome

## Architecture

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
- `dashboard/` — 面板组件
- `marketing/` — 营销组件
- `settings/` — 用户设置
- `auth/` — 认证表单
- `blog/`, `analytics/`, `pseo/`

### packages/shared — 共享业务逻辑

Import pattern: `@repo/shared/<module>`

- `auth/` — Better Auth 配置 (client, server, admin)
- `credits/` — 积分系统 (core, actions, config, components)
- `storage/` — 存储 providers (S3/R2/local)
- `payment/` — Creem API 客户端
- `support/` — 工单系统
- `subscription/` — 订阅管理
- `mail/` — 邮件模板
- `config/` — 站点配置, 支付配置, 订阅计划
- `components/` — 共享组件 (Providers, ModeToggle, etc.)
- `safe-action.ts` — next-safe-action tiers
- `logger/` — Pino logger
- `rate-limit/` — Upstash 限流
- `monitoring/` — Sentry

### packages/database

Import: `@repo/database` (db), `@repo/database/schema` (tables)

### packages/ui

Import: `@repo/ui/components/<name>`, `@repo/ui/utils` (cn), `@repo/ui/globals.css`

### Server Action Tiers (`packages/shared/src/safe-action.ts`)

- `actionClient` — Base with logging
- `protectedAction` — Requires auth, provides `ctx.userId`
- `adminAction` — Requires admin role

### Credits System (`packages/shared/src/credits/core.ts`)

Double-entry bookkeeping with FIFO batch expiration. Atomic balance updates prevent double-spend.

### Subscription Plans (`packages/shared/src/config/subscription-plan.ts`)

4 tiers (Free, Starter, Pro, Ultra). Single source of truth for monthly credits and plan limits.

## Coding Conventions

- **Language:** Chinese comments, English code
- **Path alias:** `@/*` maps to `src/*` (within each app)
- **Cross-package imports:** `@repo/database`, `@repo/ui/*`, `@repo/shared/*`
- **Formatting:** Biome — double quotes, semicolons, 2-space indent
- **Lint rules:** `noExplicitAny: error`, `noUnusedImports: error`
- **Server Components by default** — `'use client'` only when needed
- **i18n navigation** — `Link`, `redirect`, `useRouter` from `@/i18n/routing`
- **Optional services degrade gracefully** — Redis, Axiom, Sentry skip when unconfigured

## Environment Variables

See `.env.example`. Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. Configure the default image backend in the image backend pool instead of environment variables.
