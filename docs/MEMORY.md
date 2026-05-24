# GPT2IMAGE Pro — 实时关键记忆

## 部署状态

- **用户站**: https://gpt2image.pro (port 3000)
- **管理站**: https://admin.gpt2image.pro (port 3001)
- **部署方式**: 本机 Next standalone；Nginx 当前 upstream 主用 `127.0.0.1:3308`，`3307` backup，`3303` 用于旁路/主服务验证
- **当前 superapi 生图站**: `https://gpt2image.superapi.buzz`
- **数据库**: PostgreSQL on same host
- **SSL**: 由 Nginx/证书服务管理

## 高优先级部署记忆：静态资源前缀

Superapi 生图站部署必须先看 [deploy-superapi.md](./deploy-superapi.md)。当前公网 upstream 走 `3308`，且 systemd 使用 drop-in 指向 release；不要只重启 `3303`。

2026-05-19 事故记录：页面可返回 200，但 CSS/JS 静态资源失效。原因是只改了根目录 `.env.local`，实际参与 `apps/web` 构建的是 `apps/web/.env.local`；同时 Cloudflare 缓存过旧资源前缀下的 404。

下次部署必须注意：

- `NEXT_PUBLIC_ASSET_PREFIX` 是构建期配置，必须改 `apps/web/.env.local`，只改根目录 `.env.local` 不会影响 `apps/web` 构建。
- 如果 Cloudflare 已缓存某个资源前缀的 404，不要复用旧前缀；直接换新版本前缀，例如 `/gpt2-assets-vYYYYMMDD-purpose`，然后重新构建。
- `pnpm --filter @repo/web build` 后，必须把 `apps/web/.next/static` 复制到 standalone 目录：`apps/web/.next/standalone/apps/web/.next/static`。否则 standalone 服务会缺 CSS/JS。
- 启动 standalone 时必须加载 `apps/web/.env.local`，否则会出现 `DATABASE_URL 环境变量未设置` 一类运行时错误。
- 重启前后都要验证页面 HTML 里的前缀、源站资源、公网资源，不能只看首页 200。

### 静态资源前缀验证命令

```bash
# 确认构建产物里的前缀
rg -n '"assetPrefix"|gpt2-assets' apps/web/.next/required-server-files.json

# 确认公网 upstream 3308 引用的新前缀
curl -s http://127.0.0.1:3308/zh | rg -o '/gpt2-assets-[^"<> ]+' | head

# 确认公网页面引用的新前缀
curl -k -s https://gpt2image.superapi.buzz/zh \
  | rg -o '/gpt2-assets-[^"<> ]+' | head

# 抽查公网静态资源必须是 200
curl -k -I https://gpt2image.superapi.buzz/gpt2-assets-vYYYYMMDD-purpose/_next/static/chunks/<file>.css
```

## Creem 支付沙盒

- **Store ID**: 已配置，勿提交真实值
- **API Key**: 已配置，勿提交真实值
- **API Base**: `https://test-api.creem.io/v1`
- **Webhook Secret**: 未配置

### 产品 ID

| Plan | Monthly | Yearly |
|------|---------|--------|
| Starter ($5/$35) | 已配置，勿提交真实值 | 已配置，勿提交真实值 |
| Pro ($9/$65) | 已配置，勿提交真实值 | 已配置，勿提交真实值 |
| Ultra ($15/$109) | 已配置，勿提交真实值 | 已配置，勿提交真实值 |

## R2 存储

- **Endpoint**: 已配置，勿提交真实值
- **Bucket**: 已配置，勿提交真实值
- **状态**: 待配置 Access Key

## 待办

- [ ] 配置 R2 存储 Access Key
- [ ] 配置 Creem Webhook Secret
- [ ] 清理根目录旧 `src/` 代码
- [ ] 更新 README.md 为 monorepo 结构
- [ ] 迁移 Next.js 16 middleware 到 proxy convention

## 部署操作

```bash
# 不要直接按旧 3303 单服务流程部署 superapi 生图站。
# 当前公网走 3308 + systemd drop-in + Nginx static alias。
# 标准流程见：
sed -n '1,260p' docs/deploy-superapi.md
```
