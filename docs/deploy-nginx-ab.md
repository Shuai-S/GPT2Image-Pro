# Nginx AB 部署 Runbook

本文档记录 `https://your-domain.example` 当前线上部署方式，只适用于本站这套 Nginx 静态 alias、systemd release 和 AB 切换环境。普通部署不需要照这个 runbook 手动处理静态资源；按 README 的生产部署即可。

## 当前拓扑

- 公网域名：`https://your-domain.example`
- Nginx upstream：`gpt2image_pool`
- 当前公网主 upstream：`127.0.0.1:3308`
- 备用 upstream：`127.0.0.1:3307`
- 主服务旁路验证端口：`3303`
- Next 静态 alias：`/var/www/your-domain.example/_next/static/`
- release 根目录：`/home/user1/gpt2image-releases/`
- Node：`/home/user1/.nvm/versions/node/v24.15.0/bin`

注意：公网当前主要走 `3308`，不是 `3303`。只重启 `gpt2image-web.service` 不等于公网已切换。

## 部署原则

- 每次前端构建必须更换 `NEXT_PUBLIC_ASSET_PREFIX`，不要复用旧前缀。
- `NEXT_PUBLIC_ASSET_PREFIX` 必须写在 `apps/web/.env.local`，这是 Next 构建实际读取的文件。
- 如果本次包含数据库 schema 变更，必须先执行并验证迁移，再切任何公网实例；不要让新代码打到旧 schema，也不要让公网请求打到半更新实例。
- 切换公网实例前先摘流或切到备用实例；确认新实例健康后再切回，避免部署窗口内 `/v1/*` 请求命中正在重启的进程。
- release 不能复制 `storage`，否则会把用户生成图复制进 release，目录可能膨胀到几十 GB。
- release 不能排除 `apps/web/.next/standalone/node_modules`，否则 standalone 启动会报 `Cannot find module 'next'`。
- Nginx 静态 alias 不会读 release 目录，必须单独同步 `apps/web/.next/static` 到 `/var/www/your-domain.example/_next/static/`。
- systemd 有 drop-in 覆盖路径，必须改 drop-in，不要只看主 unit。

## 上线前检查

每次上线先判断是否需要数据库迁移：

```bash
git diff --name-only HEAD~1..HEAD | rg 'packages/database|drizzle|schema|migrations'
```

如果有 schema 或 migration 变更，先在当前生产数据库执行迁移：

```bash
PATH=/home/user1/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter @repo/database db:migrate
```

迁移后至少做一次只读校验，确认关键表字段存在：

```bash
set -a; . apps/web/.env.local; set +a
pnpm --dir apps/web exec node - <<'NODE'
const { Client } = require("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
(async () => {
  await client.connect();
  const result = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'image_backend_api'
    order by ordinal_position
  `);
  console.log(result.rows.map((row) => row.column_name).join("\n"));
  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
```

如果迁移失败，停止部署，不要构建和切服务。

## 标准部署流程

以下命令假设在仓库根目录 `/home/user1/GPT2Image-Pro` 执行。

### 1. 确认工作区和 commit

```bash
git status --short
git log --oneline -1
```

如果有代码改动，先测试并提交。

### 2. 更新静态资源前缀

把 `apps/web/.env.local` 里的 `NEXT_PUBLIC_ASSET_PREFIX` 改成唯一值：

```env
NEXT_PUBLIC_ASSET_PREFIX=/gpt2-assets-vYYYYMMDD-brief-<commit>-HHMMSS
```

验证：

```bash
rg -n "NEXT_PUBLIC_ASSET_PREFIX" apps/web/.env.local
```

### 3. 构建

```bash
PATH=/home/user1/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter @repo/web build
```

如果出现 `.next/lock` 残留且确认没有构建进程：

```bash
ps -ef | rg "next build|pnpm|turbo|node"
rm -f apps/web/.next/lock
```

构建后验证前缀：

```bash
rg -n '"assetPrefix"|gpt2-assets' apps/web/.next/required-server-files.json
```

### 4. 补齐 standalone static

```bash
mkdir -p apps/web/.next/standalone/apps/web/.next/static
rsync -a --delete apps/web/.next/static/ apps/web/.next/standalone/apps/web/.next/static/
```

### 5. 创建 release

示例：

```bash
release=/home/user1/gpt2image-releases/gpt2image-brief-<commit>-YYYYMMDD-HHMMSS
mkdir -p "$release"

rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.turbo' \
  --exclude='storage' \
  --exclude='apps/web/.next/cache' \
  /home/user1/GPT2Image-Pro/ "$release"

# 关键：上面的全局 node_modules 排除会影响 standalone，必须重新补齐 standalone。
rsync -a --delete \
  /home/user1/GPT2Image-Pro/apps/web/.next/standalone/ \
  "$release/apps/web/.next/standalone/"
```

验证 release：

```bash
du -sh "$release"
test -e "$release/apps/web/.next/standalone/node_modules/.pnpm/next"* && echo ok
test -L "$release/apps/web/.next/standalone/apps/web/node_modules/next" && echo ok
rg -n '"assetPrefix"|gpt2-assets' "$release/apps/web/.next/standalone/apps/web/.next/required-server-files.json"
```

正常 release 体积应在几百 MB 量级，不应出现几十 GB。

### 6. 同步 Nginx 静态资源

```bash
rsync -a --delete \
  "$release/apps/web/.next/static/" \
  /var/www/your-domain.example/_next/static/
```

注意：先同步静态资源，再切服务。否则 Cloudflare 可能缓存新版 chunk 的 404。

### 7. 摘流公网实例

切公网实例前先把 Nginx upstream 临时切到备用端口，或者确认备用端口已经运行上一版健康服务。不要直接重启当前承载公网流量的实例。

检查当前 upstream：

```bash
sudo nginx -T 2>/dev/null | sed -n '/upstream gpt2image_pool/,/}/p'
```

如果 3307 是健康旧版，可临时只保留 3307：

```nginx
upstream gpt2image_pool {
    server 127.0.0.1:3307;
}
```

然后验证并 reload：

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -s http://127.0.0.1:3307/zh | head
```

这样重启 3308 时，公网请求不会打到正在停止/启动的进程。

### 8. 切 3308 公网服务

3308 摘流后再切到新 release：

```bash
sudo python3 - <<'PY'
from pathlib import Path
release = "/home/user1/gpt2image-releases/gpt2image-brief-<commit>-YYYYMMDD-HHMMSS"
path = Path("/etc/systemd/system/gpt2image-3308-nopending.service.d/20-agenttools.conf")
path.write_text(f"""[Service]
WorkingDirectory={release}/apps/web/.next/standalone/apps/web
EnvironmentFile=
EnvironmentFile={release}/apps/web/.env.local
Environment=
Environment=PORT=3308
Environment=HOSTNAME=0.0.0.0
Environment=NODE_ENV=production
Environment=PATH=/home/user1/.nvm/versions/node/v24.15.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=
ExecStart=/home/user1/.nvm/versions/node/v24.15.0/bin/node server.js
""")
PY

sudo systemctl daemon-reload
sudo systemctl restart gpt2image-3308-nopending.service
systemctl is-active gpt2image-3308-nopending.service
```

如果 3308 有长请求，restart 可能等待旧请求退出。可以先看日志确认是否仍在处理请求：

```bash
journalctl -u gpt2image-3308-nopending.service --since "2 minutes ago" --no-pager
```

启动后先本机健康检查，不要立刻回切公网：

```bash
curl -s http://127.0.0.1:3308/zh | rg -o '/gpt2-assets-[^"<> ]+' | head
curl -s http://127.0.0.1:3308/api/health 2>/dev/null || true
journalctl -u gpt2image-3308-nopending.service --since "2 minutes ago" --no-pager | rg -i 'error|failed|exception|failed query' || true
```

确认健康后再把 Nginx upstream 切回 3308，或恢复 AB upstream：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 9. 切 3303 主服务

`3303` 当前主要用于旁路验证和保留一份同版本服务，也要切到同一 release：

```bash
sudo python3 - <<'PY'
from pathlib import Path
release = "/home/user1/gpt2image-releases/gpt2image-brief-<commit>-YYYYMMDD-HHMMSS"
path = Path("/etc/systemd/system/gpt2image-web.service.d/10-release-15bc77b.conf")
path.write_text(f"""[Service]
WorkingDirectory={release}/apps/web/.next/standalone/apps/web
ExecStart=
ExecStart=/bin/bash -lc 'set -a; . {release}/apps/web/.env.local; set +a; PORT=3303 HOSTNAME=0.0.0.0 NODE_ENV=production exec /home/user1/.nvm/versions/node/v24.15.0/bin/node server.js'
""")
PY

sudo systemctl daemon-reload
sudo systemctl restart gpt2image-web.service
systemctl is-active gpt2image-web.service
```

### 10. 验证

确认进程运行目录：

```bash
readlink -f /proc/$(systemctl show -p MainPID --value gpt2image-3308-nopending.service)/cwd
readlink -f /proc/$(systemctl show -p MainPID --value gpt2image-web.service)/cwd
```

确认 3308 返回新前缀：

```bash
curl -s http://127.0.0.1:3308/zh \
  | rg -o '/gpt2-assets-[^"<> ]+' \
  | head
```

确认公网返回新前缀：

```bash
curl -k -s https://your-domain.example/zh \
  | rg -o '/gpt2-assets-[^"<> ]+' \
  | head
```

抽查公网静态资源：

```bash
curl -k -I https://your-domain.example/<asset-prefix>/_next/static/chunks/<chunk>.js
curl -k -I https://your-domain.example/<asset-prefix>/_next/static/chunks/<chunk>.css
```

看服务日志：

```bash
journalctl -u gpt2image-3308-nopending.service --since "5 minutes ago" --no-pager
journalctl -u gpt2image-web.service --since "5 minutes ago" --no-pager
```

特别检查部署窗口内是否出现内部 DB/schema 错误：

```bash
journalctl -u gpt2image-3308-nopending.service -u gpt2image-web.service \
  --since "10 minutes ago" --no-pager \
  | rg -i 'Failed query|column .* does not exist|relation .* does not exist|schema|migration'
```

如果出现上述错误，立即回滚到旧 release，并检查迁移是否执行在正确的 `DATABASE_URL` 上。

## 事故记录：2026-05-31 `Failed query`

`2026-05-31 11:21-11:30 UTC` 部署窗口内出现 71 次外接 API 失败，集中在：

- `/v1/images/edits`：59 次
- `/v1/images/generations`：11 次
- `/v1/chat/completions`：1 次

错误形态：

```text
Failed query: select ... from "image_backend_api" ...
```

同一窗口存在服务重启和 SIGKILL：

```text
gpt2image-3308-nopending.service: State 'stop-sigterm' timed out. Killing.
systemctl restart gpt2image-3308-nopending.service
systemctl restart gpt2image-web.service
```

结论：部署期间请求命中半更新/重启中的实例，或应用代码与数据库 schema 短暂不一致。后续必须先迁移并验证 DB，再摘流切实例，最后回切公网。

## 回滚

回滚只需要把两个 systemd drop-in 改回上一个 release，并重启：

- `/etc/systemd/system/gpt2image-3308-nopending.service.d/20-agenttools.conf`
- `/etc/systemd/system/gpt2image-web.service.d/10-release-15bc77b.conf`

如果新静态前缀已经被页面引用，回滚后页面会重新引用旧前缀。旧静态资源目录如果仍在 `/var/www/your-domain.example/_next/static/` 就无需额外操作。

## 常见故障

### 页面还是旧前缀

优先检查 3308，而不是 3303：

```bash
curl -s http://127.0.0.1:3308/zh | rg -o '/gpt2-assets-[^"<> ]+' | head
systemctl cat gpt2image-3308-nopending.service
```

### `Cannot find module 'next'`

release 中 standalone 的 `node_modules` 缺失。重新执行：

```bash
rsync -a --delete \
  /home/user1/GPT2Image-Pro/apps/web/.next/standalone/ \
  "$release/apps/web/.next/standalone/"
sudo systemctl restart gpt2image-3308-nopending.service
```

### ChunkLoadError 或样式丢失

确认 Nginx 静态目录已同步，并抽查资源：

```bash
rsync -a --delete "$release/apps/web/.next/static/" /var/www/your-domain.example/_next/static/
curl -k -I https://your-domain.example/<asset-prefix>/_next/static/chunks/<chunk>.js
```

### release 目录异常巨大

通常是误复制了 `storage`。不要上线这个 release，删除或隔离后按标准命令重建。
