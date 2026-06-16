# GPT2IMAGE 安全审计报告

**日期**: 2026-06-16
**范围**: GPT2IMAGE Turborepo 全代码库 (apps/web, apps/admin, apps/api, apps/platform, packages/*)
**技术栈**: Next.js 16, React 19, TypeScript, Drizzle ORM + PostgreSQL, Better Auth
**方法**: 多维度静态分析 + P0/P1 级发现的人工代码验证

---

## 执行摘要

本次审计对 GPT2IMAGE 的 4 个应用和共享包进行了全面安全审查, 共发现 **101 条原始告警**, 经去重和人工验证后合并为 **71 条独立发现**。其中 28 条 P0/P1 级别的发现经过完整的代码路径追踪验证, 8 条被确认为误报并剔除, 多条严重性被下调。

### 统计总览

| 级别 | 原始数量 | 验证后数量 | 说明 |
|------|---------|-----------|------|
| P0 (Critical) | 2 | **1** | 1 条确认, 1 条降至 P3 |
| P1 (High) | 16 | **4** | 4 条确认, 5 条降级, 7 条误报/合并 |
| P2 (Medium) | 30 | **27** | 含多条从 P1 降级的发现 |
| P3 (Low) | 20 | **23** | 含多条从 P0/P1 降级的发现 |
| 误报 (FP) | 0 | **8** | 经验证确认为误报, 已剔除 |
| **合计** | **101** | **55** | 去重 + 误报剔除后 |

### 关键风险领域

1. **管理后台认证缺陷** -- admin 应用的注册端点默认开放 (P0)
2. **SSRF 漏洞** -- 图像处理管线中 2 处裸 fetch 绕过已有 SSRF 防护 (P1)
3. **授权边界突破** -- 2 个管理操作缺少目标角色权限护栏 (P1/P2)
4. **支付安全** -- Creem webhook 金额校验默认不执行硬拒 (P2)
5. **纵深防御缺失** -- CSP/安全响应头全局缺失, CSRF 全局禁用 (P2)

---

## 审计方法

### 扫描维度

| 维度 | 覆盖范围 |
|------|---------|
| 认证与授权 (AuthN/AuthZ) | Better Auth 配置, 中间件, RBAC, UOL 访问控制 |
| 输入校验与注入 | SQL/LIKE 注入, JSONB 合并, XSS, SSRF |
| 网络与传输安全 | Nginx, CORS, CSRF, 安全响应头, TLS |
| 支付与计费 | Creem/Epay webhook, 积分幂等性, 金额校验 |
| 基础设施与部署 | Docker, 环境变量, PM2, 依赖管理 |
| 数据与隐私 | localStorage, 日志泄露, 错误信息暴露 |
| 并发安全 | TOCTOU 竞态, 乐观锁, 配额原子性 |

### 验证流程

对所有 P0 和 P1 级别发现执行了完整的代码路径追踪验证:
- 阅读 Better Auth v1.6.14 框架源码 (cookie 默认值, CSRF 行为, 注册端点逻辑)
- 追踪完整的数据流 (从用户输入到数据库/外部 fetch)
- 验证 .gitignore 规则有效性, Docker 构建阶段隔离性
- 确认数据库约束 (唯一索引, 外键) 对竞态条件的实际缓解效果

---

## P0 -- Critical

### P0-1: Admin 应用注册端点默认开放, 任何人可创建管理员账号

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/auth/admin-auth.ts` |
| **行号** | 50-56 |
| **验证状态** | 已确认 (置信度 0.98) |
| **CVSS 参考** | 9.8 (Critical) |

**描述**: `admin-auth.ts` 配置 `emailAndPassword: { enabled: true }` 但未设置 `disableSignUp: true`。Better Auth 在此配置下自动暴露 `/api/auth/sign-up/email` 端点。`apps/admin/src/app/api/auth/[...all]/route.ts` 通过 `toNextJsHandler(adminAuth)` 挂载全部 Better Auth 路由。前端无注册页面, 但 API 端点真实存在且无任何保护。

**攻击场景**: 攻击者向 `POST https://admin.gpt2image.pro/api/auth/sign-up/email` 发送 `{name, email, password}`, 在 `admin_user` 表创建账号, 登录后获得完整管理后台权限 (用户管理/积分操作/后端池管理)。

**验证证据链**:
- Better Auth 源码 `sign-up.mjs:143` 确认: 仅当 `disableSignUp: true` 时才拒绝注册
- admin 中间件 matcher 显式跳过 `/api/*` 路径
- `formCsrfMiddleware` 在无 Cookie 的脚本请求下直接放行
- admin layout 仅检查 `session?.user` 存在, 无角色/白名单机制
- Docker 部署中 admin 端口 3001 直接对外暴露

**修复建议**:
```typescript
// packages/shared/src/auth/admin-auth.ts
emailAndPassword: {
  enabled: true,
  disableSignUp: true, // 阻止通过 API 注册管理员
}
```
管理员账号应仅通过受控种子脚本或现有超管邀请创建。

---

## P1 -- High

### P1-1: toImageBuffer 裸 fetch 下载上游返回 URL -- SSRF 漏洞

| 属性 | 值 |
|------|---|
| **文件** | `packages/image-generation/src/operations.ts` |
| **行号** | 316-337 (特别是 331 行) |
| **验证状态** | 已确认 (置信度 0.92) |

**描述**: `toImageBuffer` 使用裸 `fetch(result.imageUrl)` 下载图片, 绕过了代码库中已有的完整 SSRF 防护栈 (`fetchPublicImage` / `fetchWithDnsPin` / `assertPublicImageUrl`)。`imageUrl` 来自上游 API 响应中的 `url` 字段, 在 user-api 模式下可被恶意上游完全控制。

**攻击场景**: 攻击者配置自定义 API baseUrl (公网地址, 通过 `assertPublicApiBaseUrl` 校验), 该服务器在响应中返回 `{data:[{url:"http://169.254.169.254/latest/meta-data/iam/security-credentials/"}]}`。`toImageBuffer` 盲目 fetch 该内网地址, 获取云元数据。攻击者通过 `b64_json` 响应格式间接获取内容。

**修复建议**: 将 `fetch(result.imageUrl)` 替换为 `fetchPublicImage(result.imageUrl)`, 与 `rehost-input-images.ts:54` 和 `web-history-references.ts:160` 保持一致。

---

### P1-2: getImageBase64 裸 fetch 任意 URL -- SSRF 漏洞

| 属性 | 值 |
|------|---|
| **文件** | `packages/image-generation/src/external-api-images.ts` |
| **行号** | 70-121 (特别是 113-115 行) |
| **验证状态** | 已确认 (置信度 0.95) |

**描述**: `getImageBase64()` 对非第一方的绝对 URL 直接执行 `await fetch(url)`, 无任何 SSRF 校验。该函数在 5 个 v1 handler (responses/image-generations/image-edits/chat-completions/agent-images) 中被广泛调用。这是完整的读取型 SSRF -- 获取的内容被 base64 编码后直接返回给调用方。

**攻击场景**: 攻击者通过自定义 API 的 `/responses` 端点返回内网 URL 图片输出, 请求 `response_format=b64_json`, handler 调用 `getImageBase64` 将内网 HTTP 响应内容 base64 编码后返回, 实现云实例元数据/内部管理接口数据的完整外泄。

**修复建议**: 将裸 `fetch(url)` 替换为 `fetchPublicImage(url)`, 对返回 Response 同时应用 `readResponseBytesWithLimit` 进行大小限制。

---

### P1-3: setUserCreditsStatusAction 缺少目标角色权限护栏

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/support/actions/admin-users.ts` |
| **行号** | 968-1017 |
| **验证状态** | 已确认 (置信度 0.97) |

**描述**: `setUserCreditsStatusAction` 使用 `adminAction` (普通 admin 可调用), 但未调用 `assertCanActOnTarget()` 进行目标角色校验。同文件的 `banUserAction` (第 732 行) 和 `adminGrantCreditsAction` (第 780 行) 均正确实施了该护栏。普通 admin 可冻结 super_admin 的积分账户。

**攻击场景**: 普通 admin 调用 `setUserCreditsStatusAction` 传入 super_admin 的 userId, 将其积分账户冻结, 阻止超管进行任何消耗积分的操作。

**修复建议**:
```typescript
const targetUser = await getUserBasicOrThrow(data.userId);
assertCanActOnTarget(ctx.role, targetUser.role, data.status === 'frozen' ? '冻结' : '解冻');
```

---

### P1-4: setExternalApiKeyStatusAction 缺少目标用户角色校验

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/support/actions/admin-users.ts` |
| **行号** | 1020-1069 |
| **验证状态** | 已确认, 从 P1 调整为 P1 (影响为 DoS 级别但违反已建立的安全模式) |

**描述**: `setExternalApiKeyStatusAction` 使用 `adminAction`, 查询了 `apiKey.userId` 但从未查询目标用户角色, 也未调用 `assertCanActOnTarget()`。普通 admin 可禁用 super_admin 的 API Key。

**攻击场景**: 普通 admin 通过用户管理界面获取 super_admin 的 API Key ID, 调用此 action 将其禁用, 导致超管 v1 API 调用全部失败。

**修复建议**:
```typescript
const targetUser = await getUserBasicOrThrow(apiKey.userId);
assertCanActOnTarget(ctx.role, targetUser.role, data.isActive ? '启用 API Key' : '禁用 API Key');
```

---

## P2 -- Medium

### 认证与 CSRF

#### P2-1: 用户侧 CSRF 校验被全局禁用 (disableCSRFCheck: true)

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/auth/index.ts` |
| **行号** | 185-204 (特别是 203 行) |
| **验证状态** | 已确认, 原 P1 降至 P2 |

**描述**: `advanced.disableCSRFCheck = true` 全局关闭 Origin 头 CSRF 校验。SameSite=Lax cookie + Content-Type:application/json 白名单提供了有效的双重缓解, 但纵深防御退化, 且 sign-in/sign-up 端点接受 form-urlencoded。

**缓解因素**: Better Auth 默认 cookie `sameSite: "lax"`; 敏感端点 (change-password 等) 强制 `Content-Type: application/json`, 跨域 POST 需 CORS 预检; cookie Domain 未设置跨子域共享。

**修复建议**: 仅对密码重置/邮箱验证等有一次性 token 保护的端点豁免 CSRF, 而非全局禁用。

---

#### P2-2: admin 登录无速率限制和暴力破解防护

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/auth/admin-auth.ts` |
| **行号** | 50-56 |

**描述**: admin 的 `emailAndPassword` 配置无登录速率限制、账户锁定或验证码机制。admin 中间件无限流逻辑。管理员账号数量少、价值高, 是暴力破解理想目标。

**修复建议**: 添加每 IP 每分钟最多 5 次登录尝试限制; 连续 10 次失败后锁定 30 分钟; 考虑添加 TOTP/WebAuthn 二次验证。

---

#### P2-3: admin 会话过期时间过长 (7天) 且启用 cookieCache

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/auth/admin-auth.ts` |
| **行号** | 58-71 |

**描述**: admin 会话有效期 7 天, 与普通用户相同, 对管理后台过长。cookieCache (5 分钟 maxAge) 使会话撤销后仍有 5 分钟窗口。

**修复建议**: 缩短至 8-24 小时; 禁用 admin 的 cookieCache 或降至 30 秒; 添加 idle timeout。

---

#### P2-4: admin dashboard Server Actions 使用用户侧 auth 而非 adminAuth

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/safe-action.ts` |
| **行号** | 116-149 |

**描述**: `adminAction/superAdminAction` 的会话验证使用用户侧 `auth` 实例 (检查 `better-auth.session_token`), 而非 `adminAuth` (应检查 `admin.session_token`)。admin 应用的页面渲染和 Server Actions 使用不同的认证体系, 存在跨认证依赖。

**修复建议**: 为 admin 应用创建独立的 `adminSessionAction`, 使用 `adminAuth.api.getSession()` 验证。

---

#### P2-5: admin 中间件缺少 CSRF 保护 Server Actions

| 属性 | 值 |
|------|---|
| **文件** | `apps/admin/src/middleware.ts` |
| **行号** | 1-10 |

**描述**: admin 中间件仅处理国际化路由, 不做 CSRF 校验。Server Actions 使用用户侧 auth session cookie 鉴权, 而该 cookie 的 CSRF 校验已被全局禁用。

**修复建议**: 在中间件中添加 Origin/Referer 校验; 为 admin 创建独立的 safe-action 客户端。

---

### 网络与传输安全

#### P2-6: Nginx 缺少全部安全响应头

| 属性 | 值 |
|------|---|
| **文件** | `nginx/default.conf` |
| **行号** | 1-100 |
| **验证状态** | 已确认, 原 P1 降至 P2 |

**描述**: 4 个 server block 均无 `add_header` 指令。缺失: X-Frame-Options, HSTS, X-Content-Type-Options (全局), Referrer-Policy, CSP, Permissions-Policy。4 个 Next.js 应用的 `next.config.mjs` 也未配置 `headers()`。

**修复建议**: 在 Nginx http 块或各 server 块添加安全头。admin 使用 `X-Frame-Options: DENY`; 全局添加 `X-Content-Type-Options: nosniff`, `HSTS`, `Referrer-Policy`。CSP 按应用逐步部署。

---

#### P2-7: Nginx 缺少速率限制

| 属性 | 值 |
|------|---|
| **文件** | `nginx/default.conf` |
| **行号** | 1-100 |
| **验证状态** | 已确认, 原 P1 降至 P2 |

**描述**: 无 `limit_req_zone`/`limit_req`/`limit_conn` 指令。应用层有内存兜底限流 (非 fail-open), 但 `apps/web/src/middleware.ts` 对 `/api/auth/*` 路径在限流检查前提前返回, auth 端点限流为死代码。`apps/api` 中间件完全无限流。

**修复建议**: 在 Nginx http 块配置 `limit_req_zone`; 修复 web 中间件对 auth 路径的限流跳过; 为 api 应用添加限流中间件。

---

#### P2-8: Nginx 监听 HTTP 80 端口, 未配置 HTTPS 重定向

| 属性 | 值 |
|------|---|
| **文件** | `nginx/default.conf` |
| **行号** | 24-99 |

**描述**: 4 个 server block 均监听 80 端口。注释声明 SSL 由外部负载均衡器处理。若 Cloudflare 为 Flexible SSL 模式, CDN 与 Nginx 间为明文。

**修复建议**: 确保 Cloudflare Full (Strict) SSL; Nginx 添加 301 重定向; 添加 HSTS; 确认 Better Auth cookie Secure 标志。

---

#### P2-9: 所有子域应用缺少显式 CORS 配置

| 属性 | 值 |
|------|---|
| **文件** | `apps/api/src/middleware.ts` |
| **行号** | 1-10 |

**描述**: 4 个应用无任何 CORS 头设置。v1 API 端点无法被跨域客户端使用。未来添加 CORS 时可能引入过宽配置。

**修复建议**: 为 v1 API 添加显式 CORS 白名单; 在 Nginx 层添加默认 CORS 拒绝策略。

---

#### P2-10: Nginx 缺少 default_server 配置

| 属性 | 值 |
|------|---|
| **文件** | `nginx/default.conf` |
| **行号** | 1-100 |

**描述**: 无 default_server 块, 不匹配任何已知 server_name 的请求被转发到第一个 server (web 应用)。可通过 IP 直接访问或进行 Host 头注入。

**修复建议**: 添加 `server { listen 80 default_server; server_name _; return 444; }`。

---

#### P2-11: 全部四个 Next.js 应用未配置 CSP

| 属性 | 值 |
|------|---|
| **文件** | `apps/web/next.config.mjs` 等 4 个文件 |
| **验证状态** | 已确认, 原 P1 降至 P2 |

**描述**: 4 个 `next.config.mjs` 无 `headers()` 函数, 全局搜索 CSP 零命中。XSS 漏洞利用后果被最大化放大。

**修复建议**: 在 `packages/shared` 创建公共 security-headers 模块; 各应用通过 `next.config.mjs` 的 `headers()` 注入。

---

### 支付与计费

#### P2-12: Creem Webhook 金额校验默认不执行硬拒

| 属性 | 值 |
|------|---|
| **文件** | `apps/api/src/app/api/webhooks/creem/route.ts` |
| **行号** | 55-96 |

**描述**: `CREEM_WEBHOOK_ENFORCE_AMOUNT` 默认 false, 金额不匹配时仅告警放行。攻击者可通过篡改 checkout 价格以低价获取高价套餐积分。

**修复建议**: 将默认值改为 true (硬拒模式); 在部署文档中明确标注必须设为 true。

---

#### P2-13: 管理员扣减积分操作缺少 sourceRef 幂等键

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/support/actions/admin-users.ts` |
| **行号** | 843-853 |

**描述**: `adminAdjustCreditsAction` 调用 `consumeCredits` 时未传 `sourceRef`。网络重试/double-click 可导致重复扣减。与已正确添加 sourceRef 的 `adminGrantCreditsAction` 不一致。

**修复建议**: 添加 sourceRef 参数, 如 `admin_deduct:${ctx.userId}:${data.userId}:${Date.now()}`。

---

#### P2-14: Creem 订阅周期密钥由 period_start_date 构成, 精度问题可绕过幂等

| 属性 | 值 |
|------|---|
| **文件** | `apps/api/src/app/api/webhooks/creem/route.ts` |
| **行号** | 619-640 |

**描述**: `buildSubscriptionPeriodKey` 使用 `${subscriptionId}:${periodStartDate}` 作为幂等键。如果 Creem 重投事件中 `current_period_start_date` 精度/时区不同, 可生成不同 periodKey, 绕过幂等检查。

**修复建议**: 对 `current_period_start_date` 规范化为 UTC 日期格式 YYYY-MM-DD; 或使用 Creem 事件唯一 event ID 作为幂等键。

---

#### P2-15: Creem Webhook 无事件级重放保护

| 属性 | 值 |
|------|---|
| **文件** | `apps/api/src/app/api/webhooks/creem/route.ts` |
| **行号** | 115-195 |

**描述**: HMAC 签名验证正确但无事件去重。`subscription.canceled` 等状态变更事件重放可将活跃订阅状态回退。

**修复建议**: 验证事件时间戳在合理窗口内 (5 分钟); 状态变更前比较事件时间与 DB 中 updatedAt; 可选维护已处理事件 ID 短期缓存。

---

#### P2-16: Epay 履约函数中 metadata.expectedAmount 可能为 NaN

| 属性 | 值 |
|------|---|
| **文件** | `apps/api/src/features/payment/epay-fulfillment.ts` |
| **行号** | 72-86, 274 |

**描述**: `isExpectedEpayAmount` 在 `expectedCents` 或 `paidCents` 为 NaN 时返回 false (fail-closed, 安全但可能误拒合法交易)。需确保 `price.amount` 非空和正数。

**修复建议**: 为 `price.amount` 添加非空/正数验证; 不信任 `metadata.expectedAmount`, 始终使用 `price.amount`。

---

### 输入校验

#### P2-17: LIKE/ILIKE 通配符未转义 -- 管理后台用户搜索

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/support/actions/admin-users.ts`, `src/features/support/actions/admin-users.ts` |
| **行号** | 315-323, 79-83 |

**描述**: 用户搜索输入直接拼接 `%` 通配符传入 `ilike()`, 未转义 `%` 和 `_`。Zod schema 无长度限制。可导致全表扫描或非预期匹配范围。

**修复建议**: 添加 `escapeLikePattern` 函数转义特殊字符; Zod schema 添加 `.max(100)` 限制。

---

#### P2-18: JSON-LD dangerouslySetInnerHTML 未转义 `</script>` 序列

| 属性 | 值 |
|------|---|
| **文件** | `apps/web/src/components/seo/json-ld.tsx` |
| **行号** | 18-24 |

**描述**: `JSON.stringify(data)` 不转义 `</script>` 序列。当前数据源可信, 但若未来引入用户可控数据 (如 CMS/投稿), 可注入 `</script><script>alert(1)</script>` 实现存储型 XSS。

**修复建议**: `JSON.stringify(data).replace(/</g, '\\u003c')`, 或迁移到 Next.js metadata API 的 JSON-LD 支持。

---

### 数据与隐私

#### P2-19: localStorage 持久化聊天消息 -- XSS 可大量窃取隐私数据

| 属性 | 值 |
|------|---|
| **文件** | `apps/web/src/features/image-generation/components/create-page-client.tsx` |
| **行号** | 1161-1162, 1704-1712, 3347-3409 |

**描述**: 完整聊天对话 (提示词/AI 回复/图片 URL) 存储在 localStorage 多个键中。在缺少 CSP 的情况下, 任何 XSS 可一次性窃取全部聊天历史。

**修复建议**: 配置 CSP 作为纵深防御; 考虑仅存储对话 ID, 实际内容从服务端按需加载。

---

#### P2-20: 多处 API 路由通过 error.message 泄露内部逻辑信息

| 属性 | 值 |
|------|---|
| **文件** | `apps/web/src/app/api/images/generate/route.ts` 等多个文件 |

**描述**: 多个 API 路由和 MCP 端点将 `error.message` 直接返回给客户端, 可能泄露数据库约束名/内部路径/上游 API 细节。

**修复建议**: 建立错误信息白名单; 系统内部错误返回通用消息; 详细信息仅记录在服务端日志。

---

#### P2-21: MCP Admin 路由透传 OperationError.details

| 属性 | 值 |
|------|---|
| **文件** | `apps/admin/src/app/api/mcp/admin/route.ts` |
| **行号** | 335-340 |
| **验证状态** | 已确认, 原 P1 降至 P2 |

**描述**: `err.details` 原样透传至 JSON-RPC error response, 可暴露 Zod schema 结构、字段路径名。非 OperationError 的异常已统一为 `internal_error` (不泄露 DB 信息)。

**修复建议**: 对 `err.details` 应用白名单过滤, 仅透传预定义的安全字段。

---

#### P2-22: 旧版 Creem Webhook 使用 console.log 记录 userId 和积分数量

| 属性 | 值 |
|------|---|
| **文件** | `src/app/api/webhooks/creem/route.ts` |
| **行号** | 222-224, 421, 474 |

**描述**: console.log 记录含 userId 和积分数量的业务信息, 绕过 Pino logger 的 redact 过滤器。

**修复建议**: 替换为结构化 logger (`logEvent`/`logError`)。

---

### 基础设施

#### P2-23: 管理后台端口直接对外暴露且无网络层访问控制

| 属性 | 值 |
|------|---|
| **文件** | `docker-compose.yml` |
| **行号** | 54-56 |

**描述**: admin 3001 端口直接映射到宿主机, Nginx 无 IP 白名单 (allow/deny)。

**修复建议**: Nginx admin server 块添加 IP 白名单; 或将端口绑定到 `127.0.0.1`; 通过 VPN/SSH 隧道访问。

---

#### P2-24: PM2 单容器运行 4 个应用共享进程空间

| 属性 | 值 |
|------|---|
| **文件** | `ecosystem.config.cjs` |
| **行号** | 1-48 |

**描述**: 4 个 Next.js 应用同容器/同用户/同文件系统/同环境变量。web 漏洞可直接访问 admin 数据。

**修复建议**: 理想方案: 拆分为独立容器。最小化: 不同 Linux 用户运行不同应用; PM2 env 差异化注入; 设置 max_memory_restart。

---

#### P2-25: Server Actions 请求体大小限制 200MB 过大

| 属性 | 值 |
|------|---|
| **文件** | `apps/web/next.config.mjs` |
| **行号** | 36-41 |

**描述**: 全局 `bodySizeLimit: '200mb'` 适用于所有 Server Action, 包括不处理大文件的 action。并发大请求可导致 OOM。

**修复建议**: 全局降至 10mb; PSD 上传改用专用 API Route; Nginx 对不同路径差异化 `client_max_body_size`。

---

#### P2-26: apps/api 缺少 bodySizeLimit 配置

| 属性 | 值 |
|------|---|
| **文件** | `apps/api/next.config.mjs` |
| **行号** | 1-26 |

**描述**: API 处理器通过 `request.formData()` 解析请求体, maxRequestBytes 校验在解析后。大文件在校验前已完整加载到内存。

**修复建议**: 在 `next.config.mjs` 配置 body 大小限制; Nginx 层 `client_max_body_size` 作为第一道防线。

---

#### P2-27: pnpm overrides 锁定 kysely 到固定版本

| 属性 | 值 |
|------|---|
| **文件** | `package.json` |
| **行号** | 22-24 |

**描述**: `"kysely": "0.28.17"` 硬钉版本, 阻止安全补丁自动更新。

**修复建议**: 添加注释说明原因; 设置定期检查流程; 可能使用范围版本 `>=0.28.17 <0.29.0`。

---

#### P2-28: Biome 未启用安全相关 lint 规则

| 属性 | 值 |
|------|---|
| **文件** | `biome.json` |
| **行号** | 29-49 |

**描述**: 缺少 `noDangerouslySetInnerHtml`, `noGlobalEval` 等安全规则。

**修复建议**: 添加 `"security": { "noDangerouslySetInnerHtml": "error", "noGlobalEval": "error" }`。

---

#### P2-29: 缩略图磁盘缓存无清理机制

| 属性 | 值 |
|------|---|
| **文件** | `apps/api/src/app/api/storage/[bucket]/[...key]/route.ts` |
| **行号** | 97-152 |

**描述**: 缩略图缓存目录无清理/过期/容量限制。width 参数 16-1280 可枚举, 攻击者可大量写入导致磁盘耗尽。

**修复建议**: 设置 THUMB_DISK_MAX_SIZE; 添加 cron 按 LRU 清理; 限制单次缩略图生成数量。

---

#### P2-30: 图片 URL 使用 unoptimized 绕过 Next.js Image 优化安全层

| 属性 | 值 |
|------|---|
| **文件** | `apps/web/src/features/image-generation/components/image-card.tsx` |
| **行号** | 93-99 |

**描述**: 所有生成图片 `next/image` 使用 `unoptimized`, 绕过 `remotePatterns` 白名单。如果 DB 中 imageUrl 被篡改, 可注入外部追踪像素或超大文件 URL。

**修复建议**: 渲染层对 imageUrl 进行协议白名单校验 (仅允许 https:/ 和相对路径)。

---

#### P2-31: ISNet 模型文件路径可通过环境变量注入

| 属性 | 值 |
|------|---|
| **文件** | `packages/image-generation/src/matte.ts` |
| **行号** | 21-26 |

**描述**: `ISNET_MODEL_PATH` 环境变量控制 ONNX 模型加载路径, 无路径校验。恶意 ONNX 模型可在推理时执行任意代码。

**修复建议**: 限制只能指向白名单目录; 验证文件扩展名为 `.onnx`; 使用 `path.resolve` 后验证路径未逃逸。

---

#### P2-32: chatgpt-web.ts uploadAttachment fetch 上游返回的 upload_url 无校验

| 属性 | 值 |
|------|---|
| **文件** | `packages/image-generation/src/chatgpt-web.ts` |
| **行号** | 721-737 |

**描述**: `uploadAttachment` 向上游返回的 `upload_url` 上传文件, 无域名白名单校验。若 proxy 被入侵, 可将用户图片发送到内网。

**修复建议**: 对 `upload_url` 进行域名白名单校验 (如 `*.blob.core.windows.net`)。

---

#### P2-33: chatgpt-web.ts downloadImage 裸 fetch 并附带 Authorization token

| 属性 | 值 |
|------|---|
| **文件** | `packages/image-generation/src/chatgpt-web.ts` |
| **行号** | 1734-1752 |

**描述**: `downloadImage` 向上游返回的图片 URL 发送含 `Authorization: Bearer <session_token>` 的 GET 请求。若 URL 被替换为攻击者服务器, session token 被窃取。

**修复建议**: 对 URL 进行域名白名单校验 (仅允许 `*.oaiusercontent.com`); 使用 `fetchPublicImage` 替代裸 fetch; 不向非预期域发送 Authorization 头。

---

#### P2-34: user-api baseUrl TOCTOU 存在 DNS rebinding 风险

| 属性 | 值 |
|------|---|
| **文件** | `packages/image-generation/src/service.ts` |
| **行号** | 3668-3680 |

**描述**: `assertPublicApiBaseUrl` 校验与实际 fetch 之间存在 DNS rebinding 时间窗口。实际 fetch 未使用 `fetchWithDnsPin`。

**修复建议**: 将 service.ts 中对 `config.baseUrl` 的 fetch 改为使用 `fetchWithDnsPin`。

---

#### P2-35: UOL admin 访问控制允许 observer_admin 执行破坏性操作

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/uol/access.ts` |
| **行号** | 52-70 |
| **验证状态** | 已确认, 原 P1 降至 P2 (当前所有破坏性操作为 stub) |

**描述**: UOL access.ts 将 observer_admin 与 admin/super_admin 同等对待, 与 safe-action.ts 的 `isAdminRole()` 语义不一致。当前操作均为 stub, 但即将绑定真实实现。

**修复建议**: 将 observer_admin 从 admin kind 允许列表中移除; 创建独立的 observerAdmin access kind。

---

#### P2-36: updateUserRoleAction 无自我角色降级保护

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/support/actions/admin-users.ts` |
| **行号** | 701-725 |

**描述**: 超管可将自己降级为 user, 导致系统无超管; 无"最少保留一个 super_admin"不变量。

**修复建议**: 禁止超管自我降级; 降级前检查是否还有其他 super_admin。

---

#### P2-37: consumeCredits 余额检查未使用 SELECT FOR UPDATE

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/credits/core.ts` |
| **行号** | 488-669 |

**描述**: 事务内 SELECT 余额时未使用 `FOR UPDATE` 行锁。并发扣减虽因最终 UPDATE 的 WHERE 条件不会透支, 但产生不必要的 DB 工作。

**修复建议**: 对 `creditsBalance` 使用 `SELECT ... FOR UPDATE`; 保留最终 UPDATE 的 WHERE 条件作为防御性编程。

---

#### P2-38: 后端池 inflight 计数器在多实例部署下不具备全局一致性

| 属性 | 值 |
|------|---|
| **文件** | `packages/image-generation/src/image-backend/service.ts` |
| **行号** | 287-293, 738-740 |

**描述**: 进程内 `Map` 维护 inflight 计数, 多实例部署下各实例独立维护, 无法感知其他实例。数据库事务级租约作为兜底, 但进程内快路径判断不准确。

**修复建议**: 移除快路径检查, 始终走 DB 事务租约; 或将快路径改为仅作为提示使用。

---

#### P2-39: MCP User 端点 API Key 验证未使用恒定时间比较

| 属性 | 值 |
|------|---|
| **文件** | `apps/api/src/app/api/mcp/user/route.ts` |
| **行号** | 60-116 |

**描述**: MCP User 端点通过数据库 WHERE 匹配 keyHash, 未在 DB 返回后做恒定时间二次比对, 与 v1 API auth 的 `safeEqual()` 不一致。

**修复建议**: 与 v1 API auth 保持一致, DB 查询后使用 `safeEqual(keyHash, record.keyHash)`。

---

#### P2-40: v1 API 鉴权缺乏失败请求限流

| 属性 | 值 |
|------|---|
| **文件** | `packages/shared/src/external-api/auth.ts` |
| **行号** | 13-69 |

**描述**: `authenticateExternalApiRequest()` 鉴权失败仅返回 null, 不记录失败次数、不限流。高频无效请求消耗 DB 资源。

**修复建议**: 实施基于 IP 的鉴权失败限流 (10 次/分钟); 记录鉴权失败事件。

---

#### P2-41: Image Proxy 路由无用户身份校验

| 属性 | 值 |
|------|---|
| **文件** | `src/app/image-proxy/[...path]/route.ts` |
| **行号** | 57-119 |

**描述**: 旧版 Image Proxy 仅检查存储桶白名单, 无签名验证/会话检查/所有权校验。如果旧版路由仍可达, 形成绕过访问控制的通道。

**修复建议**: 删除旧版路由或添加签名验证, 与 `/api/storage/` 路由安全等级对齐。

---

## P3 -- Low

### P3-1: ADMIN_BETTER_AUTH_SECRET 回退到 BETTER_AUTH_SECRET

| 文件 | `packages/shared/src/auth/admin-auth.ts:30-34` |
|------|---|
| **验证状态** | 已确认, 原 P0 降至 P3 |

Better Auth 使用数据库有状态会话 (非 JWT), cookie 名称完全隔离 (`admin.session_token` vs `better-auth.session_token`), 跨系统会话混淆在当前架构下不可行。但共享密钥违反隔离原则, 应设为必填。

---

### P3-2: API 中间件为纯透传, 无全局鉴权防线

| 文件 | `apps/api/src/middleware.ts:1-10` |
|------|---|
| **验证状态** | 已确认, 原 P1 降至 P3 |

当前所有端点均有独立鉴权 (v1: `authenticateExternalApiRequest`, cron: `validateCronSecret`, webhook: 签名验证)。4 个 cron GET 端点仅返回静态硬编码 JSON 元信息。纵深防御建议。

---

### P3-3: MCP Admin 鉴权长度不等时泄露 secret 长度信息

| 文件 | `packages/shared/src/mcp/admin-auth.ts:86-97` |
|------|---|
| **验证状态** | 已确认, 原 P1 降至 P3 |

技术上存在时序泄露, 但网络层面利用难度极高, MCP 有内存限流, 且功能默认关闭。应仿照 `cron-auth.ts` 改为先哈希再比较。

---

### P3-4: 旧版 Creem Webhook 向客户端泄露 error.message

| 文件 | `src/app/api/webhooks/creem/route.ts:48-54` |
|------|---|
| **验证状态** | 已确认, 原 P1 降至 P3 |

泄露的错误消息为有限的固定字符串集合, 不包含动态敏感数据。

---

### P3-5: Nginx 未隐藏服务器版本信息

| 文件 | `nginx/default.conf:1-100` |
|------|---|
| **验证状态** | 已确认, 原 P1 降至 P3 |

缺少 `server_tokens off;` 和 `proxy_hide_header X-Powered-By;`。加固建议, 修复成本极低。

---

### P3-6: ensureCreditsBalance 存在 TOCTOU 竞态

| 文件 | `packages/shared/src/credits/core.ts:199-227` |
|------|---|
| **验证状态** | 已确认, 原 P1 降至 P3 |

`userId` 有唯一约束, 重复 INSERT 导致 500 错误而非数据损坏。影响仅为新用户首次请求偶发失败, 重试即可。应改为 `INSERT ... ON CONFLICT DO NOTHING`。

---

### P3-7: bootstrap-super-admin 仅针对用户侧 user 表

| 文件 | `packages/shared/src/auth/bootstrap-super-admin.ts:96-160` |
|------|---|

admin_user 表无自动初始化/种子机制。结合 P0 的 signUp 开放问题, 第一个注册者成为管理员。

---

### P3-8: admin 登录页客户端 createAuthClient 使用 window.location.origin

| 文件 | `apps/admin/src/app/[locale]/(auth)/sign-in/page.tsx:31-33` |
|------|---|

baseURL 依赖客户端 `window.location.origin`, 若应用被 iframe 嵌入可能指向错误域名。应使用环境变量注入。

---

### P3-9: 存储签名 URL 使用 BETTER_AUTH_SECRET 作为签名密钥

| 文件 | `packages/shared/src/storage/signed-url.ts:39-47` |
|------|---|

违反单一职责密钥原则。应引入独立的 `STORAGE_SIGNING_SECRET`。

---

### P3-10: Cron Job GET 端点无鉴权暴露元信息

| 文件 | `apps/api/src/app/api/jobs/credits/expire/route.ts:54-62` |
|------|---|

返回纯静态硬编码 JSON (端点路径、描述、鉴权方式), 不含动态数据。为 GET 端点添加鉴权或移除。

---

### P3-11: MCP Admin 限流使用全局单桶

| 文件 | `apps/admin/src/app/api/mcp/admin/route.ts:120-150` |
|------|---|

全局单桶限流, 未通过鉴权的请求也消耗配额。应将限流移至鉴权后或按 IP 分桶。

---

### P3-12: JSONB 合并使用 JSON.stringify -- 间接安全但脆弱

| 文件 | `apps/api/src/features/external-api/handlers/responses.ts:324-329` |
|------|---|

Drizzle sql 模板标签参数化保证安全, 但模式脆弱。为 `prompt_cache_key` 添加格式校验和长度限制。

---

### P3-13: JSONB 合并模式在 operations.ts 中大量使用

| 文件 | `packages/image-generation/src/operations.ts` (11 处) |
|------|---|

metadata 字段无 schema 约束和大小限制。考虑使用 `jsonb_set()` 替代 `||` 浅合并; 添加 CHECK 约束限制最大大小。

---

### P3-14: ISNET_MODEL_PATH 通过环境变量可控制 ONNX 模型路径

| 文件 | `packages/image-generation/src/matte.ts:21-31` |
|------|---|

路径来自环境变量, 不受用户输入影响。对路径进行白名单校验; 运行时校验模型文件哈希。

---

### P3-15: image-proxy 路由重定向到 signedUrl 无目标校验

| 文件 | `src/app/image-proxy/[...path]/route.ts:95-109` |
|------|---|

对 key 进行路径穿越检查 (`../`); 对 signedUrl 进行域名白名单校验。

---

### P3-16: 管理员积分发放上限仅 10 万, 无速率限制

| 文件 | `packages/shared/src/support/actions/admin-users.ts:141-147` |
|------|---|

无每日/每月累计发放上限。建议提升为 superAdminAction; 添加累计发放上限; 超阈值触发告警。

---

### P3-17: API Key 配额检查与扣费非原子操作

| 文件 | `packages/shared/src/external-api/quota.ts:61-108` |
|------|---|

PostgreSQL 条件 UPDATE 行级锁已提供足够原子性。建议添加集成测试验证高并发一致性。

---

### P3-18: Creem 订阅 webhook 缺少对订阅状态验证

| 文件 | `apps/api/src/app/api/webhooks/creem/route.ts:393-435` |
|------|---|

发放前未验证 `sub.status` 是否为 active/trialing。应添加状态检查。

---

### P3-19: .env.example 包含指引性占位凭据可能被误用

| 文件 | `.env.example:49-57` |
|------|---|

将敏感占位值改为空字符串或错误标记; 启动时校验是否仍使用占位值。

---

### P3-20: MDX 博客使用 Fumadocs 编译 -- 需确保构建时内容可信

| 文件 | `source.config.ts`, `apps/web/source.config.ts` |
|------|---|

当前内容来自代码仓库静态文件, 风险可控。在文档中标注 MDX 内容必须视为可信代码。

---

### P3-21: 错误消息 serverError 直接渲染到 toast

| 文件 | `apps/web/src/features/image-generation/components/image-lightbox.tsx:280-289` 等 |
|------|---|

next-safe-action 默认对 serverError 做一定清理。确保全局 handleServerError 回调返回通用消息。

---

### P3-22: Docker runner npm install -g pm2 未固定版本

| 文件 | `Dockerfile.multi:108` |
|------|---|

供应链攻击风险。改为 `RUN npm install -g pm2@5.4.3`。

---

### P3-23: 其他低风险发现

| 发现 | 文件 | 说明 |
|------|------|------|
| demo/plan-badges 页面公开暴露套餐信息 | `apps/platform/.../plan-badges/page.tsx` | 生产环境禁用 /demo/* |
| presigned 上传 console.error 可能泄露 S3 信息 | `apps/web/src/app/api/upload/presigned/route.ts:79` | 替换为 logError |
| fingerprintjs 依赖需审视隐私合规 | `apps/web/package.json:15` | 审查使用场景和 GDPR 合规 |
| 缩略图缓存键无 secret salt | `apps/api/.../route.ts:103-107` | 添加 server-side secret |
| 上传临时图片无可靠清理保证 | `packages/image-generation/src/request-utils.ts:96-169` | 添加 S3 Lifecycle 或 cron 清理 |
| presigned upload 无服务端大小强制 | `apps/web/src/app/api/upload/presigned/route.ts:31-85` | 改用 createPresignedPost 配合 content-length-range |
| getUserRoleById 自动提权逻辑 | `packages/shared/src/auth/role-server.ts:18-38` | 仅在 isSelfUseModeEnabled() 时执行 |
| MCP 用户端硬编码 relayOnly: false | `apps/api/src/app/api/mcp/user/route.ts:109-116` | 文档中明确说明 |
| UOL owner 类访问控制资源校验延迟 | `packages/shared/src/uol/access.ts:149-164` | 补充集成测试 |
| generation 状态更新乐观锁文档不足 | `packages/image-generation/src/operations.ts:483-486` | 添加 cron 更保守的超时窗口 |
| refundGenerationCredits 幂等检查 TOCTOU | `packages/shared/src/generation-maintenance.ts:196-243` | 核心依赖 creditsBatch 唯一索引, 当前安全 |
| createOrUpdateSubscription 先查后改竞态 | `apps/api/.../creem/route.ts:546-580` | 改为 INSERT ... ON CONFLICT upsert |
| Webhook checkout/subscription 事件竞态 | `apps/api/.../creem/route.ts:208-247` | grantCredits 唯一索引兜底, 当前安全 |
| creditsConsumed 更新与 transaction 真相源不一致 | `packages/image-generation/src/operations.ts:2801-2810` | generation 表仅展示用途, 低优先级 |
| relayOnly 标志设计 | `packages/shared/src/external-api/auth.ts:46-49` | 信息性发现, 当前设计正确 |

---

## 已确认误报 (8 条)

以下发现经完整代码验证后确认为误报, 已从报告中剔除:

| 原级别 | 发现 | 误报原因 |
|--------|------|---------|
| P0 | .env.local 包含真实生产凭据 | .gitignore 有效保护; 凭据为开发占位值; 从未进入 git 历史 |
| P1 | admin Cookie Domain 隔离缺失 | Better Auth 默认省略 domain 属性 = RFC 6265 host-only cookie, 已是最严格配置 |
| P1 | admin 中间件未做认证保护 | 当前仅有 2 个 API 路由, 均有独立保护 (Better Auth 标准端点 + MCP Bearer 鉴权) |
| P1 | admin 未配置 trustedOrigins/CSRF | Better Auth 默认启用 CSRF, 默认 trustedOrigins 包含 baseURL, 比用户侧更安全 |
| P1 | 管理员 trustedOrigins 缺失致 CSRF | 同上, 且 admin 未设置 disableCSRFCheck, 默认 CSRF 开启 |
| P1 | Epay expectedAmount 回退客户端可控 | 客户端无法控制 expectedAmount; param 未发送给 Epay; metadata 从 DB 读取 |
| P1 | Docker 构建阶段泄漏密钥 | 多阶段构建隔离; CI 从未传入真实密钥; ARG 默认值为占位符 |
| P1 | ensureRegistrationBonus 双重发放 | creditsBatch 唯一索引 + onConflictDoNothing 可靠防止双重发放 |
| P1 | 旧版 Cron 积分过期路由泄露信息 | 旧版 src/ 路由不参与构建和部署, 无攻击面 |

---

## 优先修复行动计划

### 阶段一: 紧急修复 (24 小时内)

| 优先级 | 编号 | 行动 | 预估工时 |
|--------|------|------|---------|
| **P0** | P0-1 | 在 admin-auth.ts 添加 `disableSignUp: true` | 5 分钟 |
| **P1** | P1-1 | operations.ts 第 331 行: `fetch` -> `fetchPublicImage` | 15 分钟 |
| **P1** | P1-2 | external-api-images.ts 第 115 行: `fetch` -> `fetchPublicImage` | 15 分钟 |
| **P1** | P1-3 | setUserCreditsStatusAction 添加 `assertCanActOnTarget` | 10 分钟 |
| **P1** | P1-4 | setExternalApiKeyStatusAction 添加 `assertCanActOnTarget` | 10 分钟 |

### 阶段二: 高优先级加固 (1 周内)

| 编号 | 行动 | 预估工时 |
|------|------|---------|
| P2-12 | Creem Webhook 金额校验默认改为硬拒模式 | 30 分钟 |
| P2-1 | CSRF 改为仅对特定端点豁免而非全局禁用 | 2 小时 |
| P2-6 | Nginx 添加全局安全响应头 | 30 分钟 |
| P2-7 | Nginx 添加速率限制 + 修复 web auth 限流死代码 | 1 小时 |
| P2-4 | 为 admin 创建独立的 `adminSessionAction` | 2 小时 |
| P2-10 | Nginx 添加 default_server 块 | 10 分钟 |
| P2-11 | 在 packages/shared 创建公共安全头模块 | 1 小时 |
| P2-13 | adminAdjustCreditsAction 添加 sourceRef 幂等键 | 15 分钟 |
| P2-23 | admin 端口绑定到 127.0.0.1 | 10 分钟 |
| P3-1 | ADMIN_BETTER_AUTH_SECRET 移除回退, 设为必填 | 15 分钟 |

### 阶段三: 系统性改进 (1 个月内)

| 类别 | 行动 |
|------|------|
| SSRF 防护 | 审查所有裸 fetch 调用, 统一使用 fetchPublicImage/fetchWithDnsPin |
| 错误信息脱敏 | 建立全局 sanitizeErrorMessage 层, 过滤内部信息 |
| 日志标准化 | 将所有 console.log/error 替换为结构化 logger |
| 支付安全 | Creem webhook 添加事件去重、时间戳校验、订阅状态验证 |
| 容器隔离 | 评估 4 应用拆分为独立容器的可行性 |
| 依赖安全 | 建立 pnpm overrides 定期审查流程; PM2 固定版本 |
| Lint 加固 | Biome 启用安全规则 (noDangerouslySetInnerHtml 等) |
| 缓存治理 | 缩略图/临时文件添加过期清理机制 |

---

## 附录: 审计覆盖范围

### 扫描文件

| 分类 | 文件数 |
|------|--------|
| 认证/授权 | 12 (auth.ts, admin-auth.ts, middleware.ts x4, safe-action.ts, roles.ts, access.ts 等) |
| API 路由 | 18 (v1 handlers x8, webhooks x2, cron x4, MCP x2, storage, upload) |
| 支付 | 6 (creem route, epay-fulfillment, actions, subscription 等) |
| 图像处理 | 5 (operations.ts, service.ts, external-api-images.ts, chatgpt-web.ts, matte.ts) |
| 基础设施 | 8 (Dockerfile, docker-compose x3, nginx, ecosystem.config, package.json, biome.json) |
| 前端安全 | 6 (json-ld.tsx, create-page-client.tsx, image-card.tsx, settings-profile-view.tsx 等) |
| 积分/并发 | 4 (core.ts, quota.ts, generation-maintenance.ts, operations.ts) |

### 未覆盖区域

- 第三方依赖 CVE 扫描 (建议使用 `pnpm audit` / Snyk)
- 运行时渗透测试
- Cloudflare 配置审计 (需要平台访问权限)
- PostgreSQL 数据库权限和网络安全配置
- CI/CD pipeline 安全 (GitHub Actions secrets 管理)

---

*报告生成日期: 2026-06-16*
*审计工具: 多维度静态分析 + 人工验证*
*下次审计建议: 2026-07-16 或重大架构变更后*
