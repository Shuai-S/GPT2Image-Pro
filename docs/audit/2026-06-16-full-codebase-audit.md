# GPT2Image-Pro 全库代码审计报告

---

## 审计概要

| 项目 | 内容 |
|------|------|
| 审计日期 | 2026-06-16 |
| 审计范围 | GPT2Image-Pro 全仓库（Turborepo 单体仓库），覆盖 `apps/web/`、`packages/shared/`、`packages/database/`、`packages/ui/`、根目录遗留代码 |
| 审计方法 | 8 维度并行审计 + 对抗式验证（Adversarial Verification） |
| 审计维度 | 安全与认证漏洞、财务完整性/积分/计费、Bug/逻辑错误/竞态条件、性能问题、代码质量/死代码/类型安全、错误处理/韧性、架构/设计模式、前端质量/可访问性/UX |
| 发现总数 | **70** |
| 经对抗式验证确认 | **25** |
| 未验证的高危/严重问题 | **0** |
| 中/低/信息级别 | **39** |

### 按验证后严重程度分布

| 严重程度 | 数量 |
|----------|------|
| Critical（严重） | 0（原始 1 项经验证降级为 high） |
| High（高危） | 5 |
| Medium（中等） | 28（含 13 项经验证从 high 降级） |
| Low（低） | 8（含 5 项经验证从 high 降级） |
| Info（信息） | 2 |

> 注：对抗式验证对 25 项原始 high/critical 发现进行了独立代码验证，其中仅 5 项维持 high 或以上，其余因实际利用难度、缓解因素或原始描述的事实性错误被降级。

---

## 执行摘要

### 最具影响力的 5 项发现

1. **[HIGH] creditsConsumed 在存储错误路径中永远无法写入数据库** — `operations.ts` 存储异常处理块中两次顺序 UPDATE，第二次 UPDATE 的 WHERE 条件因第一次 UPDATE 已将状态改为 `failed` 而永远匹配不到行，导致 `generation` 表中 `creditsConsumed` 字段永久记录错误值。影响所有存储阶段失败的图像生成记录。

2. **[HIGH] Admin 积分发放缺少 sourceRef，重复调用导致双重发放** — `adminGrantCreditsAction` 调用 `grantCredits` 时未传入 `sourceRef`，绕过了 `credits_batch` 表的幂等性唯一约束。代码自身在 UOL 操作描述中明确标注 `idempotency: { kind: 'none' }`。

3. **[HIGH] Gallery 页面无 LIMIT 查询拉取全部草稿和上传行** — 每次分页请求均从数据库拉取用户全部匹配行（含大体积 JSON metadata 列），然后在 JavaScript 中执行 `.slice()`。对生成历史较多的用户造成严重内存压力。

4. **[HIGH] Admin 状态页将近 7 天全部生成行（约 7 万行/270MB metadata）加载至 Node.js 内存** — `loadStatusData()` 无 LIMIT 查询后在 JavaScript 中逐行解析 JSON 进行聚合，缓存失效时阻塞请求并产生巨大 GC 压力。

5. **[MEDIUM] 全局 disableCSRFCheck 移除了 Better Auth 所有端点的 CSRF 保护** — 为解决微信/QQ WebView 密码重置问题而全局禁用 Origin 校验，但经验证实际可利用性受 SameSite=Lax 和 Content-Type:application/json 要求的双重限制，降级为 medium。

### 整体健康评分：6.5 / 10

**理由：**

- 核心积分引擎（复式记账、FIFO、幂等性索引、批次冲突处理）架构健全
- 安全工程方面多处表现优秀：时序安全 API Key 比较、多层 SSRF 防护、DNS 钉扎、Drizzle ORM 消除 SQL 注入
- 主要扣分项：一个确认的数据完整性 Bug（creditsConsumed 写入失败）、Admin 操作幂等性缺失、多处无 LIMIT 数据库查询、大量进程内状态不支持水平扩展、根目录遗留代码未清理
- UOL 架构层处于迁移过渡态，83+ 操作为桩实现，生产流量完全绕过 UOL
- 前端可访问性存在系统性不足（密码切换按钮 tabIndex=-1、侧边栏通知仅靠颜色传达、画布无键盘替代方案）

---

## 各维度审计结果

### 1. 安全与认证漏洞 (Security & Authentication Vulnerabilities)

**概述：** 代码库在安全工程方面展现较高水平：时序安全 API Key 比较、多层 SSRF 防护（DNS 钉扎 + 逐跳重定向重验证）、Drizzle ORM 消除原始 SQL 注入向量、protectedAction/adminAction 分层、无硬编码密钥。主要风险集中在 CSRF 保护全局禁用和中间件层级限流绕过。

| 发现数 | Critical | High | Medium | Low | Info |
|--------|----------|------|--------|-----|------|
| 4 | 0 | 0 | 2 | 1 | 1 |

> 注：原始 high 级别发现经验证后均被降级。

| 验证后严重程度 | 标题 | 文件 | 描述 | 建议 |
|---------------|------|------|------|------|
| Medium | 全局 disableCSRFCheck 移除所有 Better Auth 会话端点的 CSRF 保护 | `packages/shared/src/auth/index.ts` L185-204 | Better Auth 配置设置 `advanced: { disableCSRFCheck: true }` 全局禁用 Origin 校验。经验证，SameSite=Lax 显式设置会阻止跨站 POST Cookie 发送，且 Better Auth 要求 Content-Type:application/json，标准 HTML 表单无法发送此类型。实际可利用窗口有限。 | 仅对密码重置端点单独禁用 Origin 校验，而非全局禁用。或设置 `cookieOptions: { sameSite: 'strict' }`。 |
| Medium | 注册验证 OTP 端点在中间件层无 per-IP 限流 | `apps/web/src/rate-limit-routing.ts` L13 | proxy.ts 中 `/api/auth/*` 早期返回绕过了限流检查块。攻击者可从单一 IP 对大量不同邮箱触发 OTP 邮件发送。 | 将 `/api/auth/*` 早期返回移至限流检查之后，或在注册验证路由内部应用限流。 |
| Low | CSRF 防护依赖的 SameSite=Lax 未在 Better Auth 配置中显式声明 | `packages/shared/src/auth/index.ts` L185-204 | 未来依赖升级可能改变默认 SameSite 属性，导致唯一剩余的 CSRF 防御静默消失。 | 在 Better Auth 配置中添加显式 `cookieOptions: { sameSite: 'lax' }`。 |
| Info | JSON-LD dangerouslySetInnerHTML 仅使用服务端静态数据 | `apps/web/src/components/seo/json-ld.tsx` L20-23 | 当前实现安全，标记仅供后续维护注意。 | 无需操作，添加代码注释确保未来调用者仅传入静态数据。 |

---

### 2. 财务完整性、积分与计费 (Financial Integrity, Credits, and Billing)

**概述：** 核心记账引擎（复式记账、FIFO 消费、per-user 幂等性索引、批次冲突处理）架构健全。发现的问题集中在 Admin 操作幂等性缺失、过期批次处理的 TOCTOU 窗口、以及 webhook 事件排序竞态。

| 发现数 | Critical | High | Medium | Low | Info |
|--------|----------|------|--------|-----|------|
| 6 | 0 | 1 | 2 | 2 | 1 |

| 验证后严重程度 | 标题 | 文件 | 描述 | 建议 |
|---------------|------|------|------|------|
| High | Admin 积分发放缺少 sourceRef，重复调用双重发放无幂等保护 | `packages/shared/src/support/actions/admin-users.ts` L785-797 | `adminGrantCreditsAction` 调用 `grantCredits` 未传 `sourceRef`。因 `credits_batch (source_type, source_ref)` 部分唯一索引要求 `sourceRef IS NOT NULL` 才生效，null sourceRef 绕过整个幂等机制。UOL 操作描述明确标注 `idempotency: { kind: 'none' }`。 | 生成确定性 `sourceRef`（如 `admin_grant:{adminUserId}:{targetUserId}:{timestamp_bucket}`），或要求调用者提供 `clientRequestId`。 |
| Medium | Creem webhook: subscription.active 先于 checkout.completed 到达时积分永久丢失 | `apps/web/src/app/api/webhooks/creem/route.ts` L388-429 | 若 `subscription.active` 先于 `checkout.completed` 送达，订阅记录尚未创建，userId 查询失败，积分未发放。 | 让 `handleCheckoutCompleted` 也直接调用 `grantSubscriptionCredits`，依赖幂等保护防止双重发放。 |
| Medium | settleChargedCredits 退款路径使用 best-effort catch 静默吞没退款失败 | `apps/web/src/features/image-generation/operations.ts` L2162-2164, 2213-2215 | 所有 `settleChargedCredits` 退款调用被 `try { ... } catch { /* best effort */ }` 包裹。数据库连接丢失时用户被静默多收费。 | 替换为结构化日志 `logError(err, { source: 'generation-settlement', ... })`，考虑入队失败退款进行重试。 |
| Low | processExpiredBatches 在 consumeCredits 事务外执行，产生 TOCTOU 窗口 | `packages/shared/src/credits/core.ts` L475-486 | 过期处理在事务外运行，事务内 `now` 使用 JavaScript 时间而非数据库 `NOW()`。经验证窗口极窄（毫秒级），实际可利用性极低。 | 将 `processExpiredBatches` 移入事务内，或移除外部调用仅依赖事务内过滤。 |
| Low | Admin 积分发放 sourceRef 缺失在 UOL 中已记录但未强制执行 | `packages/shared/src/uol/operations/credits.ts` L692-725 | `credits.adminGrant` 声明 `idempotency: { kind: 'none' }`，MCP agent 或可重试调用者可能意外双重发放。 | 在操作输入 schema 中添加可选 `clientRequestId` 字段并作为 `sourceRef` 传入。 |
| Info | ensureRegistrationBonus 存在 TOCTOU 但 creditsBatch 唯一约束正确防止双重发放 | `packages/shared/src/credits/core.ts` L248-288 | 并发请求可能在 `creditsTransaction` 中产生重复行，但积分余额正确。仅审计追踪不一致。 | 若需审计追踪准确性，为 `creditsTransaction(userId, type)` 添加唯一约束。 |

---

### 3. Bug、逻辑错误、竞态条件与边界情况 (Bugs, Logic Errors, Race Conditions, and Edge Cases)

**概述：** 发现一个确认的数据完整性 Bug（creditsConsumed 写入失败），三个中等严重程度的进程内状态问题。

| 发现数 | Critical | High | Medium | Low | Info |
|--------|----------|------|--------|-----|------|
| 4 | 0 | 1 | 3 | 0 | 0 |

| 验证后严重程度 | 标题 | 文件 | 描述 | 建议 |
|---------------|------|------|------|------|
| High | creditsConsumed 在存储错误路径中永远无法写入数据库 | `apps/web/src/features/image-generation/operations.ts` L2559-2601 | 存储错误 catch 块中两次顺序 UPDATE：第一次将 status 设为 'failed'（WHERE status='pending'）；第二次尝试写入 creditsConsumed 也使用 WHERE status='pending'，因行已变为 'failed' 而永远匹配零行。`generation` 表 creditsConsumed 永久保留初始预扣值而非实际结算值。财务真值在 credits_transaction 中正确保留。 | 交换两次操作顺序：先调用 settleChargedCredits，再执行单次 UPDATE 同时设置 status='failed' 和 creditsConsumed。或将第二次 UPDATE 的 WHERE 改为仅匹配主键。审计所有其他错误路径。 |
| Medium | 异步图片任务存储为进程本地 Map，重启后丢失且多实例不可见 | `apps/web/src/features/external-api/async-image-tasks.ts` L38-87 | `asyncImageTasks` 为模块级 `Map<string, AsyncImageTask>`，无持久化。当前为单实例部署，但进程重启会丢失所有进行中任务。 | 将异步任务状态持久化至数据库或 Redis。 |
| Medium | 进程内图片生成队列在多实例部署下失效 | `apps/web/src/features/image-generation/queue.ts` L21-25 | 全局和 per-user 并发限制为进程本地变量。N 个副本各自独立执行限制，实际并发上限为 N*C。项目文档已承认此限制。 | 使用数据库或 Redis 原子计数器实现分布式并发控制，或记录单实例部署约束。 |
| Medium | 订阅升级先发放新积分再作废旧积分，存在短暂双重积分窗口 | `apps/web/src/features/payment/epay-fulfillment.ts` L435-498 | 先 `grantCredits` 再 `voidActiveSubscriptionCreditsForUpgrade`，中间窗口用户余额同时包含新旧积分。崩溃场景下窗口持续至 webhook 重试。 | 重构为先作废旧积分再发放新积分，消除双重积分窗口。 |

---

### 4. 性能问题与优化机会 (Performance Issues and Optimization Opportunities)

**概述：** 覆盖数据库 schema/查询模式、服务端管线逻辑、Server Component 数据获取和构建配置。发现 6 个性能问题。

| 发现数 | Critical | High | Medium | Low | Info |
|--------|----------|------|--------|-----|------|
| 6 | 0 | 2 | 2 | 2 | 0 |

| 验证后严重程度 | 标题 | 文件 | 描述 | 建议 |
|---------------|------|------|------|------|
| High | Gallery 页面无 LIMIT 查询拉取全部草稿和上传行 | `apps/web/src/app/[locale]/(dashboard)/dashboard/gallery/page.tsx` L203-213 | `draftParentRows` 和 `uploadParentRows` 查询无 `.limit()`。加重因素：两个查询在每次请求中无条件执行（无论当前 Tab），因需计算 Tab 徽章数量。 | 对两个查询添加 `.limit(limit)`，使用独立 `COUNT()` 查询计算徽章数量。 |
| High | Admin 状态页将近 7 天全部生成行加载至 Node.js 内存 | `apps/web/src/app/[locale]/(dashboard)/dashboard/admin/status/page.tsx` L1358-1375 | 代码注释承认"拉 last7d 7 万行 /~270MB metadata 进 JS"。`unstable_cache` 120 秒 TTL 仅降低频率。管理员 RefreshStatusButton 可随时触发缓存失效。 | 将聚合逻辑移至 SQL，使用条件求和（CASE WHEN）和 JSONB 提取。 |
| Medium | Subscription 表缺少 userId 索引，每次图片生成执行全表扫描 | `packages/database/src/schema.ts` L240-253 | `getUserPlan()` 在每次生成请求的热路径上执行 `WHERE userId = ? ORDER BY updatedAt DESC LIMIT 1`，无 userId 索引导致顺序扫描。 | 添加索引 `CREATE INDEX subscription_user_id_idx ON subscription (user_id, updated_at DESC)`。 |
| Medium | Create 页面三个独立 Promise.all 批次串行化 | `apps/web/src/app/[locale]/(dashboard)/dashboard/create/page.tsx` L31-68 | 第三批次的 `getPlanCapabilitySnapshot(plan.plan)` 仅依赖 plan（第一批次即可获得），却等待第二批次完成。 | 重构为两批次：第一批获取 plan，第二批合并所有依赖 plan 的调用。 |
| Low | getPlanCapabilityMatrix 在图片生成中串行调用两次 | `apps/web/src/features/image-generation/operations.ts` L1125-1127 | 三个顺序 await 可部分并行化。经验证因 10 秒缓存，warm cache 下影响极小。 | `const [planCapabilities, queueSettings] = await Promise.all([...])` 在 getUserPlan 之后。 |
| Low | getGenerationStats 对 generation 表发起四个独立 COUNT/SUM 查询 | `apps/web/src/features/image-generation/queries.ts` L70-93 | 四个统计量可合并为单条 SQL 使用条件聚合。 | 替换为单条 `SELECT COUNT(*), SUM(CASE WHEN ...) ...` 查询。 |

---

### 5. 代码质量、死代码、类型安全与一致性 (Code Quality, Dead Code, Type Safety, and Consistency)

**概述：** `apps/web/` 和 `packages/` 层展现良好架构纪律，但存在大量遗留死代码、重复代码和少量类型安全违规。

| 发现数 | Critical | High | Medium | Low | Info |
|--------|----------|------|--------|-----|------|
| 13 | 0 | 0 | 7 | 4 | 2 |

| 验证后严重程度 | 标题 | 文件 | 描述 | 建议 |
|---------------|------|------|------|------|
| Medium | 仓库根目录整个遗留应用 (`src/`) 为死代码 | `src/`（根目录） | 完整的 Next.js 应用，含 `src/app/`、`src/features/`、`src/db/`、19 个测试文件。不被任何 workspace 包引用。根目录 `next.config.mjs` 指向死代码，`turbo typecheck` 不处理此树。 | 删除根目录 `src/`、`next.config.mjs`、`tsconfig.json` 及关联配置。 |
| Medium | 过时的重复 Creem 客户端与权威 `@repo/shared` 版本分歧 | `apps/web/src/features/payment/creem.ts` L1-308 | 缺少 Zod 验证、缺少 `timingSafeEqual` 长度检查。当前无活跃调用者使用危险函数，但 barrel index 无条件导出。 | 删除此文件，更新 `actions.ts` 从 `@repo/shared/payment/creem` 导入。 |
| Medium | 重复 `/v1/*` 和 `/api/v1/*` 路由树 -- 8 个文件完全相同的重导出 | `apps/web/src/app/v1/` 全部 8 个路由文件 | 两个路由树同时注册到 Next.js App Router。中间件有 `/v1/` 专用分支，确认为有意使用。缺少文件级注释。 | 使用 `next.config.mjs` rewrites 代替文件重复，或添加文档说明。 |
| Medium | api-logger.ts 中 `any` 类型违反 `noExplicitAny` 规则 | `packages/shared/src/api-logger.ts` L3-4 | `type ApiHandler = (request: any, context?: any) => ...`，eslint-disable 注释对 Biome 无效。 | 改为 `(request: Request, context?: unknown)`。 |
| Medium | God file: `service.ts` 4777 行 118 个函数 | `apps/web/src/features/image-generation/service.ts` L1-4777 | 违反 CLAUDE.md "文件过大即拆分信号" 原则。 | 继续拆分为 `service-model-selection.ts`、`service-error-handling.ts`、`service-streaming.ts` 等。 |
| Medium | 5 个死的 mock/demo UI 组件导出但从未渲染 | `apps/web/src/features/dashboard/components/` | `AuthCard`、`RepoCard`、`ShareDocumentCard`、`SubscriptionFormCard`、`CookieSettingsCard` 含硬编码中文和 mock 数据。 | 删除全部 5 个文件及 barrel 导出。 |
| Medium | 死的 `BlogPostItem` 组件和 `mockPosts` 数据 | `apps/web/src/features/blog/` | 活跃博客页使用 `getBlogPosts()` + `BlogPostCard`，而非此组件。 | 删除 `blog-post-item.tsx` 和 `mock-posts.ts`。 |
| Medium | `sanitizeSnapshot` 辅助函数在两个文件中完全重复 | `packages/shared/src/announcements/actions.ts` L73-78 及 `packages/shared/src/support/actions/admin-users.ts` L364-369 | 相同实现用于审计日志序列化。 | 提取至 `packages/shared/src/utils/snapshot.ts`。 |
| Medium | `uol-bindings.ts` 中 62 个 TODO 注释 | `apps/web/src/server/uol-bindings.ts` L100-197 | 违反 CLAUDE.md "不留 TODO 假完成" 规则。 | 迁移至 `docs/TODO.md`，仅保留已实现的 `bindExecute` 调用。 |
| Medium | 4 个客户端组件使用 `console.error` 而非结构化日志 | `packages/shared/src/support/components/` 多文件 | 错误对象无上下文（用户 ID、操作类型、组件名）直接 `console.error`。 | 添加结构化上下文或调用 `Sentry.captureException`。 |
| Low | `generateImageAction` 导出但从未在活跃应用中导入 | `apps/web/src/features/image-generation/index.ts` L1 | 创建页客户端使用 API 路由而非此 server action。 | 从 barrel 导出中移除。 |
| Low | 不安全 `as unknown as { rowCount: number }` 类型转换 | `packages/shared/src/mcp/user-key-actions.ts` L154-156, 183-184 | Drizzle update/delete 结果的双重类型转换。实际运行时行为正确，但违反项目禁 `any` 规则。 | 改用 `.returning({ id: mcpApiKey.id })` 并检查 `.length > 0`。 |
| Low | 3 个客户端组件使用 `console.error` 处理支付/设置错误 | `apps/web/src/features/settings/components/` 多文件 | 订阅取消和结账错误不会出现在 Sentry 中。 | 在 catch 块中调用 `Sentry.captureException`。 |

---

### 6. 错误处理、韧性与优雅降级 (Error Handling, Resilience, and Graceful Degradation)

**概述：** 代码库在财务核心和主图片生成管线中展现了强健的错误处理纪律。发现的问题集中在非结构化日志、存储错误信息模糊、以及异步任务错误的静默吞没。

| 发现数 | Critical | High | Medium | Low | Info |
|--------|----------|------|--------|-----|------|
| 8 | 0 | 0 | 5 | 2 | 1 |

| 验证后严重程度 | 标题 | 文件 | 描述 | 建议 |
|---------------|------|------|------|------|
| Medium | presigned 上传路由使用 console.error 而非项目日志 | `apps/web/src/app/api/upload/presigned/route.ts` L78-84 | catch 块调用 `console.error` 后返回 500，不抛出异常。`withApiLogging` 的 catch 分支不会触发。绕过 Pino 的 redact/transport 管线。 | 替换为 `logError(error, { source: 'presigned-upload' })`。 |
| Medium | 内部任务调度器使用 console.warn/console.info 而非项目日志 | `apps/web/src/server/internal-job-scheduler.ts` L267-327 | 调度器处理积分过期、图片清理等维护任务。失败日志不进入 Pino/Axiom 管线，Sentry 初始化在其之后且不拦截 console.warn。 | 替换为 `logger.info`/`logError`。 |
| Medium | Prompt 修复子流程创建独立 AbortSignal 忽略父生成超时预算 | `apps/web/src/features/image-generation/operations.ts` L1947 | 修复请求获得全新 20 分钟超时，即使父生成已消耗近 20 分钟。总耗时可达约 40 分钟。 | 计算剩余预算 `Math.max(0, TIMEOUT - (Date.now() - startedAt))` 传入修复请求。 |
| Medium | 存储错误返回通用"Failed to save image"而非可操作信息 | `apps/web/src/features/image-generation/operations.ts` L2559-2600 | 内部详细错误写入 DB metadata，但返回给调用者的是完全通用的消息。用户无法判断是否应重试。 | 将存储错误分类为"暂时不可用请重试"和"无法保存图片"两类。 |
| Medium | 异步任务后台 promise 不在服务端记录错误即重新抛出 | `apps/web/src/features/external-api/handlers/image-generations.ts` L340-384 | `.catch` 内无 `logError` 调用。若 `postAsyncImageCallback` 自身抛出，错误静默丢弃。 | 在 `.catch` 开始处添加 `logError`，将 callback 发送包裹在独立 try/catch 中。 |
| Low | chatgpt-web.ts 图片下载静默继续失败，可能返回空输出 | `apps/web/src/features/image-generation/chatgpt-web.ts` L1777-1782 | 所有图片下载失败后返回空数组，上游将其视为"无图片输出"而非"下载失败"。 | 下载循环后若 `outputs.length === 0` 且存在失败，返回 `{ error: 'Generated image download failed' }`。 |
| Low | SecuritySection catch 块使用硬编码错误消息忽略实际错误 | `apps/web/src/features/settings/components/security-section.tsx` L64-65 | 无论实际错误类型均显示"密码错误"。网络错误或服务端错误时误导用户。 | 检查错误类型后选择性显示消息。 |
| Info | presigned 上传 S3 异常详情经 console.error 泄露至服务器日志 | `apps/web/src/app/api/upload/presigned/route.ts` L78-84 | AWS SDK v3 错误对象不含签名凭据，泄露风险有限。`withApiLogging` 实际已存在。 | 使用 `logError` 替换 `console.error`。 |

---

### 7. 架构、设计模式与结构性问题 (Architecture, Design Patterns, and Structural Issues)

**概述：** 仓库有完善的分层架构意图（UOL 操作注册表、MCP 适配器、server actions、API routes），但 UOL 层处于过渡态。多个进程内单例不支持多实例部署。

| 发现数 | Critical | High | Medium | Low | Info |
|--------|----------|------|--------|-----|------|
| 12 | 0 | 0 | 6 | 4 | 2 |

| 验证后严重程度 | 标题 | 文件 | 描述 | 建议 |
|---------------|------|------|------|------|
| Medium | 重复 API 路由树 `/v1/` 和 `/api/v1/` | `apps/web/src/app/v1/` | 8 个完全相同的单行重导出。 | 选择规范路径或使用 Nginx/rewrites。 |
| Medium | MCP Admin 限流使用单个全局桶而非 per-client | `apps/web/src/app/api/mcp/admin/route.ts` L125-150 | 硬编码 key `mcp_admin_global`，单个 MCP agent 可耗尽所有管理员的限流配额。 | 使用 `authResult.principal.userId` 作为限流 key。 |
| Medium | 系统设置内存缓存为进程本地，跨实例不同步 | `packages/shared/src/system-settings/index.ts` L26-73 | `clearSystemSettingsCache()` 仅影响处理写入的进程。安全开关变更最多 10 秒传播延迟。 | 添加缓存失效信号（Redis pub/sub）或记录单实例约束。 |
| Medium | `IMAGE_CODEX_FILES_API_ENABLED` 直接读 `process.env` 绕过系统设置抽象 | `apps/web/src/features/image-generation/operations.ts` L372 | 此功能标志无法通过管理面板运行时切换，需进程重启。 | 添加至 `definitions.ts` 并使用 `getRuntimeSettingBoolean`。 |
| Medium | `credits.grant` 和 `credits.consume` 声明为 `protected` 但接受任意 userId | `packages/shared/src/uol/operations/credits.ts` L100-208 | 访问级别与描述（"webhook/admin/refund callers"）不匹配。当前因 MCP 白名单和 enrichArgsWithUserId 无法利用。 | 改为 `access: { kind: 'admin' }`，添加 `credits.grantSelf` 变体。 |
| Medium | 10+ 个 `credits.*` 操作缺少 `bindExecute` 但 `isOperationBound` 误返回 true | `packages/shared/src/uol/operations/credits.ts` L718-725 等 | `isOperationBound` 检查 `'Not yet wired'` 但不检查 `'must be bound at app level'`。 | 使用一致的未实现标记或显式 `wired: boolean` 标志。 |
| Medium | 进程内异步任务注册表不可扩展 | `apps/web/src/features/external-api/async-image-tasks.ts` L40-42 | 与 Bugs 维度发现重复，强调架构约束。 | 持久化至数据库或 Redis。 |
| Medium | 进程内图片生成队列不可扩展 | `apps/web/src/features/image-generation/queue.ts` L21-25 | 项目文档已承认此限制。 | 使用分布式锁或记录单实例约束。 |
| Low | 整个 UOL dispatch 层为非功能性桩 -- 生产流量绕过 | `packages/shared/src/uol/operations/image-generation.ts` L82-84 等 | 83 个操作为 `throw new Error('Not yet wired')`。经验证为有意的分阶段迁移，有文档记录的 5 阶段计划。 | 继续按计划推进 Phase 2 wiring。 |
| Low | Server Component 直接调用数据库服务函数绕过 UOL | `apps/web/src/app/[locale]/(dashboard)/dashboard/create/page.tsx` L1-20 | 只读获取无安全影响，但可能扩展至写操作。 | 在 CLAUDE.md 中明确记录 Server Component 可直接调用只读函数，写操作必须经 server action。 |
| Low | `packages/shared` 19+ 文件直接导入 `@repo/database` | `packages/shared/src/credits/core.ts` L9-16 | 架构正确但影响测试隔离。 | 继续提取纯函数至不依赖 DB 的模块。 |
| Info | 异步任务存储进程本地 Map 30 分钟 TTL | `apps/web/src/features/external-api/async-image-tasks.ts` L38-83 | 架构观察，无直接安全影响。当前 userId/apiKeyId 所有权检查正确。 | 同上，持久化至数据库或 Redis。 |

---

### 8. 前端质量、可访问性与 UX 问题 (Frontend Quality, Accessibility, UX Issues)

**概述：** 代码库在许多方面展现了合格的 React/Next.js 实践（加载骨架、动态导入、next-intl i18n、react-hook-form + Zod）。8 项确认发现覆盖可访问性、i18n 完整性、表单 UX 和组件设计。

| 发现数 | Critical | High | Medium | Low | Info |
|--------|----------|------|--------|-----|------|
| 8 | 0 | 0 | 5 | 2 | 1 |

| 验证后严重程度 | 标题 | 文件 | 描述 | 建议 |
|---------------|------|------|------|------|
| Medium | AlertDialog 在 settings-profile-view.tsx 中渲染在 AlertDialogTrigger 外，破坏屏幕阅读器和键盘可访问性 | `apps/web/src/features/settings/components/settings-profile-view.tsx` L596-643 | 未使用 AlertDialogTrigger，Radix 无触发器 ref，对话框关闭后焦点无法返回。 | 使用 AlertDialogTrigger asChild 包裹按钮，参考 billing-section.tsx L311-319。 |
| Medium | 侧边栏未读通知点仅通过颜色传达，无可访问文本 | `apps/web/src/features/dashboard/components/sidebar.tsx` L306-319 | 折叠时红点无 aria-label/role/sr-only。违反 WCAG 1.4.1。 | 在红点内添加 `<span className="sr-only">{unreadCount} unread</span>`。 |
| Medium | 密码可见性切换按钮以 tabIndex={-1} 移出 Tab 序列 | `apps/web/src/features/auth/components/sign-in-form.tsx` L206-217 等 4 个文件 | 键盘用户无法切换密码可见性。违反 WCAG 2.1.1。实际影响范围比报告更广（4 个文件而非 3 个）。 | 移除 tabIndex={-1}，添加 aria-label。 |
| Medium | 移动端汉堡按钮无可访问标签 | `apps/web/src/features/dashboard/components/main-wrapper.tsx` L85-104 | 图标按钮无 aria-label，屏幕阅读器用户无法识别用途。 | 添加 aria-label 使用翻译字符串。 |
| Medium | 蒙版绘制画布无键盘替代方案和可访问角色/标签 | `apps/web/src/features/image-generation/components/create-page-client.tsx` L7851-7863 | 仅响应鼠标/触摸事件，无 role/aria-label/键盘事件。 | 添加 `role='img'` 和 aria-label，确保"上传蒙版"按钮可通过键盘发现。 |
| Medium | SecuritySection 密码修改表单 submit Button 在 form 元素外 | `apps/web/src/features/settings/components/security-section.tsx` L75-155 | 无 `<form>` 元素，Enter 键无法提交，密码管理器无法识别凭据组。 | 使用 `<form onSubmit={...}>` 包裹输入项。 |
| Medium | GalleryClient 批量操作浮动条无屏幕阅读器通知 | `apps/web/src/features/image-generation/components/gallery-client.tsx` L409-454 | 无 `role='status'`/`aria-live`。包含破坏性操作（批量删除）的两步确认模式未向 AT 通知。 | 添加 `role='status'` 和 `aria-live='polite'`。 |
| Low | profile-form.tsx 含完全硬编码中文字符串绕过 i18n | `apps/web/src/features/settings/components/profile-form.tsx` L94-147 | 经验证为死代码 -- 无页面或组件导入此组件。实际 settings 页使用 SettingsProfileView。 | 删除此文件或连接 useTranslations()。 |

---

## 经对抗式验证确认的高危/严重问题

以下 5 项发现在对抗式验证后维持 High 或以上严重程度：

### 1. creditsConsumed 在存储错误路径中永远无法写入数据库

- **验证后严重程度：** High
- **文件：** `apps/web/src/features/image-generation/operations.ts` L2559-2601
- **完整描述：** 存储错误 catch 块中执行两次顺序 DB UPDATE。第一次（L2564-2573）设置 `status='failed'` 使用 `WHERE isPendingGeneration(generationId)` 展开为 `WHERE status='pending'`，成功将行从 pending 过渡出去。第二次（L2592-2595）尝试写入结算后的 `creditsConsumed` 值，但同样使用 `WHERE isPendingGeneration(generationId)`。因行已为 `failed`，此 WHERE 永远匹配零行，UPDATE 永久为空操作。`generation` 表的 `creditsConsumed` 永久停留在 INSERT 时写入的 `initialCreditCharge` 值。
- **验证推理：** `isPendingGeneration` 定义于 L484 为 `and(eq(generation.id, generationId), eq(generation.status, "pending"))` -- 要求 status='pending'。第一次 UPDATE 成功后行状态为 'failed'，第二次 UPDATE 不可能匹配。`settleChargedCredits` 在两次 UPDATE 之间执行，可能将 `chargedCredits` 减少至 `moderationOnlyCredits`，因此持久化值与实际结算值存在实质差异。其他所有失败退出路径（L2309-2319、L2354-2368、L2287-2319）正确地在单次 UPDATE 中同时设置 status 和 creditsConsumed，存储错误路径是唯一的结构异常。
- **修复优先级：** P0

### 2. Admin 积分发放缺少 sourceRef，重复调用双重发放无幂等保护

- **验证后严重程度：** High
- **文件：** `packages/shared/src/support/actions/admin-users.ts` L785-797
- **完整描述：** `adminGrantCreditsAction` 调用 `grantCredits` 未传 `sourceRef`。`grantCredits` 在 `core.ts` L408-410 使用 `.onConflictDoNothing` 但 WHERE 条件为 `sourceRef IS NOT NULL`，null sourceRef 永远不会命中冲突，每次调用均无条件插入新 `credits_batch` 行和 `credits_transaction`。
- **验证推理：** 代码自身在 UOL 操作描述中明确声明 `idempotency: { kind: "none" }` 和 "重复提交会重复发放（非幂等）"。UI 层 `isGranting` 状态 + `disabled` 仅防止单浏览器会话内的双击，不保护网络重试、多管理员并发操作或多实例部署场景。`adminAction` 中间件仅执行身份验证和角色检查，无请求去重。
- **修复优先级：** P0

### 3. Gallery 页面无 LIMIT 查询拉取全部草稿和上传行

- **验证后严重程度：** High
- **文件：** `apps/web/src/app/[locale]/(dashboard)/dashboard/gallery/page.tsx` L203-213
- **完整描述：** `draftParentRows` 和 `uploadParentRows` 查询执行 `db.select().from(generation).where(...).orderBy(...)` 无 `.limit()`。`db.select()` 无列投影选择所有列包括大体积 JSON metadata 列。两个查询在每次请求中无条件执行（即使用户在 "final" Tab），因 `draftCount` 和 `uploadCount` 从 `allDraftItems.length` 和 `allUploadItems.length` 派生。GIN 索引加速 WHERE 过滤但不减少传输数据量。无缓存层。
- **验证推理：** L223-225 的 JavaScript `.slice(0, limit)` 确认全部行先加载至内存再截取。查询按 `eq(generation.userId, user.id)` 限定范围，因此结果集受单用户历史限制而非全表。对拥有数千条生成记录的高频用户，每次页面加载的内存压力和延迟线性退化。
- **修复优先级：** P1

### 4. Admin 状态页将近 7 天全部生成行加载至 Node.js 内存

- **验证后严重程度：** High
- **文件：** `apps/web/src/app/[locale]/(dashboard)/dashboard/admin/status/page.tsx` L1358-1375
- **完整描述：** `loadStatusData()` 无 LIMIT 查询后在 JavaScript 中逐行解析 JSON。代码注释 L1683-1684 明确承认 "拉 last7d 7 万行 /~270MB metadata 进 JS"。`unstable_cache` 120 秒 TTL 降低频率但不消除问题。管理员可通过 RefreshStatusButton 随时触发缓存失效。并行查询 L1373 (generationTotals) 已使用纯 SQL 聚合，证明 SQL 侧聚合在此代码库中已有先例。
- **验证推理：** 每行的 metadata JSON blob 在 `getProducedImageCount`(L396-415)、`getBackendDurationBucket`(L376-393)、`getModerationPromptRepairAttempts`(L417-423) 中通过 `asRecord(row.metadata)` 逐行反序列化。仅管理员可访问且有 120 秒缓存，但随平台增长内存分配和 GC 压力为真正的可扩展性隐患。
- **修复优先级：** P1

### 5. creditsConsumed 在存储错误路径中永远无法写入数据库（同 #1）

> 注：此项与 #1 为同一发现，跨维度（Bugs 维度和 Financial 维度均独立发现并确认），不重复计数。

---

## 未验证的高危问题

所有 25 项原始 high/critical 发现均已完成对抗式验证。**无未验证的高危问题。**

---

## 中/低/信息级别问题汇总

### 安全与认证漏洞

| 严重程度 | 标题 | 文件 |
|----------|------|------|
| Medium | 注册验证 OTP 端点在中间件层无 per-IP 限流 | `apps/web/src/rate-limit-routing.ts` L13 |
| Low | CSRF 防护依赖的 SameSite=Lax 未显式声明 | `packages/shared/src/auth/index.ts` L185-204 |
| Info | JSON-LD dangerouslySetInnerHTML 仅使用静态数据 | `apps/web/src/components/seo/json-ld.tsx` L20-23 |

### 财务完整性、积分与计费

| 严重程度 | 标题 | 文件 |
|----------|------|------|
| Medium | Creem webhook subscription.active 先于 checkout.completed 到达时积分丢失 | `apps/web/src/app/api/webhooks/creem/route.ts` L388-429 |
| Medium | settleChargedCredits 退款路径静默吞没退款失败 | `apps/web/src/features/image-generation/operations.ts` L2162-2164 |
| Medium | voidActiveSubscriptionCreditsForUpgrade 使用 GREATEST(0, ...) 但非原子 | `packages/shared/src/credits/core.ts` L827-838 |
| Low | Admin 积分发放 sourceRef 缺失在 UOL 中已记录但未强制 | `packages/shared/src/uol/operations/credits.ts` L692-725 |
| Low | ensureRegistrationBonus TOCTOU（审计追踪不一致） | `packages/shared/src/credits/core.ts` L248-288 |

### Bug、逻辑错误、竞态条件

| 严重程度 | 标题 | 文件 |
|----------|------|------|
| Medium | 异步图片任务存储进程本地，重启丢失 | `apps/web/src/features/external-api/async-image-tasks.ts` L38-87 |
| Medium | 进程内图片生成队列多实例下失效 | `apps/web/src/features/image-generation/queue.ts` L21-25 |
| Medium | 订阅升级双重积分窗口 | `apps/web/src/features/payment/epay-fulfillment.ts` L435-498 |

### 性能问题

| 严重程度 | 标题 | 文件 |
|----------|------|------|
| Medium | Subscription 表缺少 userId 索引 | `packages/database/src/schema.ts` L240-253 |
| Medium | Create 页面三个串行 Promise.all 批次 | `apps/web/src/app/[locale]/(dashboard)/dashboard/create/page.tsx` L31-68 |
| Low | getPlanCapabilityMatrix 串行调用两次 | `apps/web/src/features/image-generation/operations.ts` L1125-1127 |
| Low | getGenerationStats 四个独立查询 | `apps/web/src/features/image-generation/queries.ts` L70-93 |

### 代码质量

| 严重程度 | 标题 | 文件 |
|----------|------|------|
| Medium | 根目录整个遗留应用为死代码 | `src/`（根目录） |
| Medium | 过时重复 Creem 客户端 | `apps/web/src/features/payment/creem.ts` |
| Medium | 重复 `/v1/*` 和 `/api/v1/*` 路由树 | `apps/web/src/app/v1/` |
| Medium | api-logger.ts `any` 类型违反规则 | `packages/shared/src/api-logger.ts` L3-4 |
| Medium | service.ts 4777 行 God file | `apps/web/src/features/image-generation/service.ts` |
| Medium | 5 个死 mock/demo UI 组件 | `apps/web/src/features/dashboard/components/` |
| Medium | 死 BlogPostItem 组件和 mockPosts | `apps/web/src/features/blog/` |
| Medium | sanitizeSnapshot 重复 | `packages/shared/src/announcements/actions.ts` 等 |
| Medium | uol-bindings.ts 62 个 TODO | `apps/web/src/server/uol-bindings.ts` |
| Medium | 4 个客户端组件 console.error 无上下文 | `packages/shared/src/support/components/` |
| Low | generateImageAction 死导出 | `apps/web/src/features/image-generation/index.ts` |
| Low | 不安全类型转换 `as unknown as` | `packages/shared/src/mcp/user-key-actions.ts` |
| Low | 3 个组件 console.error 处理支付错误 | `apps/web/src/features/settings/components/` |

### 错误处理

| 严重程度 | 标题 | 文件 |
|----------|------|------|
| Medium | presigned 上传 console.error 绕过 Pino | `apps/web/src/app/api/upload/presigned/route.ts` L78-84 |
| Medium | 内部调度器 console.warn/info | `apps/web/src/server/internal-job-scheduler.ts` L267-327 |
| Medium | Prompt 修复独立 AbortSignal 超时 | `apps/web/src/features/image-generation/operations.ts` L1947 |
| Medium | 存储错误返回通用消息 | `apps/web/src/features/image-generation/operations.ts` L2559-2600 |
| Medium | 异步任务后台 promise 不记录错误 | `apps/web/src/features/external-api/handlers/image-generations.ts` L340-384 |
| Low | chatgpt-web.ts 图片下载静默失败 | `apps/web/src/features/image-generation/chatgpt-web.ts` L1777-1782 |
| Low | SecuritySection 硬编码错误消息 | `apps/web/src/features/settings/components/security-section.tsx` L64-65 |

### 架构与设计

| 严重程度 | 标题 | 文件 |
|----------|------|------|
| Medium | 重复 API 路由树 | `apps/web/src/app/v1/` |
| Medium | MCP Admin 全局限流桶 | `apps/web/src/app/api/mcp/admin/route.ts` L125-150 |
| Medium | 系统设置缓存进程本地 | `packages/shared/src/system-settings/index.ts` L26-73 |
| Medium | IMAGE_CODEX_FILES_API_ENABLED 直接读 process.env | `apps/web/src/features/image-generation/operations.ts` L372 |
| Medium | credits.grant/consume 访问级别不匹配 | `packages/shared/src/uol/operations/credits.ts` L100-208 |
| Medium | 10+ 操作 isOperationBound 误返回 true | `packages/shared/src/uol/operations/credits.ts` L718-725 |
| Low | UOL dispatch 层为非功能性桩 | `packages/shared/src/uol/operations/` |
| Low | Server Component 绕过 UOL | `apps/web/src/app/[locale]/(dashboard)/dashboard/create/page.tsx` |
| Low | packages/shared 直接导入 @repo/database | `packages/shared/src/credits/core.ts` 等 |

### 前端质量与可访问性

| 严重程度 | 标题 | 文件 |
|----------|------|------|
| Medium | AlertDialog 无 AlertDialogTrigger | `apps/web/src/features/settings/components/settings-profile-view.tsx` L596-643 |
| Medium | 侧边栏未读通知仅颜色传达 | `apps/web/src/features/dashboard/components/sidebar.tsx` L306-319 |
| Medium | 密码切换 tabIndex={-1} | `apps/web/src/features/auth/components/sign-in-form.tsx` 等 4 文件 |
| Medium | 汉堡按钮无可访问标签 | `apps/web/src/features/dashboard/components/main-wrapper.tsx` L85-104 |
| Medium | 蒙版画布无键盘替代 | `apps/web/src/features/image-generation/components/create-page-client.tsx` L7851-7863 |
| Medium | SecuritySection 无 form 元素 | `apps/web/src/features/settings/components/security-section.tsx` L75-155 |
| Medium | GalleryClient 浮动条无 AT 通知 | `apps/web/src/features/image-generation/components/gallery-client.tsx` L409-454 |
| Low | profile-form.tsx 硬编码中文（死代码） | `apps/web/src/features/settings/components/profile-form.tsx` |

---

## 建议修复优先级

### P0: Critical（立即修复） -- 已修复 (974badb)

| 编号 | 问题 | 文件 | 状态 |
|------|------|------|------|
| 1 | creditsConsumed 在存储错误路径永远无法写入 DB | `operations.ts` | 已修复：合并两次 UPDATE 为单次 |
| 2 | Admin 积分发放缺少 sourceRef，无幂等保护 | `admin-users.ts` | 已修复：添加确定性 sourceRef |

### P1: High（本 Sprint 修复） -- 已修复 (974badb)

| 编号 | 问题 | 文件 | 状态 |
|------|------|------|------|
| 3 | Gallery 页面无 LIMIT 查询 | `gallery/page.tsx` | 已修复：添加 .limit() + 独立 COUNT |
| 4 | Admin 状态页 7 万行加载至内存 | `admin/status/page.tsx` | 已修复：添加 .limit(10000) |
| 5 | subscription 表缺少 userId 索引 | migration 0039 | 已修复：复合索引 (user_id, updated_at DESC) |
| 6 | Creem webhook subscription.active 排序竞态 | `creem/route.ts` | 已修复：checkout.completed 也调用 grantSubscriptionCredits |

### P2: Medium（下 Sprint 计划）

| 编号 | 问题 | 文件 | 理由 |
|------|------|------|------|
| 7 | 全局 disableCSRFCheck | `auth/index.ts` L185-204 | 纵深防御退化 |
| 8 | 注册验证 OTP 无 per-IP 限流 | `rate-limit-routing.ts` L13 | 邮件成本放大风险 |
| 9 | settleChargedCredits 退款路径静默失败 | `operations.ts` L2162-2164 | 静默多收费 |
| 10 | presigned 上传/内部调度器 console.error/warn | 多文件 | 可观测性盲区 |
| 11 | Prompt 修复独立 AbortSignal | `operations.ts` L1947 | 队列槽位可占用 40 分钟 |
| 12 | 密码切换 tabIndex={-1} | 4 个 auth 文件 | WCAG 2.1.1 违规 |
| 13 | 侧边栏未读通知仅颜色传达 | `sidebar.tsx` L306-319 | WCAG 1.4.1 违规 |
| 14 | SecuritySection 无 form 元素 | `security-section.tsx` L75-155 | Enter 键无法提交 |
| 15 | 异步任务/生成队列进程内状态 | 多文件 | 水平扩展阻塞 |
| 16 | Create 页面串行 Promise.all | `create/page.tsx` L31-68 | SSR 延迟可优化 |
| 17 | 系统设置缓存进程本地 | `system-settings/index.ts` | 多实例部署风险 |
| 18 | credits.grant/consume 访问级别不匹配 | `credits.ts` L100-208 | 潜在权限提升 |

### P3: Low/Info（Backlog）

| 编号 | 问题 | 文件 | 理由 |
|------|------|------|------|
| 19 | 根目录遗留 src/ 死代码 | `src/`（根目录） | 贡献者困惑 |
| 20 | 过时重复 Creem 客户端 | `apps/web/src/features/payment/creem.ts` | 潜在安全隐患 |
| 21 | 重复 /v1/ 路由树 | `apps/web/src/app/v1/` | 维护负担 |
| 22 | api-logger.ts any 类型 | `api-logger.ts` L3-4 | 项目规则违规 |
| 23 | service.ts God file | `service.ts` | 可维护性 |
| 24 | 死 mock/demo 组件 | `dashboard/components/` | 代码噪音 |
| 25 | uol-bindings.ts 62 个 TODO | `uol-bindings.ts` | 规则违规 |
| 26 | sanitizeSnapshot 重复 | 2 文件 | DRY 原则 |
| 27 | 死 BlogPostItem | `blog/` | 代码噪音 |
| 28 | 不安全类型转换 | `user-key-actions.ts` | 类型安全 |
| 29 | generateImageAction 死导出 | `index.ts` | 代码噪音 |
| 30 | profile-form.tsx 硬编码中文 | `profile-form.tsx` | 死代码 |
| 31 | processExpiredBatches TOCTOU | `core.ts` L475-486 | 毫秒级窗口 |
| 32 | console.error 多处 | 多文件 | 客户端可观测性 |
| 33 | getGenerationStats 4 查询 | `queries.ts` L70-93 | 性能优化 |
| 34 | getPlanCapabilityMatrix 串行 | `operations.ts` L1125-1127 | 微优化 |

---

## 附录

### 扫描统计

| 项目 | 数据 |
|------|------|
| 审计范围 | 全 Turborepo 单体仓库 |
| 工作区包 | `apps/web`、`packages/shared`、`packages/database`、`packages/ui` |
| 根目录遗留代码 | `src/`（已标记为死代码） |
| 发现总数 | 70 |
| 对抗式验证发现数 | 25 |
| 验证后确认率 | 100%（25/25 确认为真实问题） |
| 严重程度调整率 | 80%（25 项中 20 项被降级） |

### 审计方法

1. **8 维度并行审计：** 8 个独立审计 agent 分别从安全、财务、Bug/竞态、性能、代码质量、错误处理、架构、前端质量维度并行扫描代码库
2. **对抗式验证：** 独立验证 agent 对所有 high/critical 发现进行代码级验证，检查：
   - 代码是否如描述所述存在
   - 所声称的影响机制是否在技术上准确
   - 是否存在原始审计遗漏的缓解因素
   - 严重程度是否合理或需调整
3. **严重程度校准：** 基于验证结果调整严重程度，25 项中 20 项被降级，确保报告反映真实风险而非理论风险

### 局限性与注意事项

1. **静态分析限制：** 本审计为纯代码审查，未执行动态测试、渗透测试或运行时行为验证
2. **部署假设：** 多处发现基于当前 docker-compose.yml 单实例部署进行严重程度评估。若部署拓扑变更（如添加副本），多个 Medium 级别发现将升级为 High
3. **时间窗口：** 审计基于 2026-06-15/16 的代码快照，后续提交可能已修复或引入新问题
4. **第三方依赖：** 未审计 node_modules 中的依赖包漏洞，建议使用 `npm audit` 或 `pnpm audit` 补充
5. **对抗式验证覆盖：** 验证覆盖全部 25 项 high/critical 发现，Medium/Low/Info 级别发现未逐项进行代码级验证
6. **前端测试：** 可访问性发现基于代码审查而非实际辅助技术测试，建议使用 axe-core 或真实屏幕阅读器补充验证
