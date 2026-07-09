# GPT2IMAGE 对抗式复核审计报告

- 日期：2026-05-31
- 范围：全仓多子系统（计费/生成管线/外接 v1 API/鉴权授权/订阅/存储/支付 Webhook/限流审核/系统设置/后端池/定时任务/前端组件/数据库迁移）
- 方法：三视角（覆盖率 coverage / 可维护性 maintainability / 安全 security）发现经对抗式复核（adversarial verification）逐条确认。本报告仅收录已确认（isReal=true）发现。
- 注意：仓库实际代码位于 monorepo 子目录 `gpt2image-pro/` 下（pnpm workspace = `apps/*` + `packages/*`），仓库根 `gpt2image-pro/src/` 为不参与构建的遗留死代码树。多数发现的 `file` 字段省略了 `gpt2image-pro/` 前缀，本报告条目沿用原始路径，定位时请补全该前缀。

---

## 1. 顶部摘要表

### 1.1 按严重级别（Severity）统计

| Severity | 数量 |
| --- | --- |
| Critical | 1 |
| High | 27 |
| Medium | 58 |
| Low | 39 |
| Info | 3 |
| **合计** | **128** |

### 1.2 按视角（Lens）统计

| Lens | 数量 |
| --- | --- |
| Coverage（测试覆盖率） | 60 |
| Maintainability（可维护性/重构） | 41 |
| Security（安全） | 27 |
| **合计** | **128** |

### 1.3 按 Lens × Severity 交叉

| Lens \ Severity | Critical | High | Medium | Low | Info | 小计 |
| --- | --- | --- | --- | --- | --- | --- |
| Security | 1 | 6 | 11 | 6 | 3 | 27 |
| Maintainability | 0 | 7 | 26 | 8 | 0 | 41 |
| Coverage | 0 | 14 | 21 | 25 | 0 | 60 |
| **小计** | **1** | **27** | **58** | **39** | **3** | **128** |

> 总确认发现数：128。

---

## 2. 安全（Security）

按 severity 从高到低。

### 2.1 Critical

#### S-C1. 系统设置写入仅用 adminAction，普通 admin 可改写 BETTER_AUTH_SECRET 等密钥实现权限提升/账号接管
- Severity: critical
- 位置：`packages/shared/src/system-settings/actions/index.ts:20-91`（updateSystemSettingsAction:27, importSystemSettingsFromEnvAction:53, initializeSystemSettingsDefaultsAction:74）
- WHY：四个系统设置 action 均以 `adminAction`（safe-action.ts:129 canAccessAdminArea）作授权门闩，而 canAccessAdminArea 对 `admin` 与 `super_admin` 都放行（auth/roles.ts:31-38）。设置面板页面网关同样仅用 canAccessAdminArea（admin/settings/page.tsx:26）。因此较低权限的 `admin`（非超管）可通过 updateSystemSettingsAction 写入任意系统配置，包括 BETTER_AUTH_SECRET（definitions.ts:407 secret:true）。setSystemSettings 对 secret 仅在传入空串时跳过（index.ts:562-568），不阻止设置一个已知新值。admin 把 BETTER_AUTH_SECRET 改成自己已知的值后，bootstrapSystemSettingsEnv 会把 DB 值注入 process.env（bootstrap.ts:33-35），env-file 同步落盘（env-file.ts:41-90），生效后该 admin 即可用已知密钥伪造任意会话（含 super_admin）→ 完整账号接管与权限提升。同一通道还可改写 OAuth client secret、CREEM/EPAY 密钥与 webhook secret、STORAGE Secret、CONTENT_MODERATION_PROXY_URL（指向内网的 SSRF 目标，moderation/index.ts:644-665 用其 fetch）。
- 修复建议：将三个写入 action（及含密钥元数据的 getSystemSettingsAction）从 adminAction 改为 superAdminAction（safe-action.ts:144 canManageUserPermissions=isSuperAdminRole）；同步把 settings/page.tsx 系统设置分支网关从 canAccessAdminArea 收紧为 canManageUserPermissions。如需保留 admin 编辑非敏感项，则按 definition.secret/category 做细粒度授权：secret 与 auth/payment/storage 类必须超管。BETTER_AUTH_SECRET 这类可导致会话伪造的密钥应额外禁止经面板写入或要求二次确认。
- 复核结论：维持 critical。单一动作即可达成 admin→super_admin 提权 + 完整账号接管 + 服务端 SSRF + 第三方密钥写入；该库已对等敏感的用户管理动作强制 superAdminAction，说明此处为遗漏。

### 2.2 High

#### S-H1. 聊天历史图片 URL 触发服务端 SSRF（无内网/元数据过滤）
- Severity: high
- 位置：`apps/web/src/features/image-generation/web-history-references.ts:22-29, 117`
- WHY：downloadWebHistoryImageReference 第117行对 reference.imageUrl 直接 `await fetch(...)`，无任何 SSRF 防护。imageUrl 来自客户端提交的聊天历史（ChatHistoryMessage.variants[].imageUrl）。isUsableHistoryImageUrl 仅校验 http(s) 前缀，不做内网/回环过滤。攻击者在 messages 历史塞入 imageUrl=`http://169.254.169.254/...`（或内网 10.x/192.168.x）即可让服务器代为请求云元数据/内网服务。对照同请求里 promptImageUrls 走 fetchPublicImage（已修 SSRF），唯独 history 路径绕过。
- 修复建议：远程分支改用 `fetchPublicImage(reference.imageUrl,{signal})`（逐跳 redirect:manual + assertPublicImageUrl 内网封堵）替换裸 fetch；对非站内 URL 先做 assertPublicImageUrl；对响应做 content-type 与大小上限校验。
- 复核结论：维持 high（可外泄 IAM 凭证/探测内网，任意 Pro+ 用户/外部 key 可触发）。修正入口归因：主要可利用入口是 agent-images handler 与 web chat route（apps/web/.../api/images/chat/route.ts），二者接受客户端 variants[].imageUrl 并喂入同一 sink；而 chat-completions.ts 路径仅填充 imageUrls 不可利用。

#### S-H2. 聊天历史 storage URL 读取对象存储无属主校验（IDOR / 跨桶任意读）
- Severity: high
- 位置：`apps/web/src/features/image-generation/web-history-references.ts:31-51, 97-104`
- WHY：当客户端提交的历史 imageUrl 形如 `/api/storage/<bucket>/<key>` 时，parseStorageImageUrl 直接解析 bucket/key，随即 `storage.getObject(key,bucket)` 服务端读取对象并回灌生成——全程无属主/归属校验：不校验 key 是否以当前 userId 前缀开头、不校验 bucket、bucket/key 完全由客户端字符串决定。攻击者拼出他人 userId 前缀 + key 即可让服务器读出他人私有对象；并可指定任意 bucket 做跨桶探测。
- 修复建议：storage 分支强制属主校验：仅允许 bucket===generations 桶且 `key.startsWith(\`${input.userId}/\`)`（需把 userId 透传进函数）；拒绝含 `..`、绝对路径或解码越界的 key；不满足者回退公网安全下载或拒绝。
- 复核结论：维持 high。`..` 穿越子项已被 local provider safePath 缓解且对 S3 key 无意义，但跨用户 IDOR（generations/<victimUserId>/<key>）无需 `..`，对两种 provider 完全未缓解；nanoid(32) 高熵限制了批量爬取但不限制任意 bucket 选择与 HTTP 鉴权绕过性质。

#### S-H3. 异步任务 callback_url 的 SSRF：回调 POST 跟随重定向且未逐跳复检
- Severity: high
- 位置：`apps/web/src/features/external-api/async-image-tasks.ts:185-217`（postAsyncImageCallback）；校验在 65-109（validateCallbackUrl）
- WHY：/v1/images/generations 与 /v1/images/edits 支持 async + callback_url。提交时 validateCallbackUrl 仅对初始 URL 主机名做一次内网过滤；真正回调由 postAsyncImageCallback 用 `fetch(callbackUrl,{method:'POST'})` 默认 redirect:follow 发出，对重定向目标不复检。攻击者把 callback_url 指向自控公网主机（校验通过），任务完成后服务器 POST 到该主机，对方返回 `302 Location: http://169.254.169.254/...` 或内网地址，本服务器 POST 即跟随打到内网/云元数据。存在 validate（提交）与 fetch（延迟 30 分钟）的 TOCTOU 窗口。
- 修复建议：回调 POST 复用 redirect:'manual'，对每跳 Location 重新 assertPublicImageUrl；或发出前再次 validateCallbackUrl；理想在连接层 pin 已校验公网 IP。限制回调仅 https 并对端口白名单。
- 复核结论：维持 high。为盲/半盲 SSRF（响应体不回传，仅 server 端记 status），但已认证 key 持有者获得对内网/元数据端点发任意-body POST 的原语，TOCTOU 30 分钟窗口，无逐跳防护。

#### S-H4. 管理员封禁(banUserAction)对第一方会话/Server Action 不生效
- Severity: high
- 位置：`packages/shared/src/support/actions/admin-users.ts:711-745`（banUserAction）；强制点缺失于 `packages/shared/src/safe-action.ts:94-121`（protectedAction）
- WHY：banUserAction 只写 `user.banned=true`、`bannedReason=<普通原因>`，既不删 session 行，也不置 bannedReason="account_deleted"。唯一封禁强制点 registration-verification-plugin.ts 的 assertUserCanAuthenticate 只在 `bannedReason==="account_deleted"` 时拒绝（第66行），普通封禁不命中。protectedAction 与 getServerSession 全程不读 banned。对照 delete-account.ts:77,86-87 明确 `tx.delete(session)` 且置 account_deleted，证明"封禁应撤销访问"是既定设计，但管理员 ban 漏做。被封用户的现有 7 天会话继续有效，重新登录也能创建新会话照常调用所有受保护 Server Action（生图/扣费/工单）。仅外接 API（external-api/auth.ts:61）真正拦截。
- 修复建议：protectedAction 中间件查询并拒绝 `user.banned=true` 会话（抛 ActionAuthError）；banUserAction 同步 `db.delete(session).where(eq(session.userId,target))`；或把 assertUserCanAuthenticate 的 session.create.before 改为拒绝任意 banned=true。受保护页面布局同样需 banned 校验。
- 复核结论：维持 high（ban 在第一方通道形同摆设）。不上调 critical：前置需管理员先决定封禁，且经济滥用仍受余额/配额/幂等扣费限制。

#### S-H5. 普通 admin 可封禁更高权限账户(super_admin)，且可向任意账户(含自己)铸造最高10万积分，无目标权限护栏
- Severity: high
- 位置：`packages/shared/src/support/actions/admin-users.ts:711-745`（banUserAction, adminAction）, `747-793`（adminGrantCreditsAction, adminAction）
- WHY：两者都走 withAdminUsersAction(=adminAction，普通 admin 即可)，getUserBasicOrThrow 仅校验目标存在不校验目标角色。后果：(1) 普通 admin 可封禁 super_admin（含锁死唯一超管），破坏权限层级；(2) 普通 admin 可对任意 userId（含自身）重复调用 adminGrantCreditsAction，每次最高 100000 积分（grantCreditsSchema.max(100000)），凭被攻陷/内鬼 admin 即可无限铸币（有审计日志但无金额/频率护栏）。对比 updateUserRoleAction/adminAdjustCreditsAction 已收紧为 superAdminAction，说明分层意识存在，但这两项高敏操作下放给了普通 admin。
- 修复建议：banUserAction 增加守卫禁止操作 role≥操作者的账户；adminGrantCreditsAction 增加目标权限护栏并禁止给自身发放，或上提为 superAdminAction，引入单管理员发放日累计上限/二人复核。
- 复核结论：由 medium 升 high。两项叠加且零防护：锁死顶层控制 + 单 admin 自助铸币（无金额上限外的限制）。不 critical 仅因需既有 admin 会话。

#### S-H6. 注册验证码发送无每邮箱/每IP冷却，可对任意白名单邮箱无限轰炸（邮件成本放大）
- Severity: high
- 位置：`packages/shared/src/auth/registration-verification.ts:43-91`（sendRegistrationVerificationCode）
- WHY：每次调用都 delete 旧码 + insert 新码 + 发邮件，无冷却/节流/每邮箱日上限。唯一外部入口 /api/auth/registration-verification 本应靠 middleware `type:"auth"` 限流，但该限流被 middleware 提前 return 旁路（见 S-M? / 限流条目），故 per-IP 限流也不生效。攻击者对任意 gmail/qq/163/126 白名单地址循环 POST 即可向受害者邮箱无限发码，放大 SES/SMTP 出账成本。isRegistrationEmailTaken 仅拦已注册邮箱，未注册的真实受害邮箱可被任意轰炸。
- 修复建议：sendRegistrationVerificationCode 内加每邮箱发送冷却（如 60s）与滑窗日上限（复用 verification 行 createdAt/expiresAt 或新增计数）；修复 middleware 使该路由真正过 auth 限流；叠加 Turnstile/CAPTCHA。
- 复核结论：维持 high。未认证、可脚本化、成本放大 + 第三方骚扰。受 4 个白名单域、每次覆盖同一 DB 行（仅出账成本，无 DB 膨胀）约束，故非 critical。

#### S-H7. 管理员封禁在会话路径完全缺失（与 S-H4 同源，登记为权限模型分裂）
- Severity: high
- 位置：`packages/shared/src/auth/registration-verification-plugin.ts:55-72, 170-177`（assertUserCanAuthenticate）；对比 `apps/web/src/features/external-api/auth.ts:51,61`
- WHY：ban 执行逻辑分裂成两套且不一致。外接 v1 路径（auth.ts:61）`if (!apiKey || apiKey.userBanned ...) return null` 拒绝被封用户；会话路径（protectedAction、getServerSession、middleware）从不检查 banned。plugin 的 session.create.before 调 assertUserCanAuthenticate，但该函数只在 bannedReason==='account_deleted' 时抛错，普通 banned=true（管理员 banUserAction 设置）完全不拦。结果：banUserAction 的 UI 文案是"用户已被封禁"，但实际只挡住 API key 路径。
- 修复建议：抽一个 `assertUserNotBanned(user)` 共享函数，在 protectedAction、plugin 的 session.create.before（对任意 banned=true）、external-api/auth 三处统一调用；并在 banUserAction 撤销现有会话。docs 记录"ban 的唯一真相来源"。
- 复核结论：维持 high。虽归 maintainability lens，实际效果是 authz-bypass（生成/计费/工单/设置全暴露给被封用户的活跃会话）。需管理员先封禁这一特权前置，故 high 而非 critical。

> 备注：S-H4 与 S-H7 为同一缺陷的两个登记视角（security 与 maintainability），修复时应一并处理。

### 2.3 Medium

#### S-M1. getClientIp 首选可伪造的 cf-connecting-ip / x-real-ip，默认 Docker 部署下可绕过所有 per-IP 限流
- Severity: medium
- 位置：`packages/shared/src/rate-limit/index.ts:274-294`（getClientIp）；配合 `apps/web/src/proxy.ts:118-119,147-148`
- WHY：getClientIp 按 cf-connecting-ip → x-real-ip → x-forwarded-for 取限流标识，注释称前两者"较难伪造"——仅在前置有可信反代覆盖写这些头时成立。但 docker-compose.yml 直接暴露 web 容器端口，无反代服务，仓库无 nginx/.conf 或 strip 头逻辑。默认部署中三者均客户端可控。攻击者每次带随机 `cf-connecting-ip: <uuid>` 即获全新限流桶，彻底绕过 per-IP 限流（含 auth/strict 暴力破解防护）。
- 修复建议：引入"可信代理跳数/可信头"配置：仅当存在已知可信前置代理时才信任 cf-connecting-ip/x-real-ip，否则回退平台对端 socket 地址；x-forwarded-for 按可信跳数从右往左取第一个非可信 IP。文档强制要求前置反代覆盖写并显式清空 cf-connecting-ip（`proxy_set_header CF-Connecting-IP "";`）。修正第275行注释。
- 复核结论：维持 medium。仅影响 per-IP 限流/节流，不直接 RCE/数据泄露/资金损失；可被运维缓解，但常规 Nginx 配置（只 set X-Real-IP）仍被 cf-connecting-ip 绕过。

#### S-M2. 异步生成回调 POST 跟随重定向且校验/连接分离，残留 SSRF
- Severity: medium
- 位置：`apps/web/src/features/external-api/async-image-tasks.ts:65-109, 185-200`
- WHY：图像异步模式完成后 postAsyncImageCallback `fetch(callbackUrl,{method:'POST'})` 未设 redirect（默认 follow）。validateCallbackUrl 仅提交时校验一次主机非内网；实际 POST 在任务完成后才发生。公网 callback 可返回 30x→内网/169.254.169.254；或 DNS 重绑定。两者让服务器对内网发携带任务结果 JSON 的 POST。
- 修复建议：改 redirect:'manual'，收到 30x 直接判失败不跟随；或封装 postPublicCallback 复用逐跳 assertPublicImageUrl；理想连接层 pin 已校验 IP。
- 复核结论：维持 medium（盲打 + 仅 POST，响应不回传，body 是攻击者自己的任务结果，外带价值低）。与 S-H3 同源——该条侧重 DNS 重绑定残留，S-H3 侧重纯 302。修复应统一处理。

#### S-M3. 按 URL 拉取图片时正文大小无流式上限：content-length 头可伪造导致内存耗尽 DoS
- Severity: medium
- 位置：`apps/web/src/features/external-api/handlers/image-edits.ts:404-422`（fetchImageReference）；同型见 chat-completions.ts:167-185、responses.ts:464-471、agent-images.ts:543-561
- WHY：先读 content-length 头判大小，再 `Buffer.from(await response.arrayBuffer())` 把整个响应读入内存，最后用 buffer.length 复核 maxImageBytes(25MB)。content-length 是攻击者控制的自报字段：不返回则预检通过，或谎报很小值后实际流式返回数 GB；arrayBuffer() 把全部字节缓冲进内存后才触发检查。任意可调用相关端点的 key 提交指向大响应服务器的 image_url 即可（edits/agents 的 Promise.all 多图成倍放大）。
- 修复建议：改流式读取并在累计字节超 maxImageBytes 时主动 abort（response.body reader 逐块累加，超限即 cancel 抛错）；封装带 maxBytes 的安全读取工具置于 safe-image-fetch.ts 供所有处理器复用。
- 复核结论：维持 medium。responses.ts 最严重——既无 content-length 预检也无 buffer.length 后检，完全无上限缓冲。需已认证 key，SSRF 守护未破，但单请求可逼近 OOM。

#### S-M4. /moderate 路由用非恒定时间的 secrets.includes() 比对代理密钥（计时侧信道，偏离全仓 timingSafeEqual 标准）
- Severity: medium
- 位置：`apps/web/src/app/moderate/route.ts:31-43`（verifyProxySecret），关键 line 42
- WHY：verifyProxySecret 用 `Array.includes`（原生短路字符串比较）校验 Bearer/x-moderation-proxy-secret。原生字符串比较在首个不同字符即返回，构成计时侧信道，理论可逐字节恢复 CONTENT_MODERATION_PROXY_SECRET / GATEWAY_SECRET。该端点是审核入口，密钥泄露后攻击者可冒充网关把 moderateContent 当未鉴权审核 oracle 并放大上游成本。全仓其他鉴权（jobs、external-api/auth、epay、creem）都用 sha256 + timingSafeEqual，唯独此处用 includes。
- 修复建议：改恒定时间比对：对收到的 token 与每个配置密钥分别 sha256 后 timingSafeEqual，遍历所有候选（不短路）。
- 复核结论：维持 medium，但实际可利用性偏低——远程定时侧信道在 HTTP/TLS/异步调度噪声下逐字节恢复几乎不可行；真正价值是标准对齐/纵深防御。

#### S-M5. 默认未配置 Upstash 时 ai/upload/payment/global 限流静默 fail-open（成本敏感端点零限流）
- Severity: medium
- 位置：`packages/shared/src/rate-limit/index.ts:234-265`（checkRateLimit），关键 243-254
- WHY：A9 修复只让 auth/strict 在无 Upstash 时走内存兜底 fail-closed；checkRateLimit 对 ai/upload/payment/global 仍返回 `{success:true, skipped:true}`（fail-open）。middleware 把所有 /api/images/*、/v1/*、/api/v1/* 映射为 type:'ai'。默认部署（C3 常态）下所有图像生成与 OpenAI 兼容外接端点无任何频率限流，单 key/单 IP 可无限高频打上游。这与 auth/strict 的内存兜底仅差一个类型判断，属可在代码层收敛的缺陷。
- 修复建议：内存兜底扩展到 ai/upload/payment；或在生产 + 未配置 Upstash 时对成本敏感类型 fail-closed/降级内存兜底并打 error 日志；长期在各 v1 handler 顶部加 per-key 滑窗限流。
- 复核结论：维持 medium。计费流走 consumeCredits 逐张幂等扣费，认证用户无法零成本无限出图；残余风险是上游配额耗尽/DoS、relay-only/非计费路径、上游成本放大。

#### S-M6. moderateContent 在 TOCTOU（provider 报告已配置但调用时 skipped）下回落最终 skipped，等价放行
- Severity: medium → 复核维持 high
- 位置：`packages/shared/src/moderation/index.ts:712-791`（moderateContent），配合 544-550 / 597-600 各 provider skipped 分支与 790 行末尾 return skipped
- WHY：getConfiguredModerationProviders 一次 runtime-setting 读取判定 provider 是否已配置；随后各 provider 又独立再读一次 config/apikey，若读到 null 返回 skipped。moderateContent 的循环只在 block/allow 时 return，skipped 不计入 errors，循环结束后落到 790 行 return skipped，上游 operations.ts:1563 仅对 block/error 拦截，skipped 视为放行。两次读取间配置变更/缓存抖动（TOCTOU）或 provider 判已配置但凭据缺失时审核被静默跳过，违反 fail-closed 意图。
- 修复建议：providers 非空却无 provider 产出 allow/block 时并入 errors 走 shouldFailClosed（默认 block）；统一在单次设置快照内读取所有审核相关 runtime settings。
- 复核结论：复核降为 low——10 秒 TTL 缓存使单次调用内两次读取几乎命中同一快照，触发需管理员在请求在途时改凭据或缓存恰到期，影响仅"该单次请求绕过一次"，非持久绕过、非攻击者主动可触发。

#### S-M7. getUserPlan 在每用户多订阅行存在时按非确定顺序取行，导致权限判定不可靠
- Severity: medium
- 位置：`packages/shared/src/subscription/services/user-plan.ts:74-83`
- WHY：getUserPlan 是全站权限权威来源（5 个 v1 handler、生成管线、并发上限、月度积分、审核级别、外接 API 能力均消费）。其查询 `select().from(subscription).where(eq(userId)).limit(1)` 无 orderBy。schema（schema.ts:240-253）仅对 subscription_id 加 unique，userId 无唯一约束；Creem（webhooks/creem/route.ts:447-481 createOrUpdateSubscription）与 epay（epay-fulfillment.ts:282-311）入账都用"按 userId SELECT→命中 UPDATE 否则 INSERT"且在 webhook 内无事务/行锁。并发 webhook 或跨渠道/重订阅会插入第二行。无 ORDER BY 的 LIMIT 1 返回顺序未定义，配合 canceled-within-period/lifetime 永久活跃，用户降级/退订后仍可能解析为更高套餐（多发积分/超额用量/越权能力位）。
- 修复建议：(1) 查询加确定性排序（如 `.orderBy(desc(currentPeriodEnd))` 或先按 status 活跃度再按 updatedAt），更稳妥是聚合"所有当前活跃订阅中等级最高/最新一条"；(2) 给 subscription.userId 加唯一索引（幂等迁移），两处 upsert 改 onConflictDoUpdate(target:userId)，上线前合并历史重复行。
- 复核结论：维持 medium（偏低端）。真实有经济与越权后果，但前置需重复 userId 行（webhook 竞态或特定跨渠道序列），正常单渠道自愈为单行。修正：Creem upsert 实际在 webhooks/creem/route.ts:447-481，非 actions.ts:446-479。

#### S-M8. 管理员可经系统设置改写积分/计费/审核参数，无范围或上限校验
- Severity: high → 复核降为 medium
- 位置：`packages/shared/src/system-settings/index.ts:187-226`（coerceValue number 分支:196-202）, `532-601`（setSystemSettings）
- WHY：coerceValue 对 number 仅 Number()+isFinite，无业务上下界；select 仅校验在 options 内；setSystemSettings 不设上限。配合 S-C1（普通 admin 即可写入），admin 可把 REGISTRATION_BONUS_CREDITS、PLAN_*_MONTHLY_AMOUNT、IMAGE_BASE_CREDITS_*、CONTENT_MODERATION_ENABLED/FAIL_CLOSED、moderation 拦截等级改成任意值，放大成本/绕过审核/薅羊毛。PLAN_CAPABILITY_MATRIX 为自由 JSON，coerceValue 仅 JSON.parse 合法即接受。
- 修复建议：(1) 经济/安全语义键收紧到 superAdminAction；(2) coerceValue/setSystemSettings 增 per-key 业务范围校验（积分 0..上限、价格 >0 且 <合理上限）；(3) 关键开关变更写审计日志并要求超管。
- 复核结论：降 medium。PLAN_CAPABILITY_MATRIX 实际经 normalizePlanCapabilityMatrix 已做类型/上下界钳制（非"完全不校验"）；残余面仅纯数值键缺上界与可关审核，且执行者须为已具 admin 角色账号。无需对矩阵新增抛错型 Zod。

#### S-M9. env-file 同步用正则替换托管块，settings 值含 END 标记可破坏 .env 解析（注入/截断）
- Severity: medium
- 位置：`packages/shared/src/system-settings/env-file.ts:75-82`（正则替换）, `23-35`（serializeEnvLine/quoteEnvValue）
- WHY：syncSystemSettingsToEnvFiles 把所有托管 key 序列化进 `# BEGIN/# END GPT2IMAGE ADMIN SETTINGS` 之间，下次同步用非贪婪正则整块替换。值经 JSON.stringify 引号转义（换行转 \n 不能直接注入新行），但 END 哨兵是裸文本：若某设置值含该字符串，序列化后哨兵出现在引号内的一行；本函数下次同步的朴素 BEGIN..END 提取/替换会在该处提前判定块结束，导致块外内容被错误并入或截断，污染部署侧 apps/web/.env.local（含支付/认证密钥）。
- 修复建议：用不可能出现在值中的唯一哨兵（带随机 nonce/base64 边界），或结构化标记 + 锚定行首且 END 不在引号内；对写入值做哨兵子串检测，命中即拒绝或转义。同时对 String.replace 的 `$` 特殊序列用函数式 replacer `() => managed` 规避（见 SY-H1 同源 $ 问题）。
- 复核结论：维持 medium。admin-only 触发，影响为运行时读取的 0600 文件被悄然篡改；本函数自身下次调用即可触发，无需外部工具。

#### S-M10. 存储 URL 读取路由缺少 X-Content-Type-Options:nosniff 与 Content-Disposition（内容嗅探/存储型 XSS 风险）
- Severity: medium → 复核降为 low
- 位置：`apps/web/src/app/api/storage/[bucket]/[...key]/route.ts:45-63`
- WHY：路由把对象内容回写到与主站同源的 /api/storage/... 路径，Content-Type 仅按扩展名映射，未知扩展回退 application/octet-stream，无 nosniff 也无 Content-Disposition。avatars 桶内容来自用户上传，key 扩展名由客户端任意指定（正则允许 .html/.svg），S3 直传 PUT 的 Content-Type 由客户端设置。
- 修复建议：所有成功响应无条件加 `X-Content-Type-Options: nosniff`；非图片白名单扩展加 `Content-Disposition: attachment`；next.config.mjs headers() 为 /api/storage/:path* 兜底注入 nosniff 与限制性 CSP；上传侧 key 校验收敛为图片白名单。
- 复核结论：降 low。GET 返回 application/octet-stream（惰性回退）而非 text/html/svg+xml，现代浏览器不会把 octet-stream 嗅探为可执行类型；S3 SigV4 还 pin ContentType。实际为纵深防御缺口而非可利用存储型 XSS。

#### S-M11. Creem 积分购买 webhook 不校验实付金额/币种与套餐价（A11 既有项仍存在）
- Severity: medium
- 位置：`apps/web/src/app/api/webhooks/creem/route.ts:185-267`
- WHY：handleCreditPurchase 直接按 metadata.packageId 查服务端套餐并发放 pkg.credits*quantity，从不读取 data.order.amount/currency 交叉校验（字段在 creem.ts:111-121 可用）。对照 EPAY 履约 epay-fulfillment.ts:185/262 都调 isExpectedEpayAmount 拒绝金额不符；Creem 路径无等价门闩。若 Creem 产品价配置与套餐 price 漂移、或 product↔package 映射错配，用户可能以低价产品触发高 credits 发放。
- 修复建议：发放前从服务端套餐按 realPlan 重算 expectedAmount，将 data.order.amount（分）换算后与之比对，超容差即拒绝并告警；校验 data.order.currency。落地前对齐 Creem 产品价配置。
- 复核结论：维持 medium。HMAC 验签防篡改，实际可利用性依赖服务端误配/映射漂移而非直接用户可控输入，属纵深防御缺口。

### 2.4 Low

#### S-L1. consumeCredits 幂等查找与偏唯一索引未按 userId 归属，跨用户 sourceRef 碰撞会扣错账户/返回他人交易
- Severity: low
- 位置：`packages/shared/src/credits/core.ts:491-521, 664-693`；迁移 `packages/database/drizzle/0027_credits_transaction_idempotency.sql:20-22`
- WHY：consumeCredits 幂等快路与并发兜底都仅按 `(type='consumption', sourceRef)` 查询，未加 eq(userId)；migration 0027 偏唯一索引也只在 (type, source_ref) 上（全局唯一）。若两个不同用户出现相同 sourceRef，第二个用户的真实扣费会被唯一冲突或快路命中而整体跳过（应扣未扣），并返回首条交易 amount。
- 修复建议：两处 existing 查询加 `eq(creditsTransaction.userId, userId)`；将 0027/0025 偏唯一索引改为 (user_id, type, source_ref) / (user_id, source_type, source_ref)。
- 复核结论：维持 low。当前所有 sourceRef 派生自服务端生成的随机 generationId（nanoid/randomUUID），客户端无法构造碰撞；属纵深防御。修正：返回的余额是 passed userId 的正确余额，泄漏的是他人交易 amount/consumedBatches 元数据，主要影响是应扣未扣。

#### S-L2. Creem 订阅/积分发放在 grantCredits 失败时吞异常并返回 webhook 成功，依赖人工补发
- Severity: low（info→low）
- 位置：`apps/web/src/app/api/webhooks/creem/route.ts:246-282, 568-610`
- WHY：两处 grantCredits 包 try/catch，catch 仅 logError 不重抛（注释明示由人工补发），外层仍返回 200。Creem 视 200 为已消费不再重投，瞬时 DB 故障导致积分永久缺发，只能人工翻日志补发。对照 epay 失败会 throw 回退订单 pending 以重试。
- 修复建议：区分错误类型——幂等命中可安全返回 200；瞬时/未知错误上抛返回 5xx 触发 Creem 重投（credits_batch 唯一索引保证重投不双发）；落"待补发"表 + 高优先级告警。
- 复核结论：info→low。非攻击者可利用，但付费用户积分可在瞬时失败时永久缺发、唯一恢复是人工读日志，且 epay 已有更优范式，可执行可追踪。

#### S-L3. 成品图下载上游 imageUrl 未经 SSRF 校验（toImageBuffer）
- Severity: low
- 位置：`apps/web/src/features/image-generation/operations.ts:247-268`
- WHY：storeGeneratedImageOutput → toImageBuffer 在结果仅含 imageUrl 时 `await fetch(result.imageUrl)`（第262行），无 assertPublicImageUrl/fetchPublicImage，未限重定向/大小。result.imageUrl 来自上游后端 JSON 的 image.url，在 pool-api/自定义 baseUrl/relay 后端下上游半可信；返回 image.url 指向内网即借我方服务器回源。
- 修复建议：toImageBuffer 的 imageUrl 下载分支改用 fetchPublicImage（含大小上限）。
- 复核结论：维持 low（上游半可信、触发者多为特权用户）。修正：部分图 onPartialImage 仅透传给客户端 emit，服务端不 fetch，不存在"部分图回源"SSRF；唯一服务端回源点是 toImageBuffer:262。

#### S-L4. 结算后越过 pending 超时会把成功生成判失败并退款，图片对象成为存储孤儿
- Severity: low
- 位置：`apps/web/src/features/image-generation/operations.ts:2115-2185`
- WHY：成功路径在 2115 行 settleChargedCredits 完成正式扣费且图片已 putObject 后，2183-2185 行仍执行 `if (isTimedOut()) return failTimedOutGeneration();`，把仍为 pending 的 generation 置 failed 并近乎全额退款。生成耗时刚跨过 IMAGE_GENERATION_PENDING_TIMEOUT_MS 时触发（慢后端/大图）。
- 修复建议：settleChargedCredits 成功后不再因 isTimedOut 翻转退款，将超时检查前移到 settle 之前；若仍翻转则同步删除已写对象保持账实一致。
- 复核结论：维持 low。修正定性：超时路径不持久化 storageKey、错误响应/流事件不含 URL、key 为不可猜 nanoid(32)，用户无法发现孤儿对象 URL，故非"可访问/可分享免费出图"，真实影响为产出图被判失败近乎全退（账面少扣）+ 永不回收的存储孤儿（账实不一致）。

#### S-L5. validateCallbackUrl 仅校验主机却允许 http://，回调明文外发生成结果
- Severity: low
- 位置：`apps/web/src/features/external-api/async-image-tasks.ts:73-75`
- WHY：validateCallbackUrl 接受 http: 与 https:。异步回调 body 含生成图像数据与 generation_id；callback_url 为 http:// 时 postAsyncImageCallback 明文 POST，中间人可读取/篡改。
- 修复建议：回调 URL 强制 https:（拒绝 http:），如需内部测试加显式开关；与 S-H3 逐跳 SSRF 复检统一处理回调出站策略。
- 复核结论：维持 low（纵深防御/隐私边界）。攻击/受害者为 API caller 自身，须主动配 http:// 指向自有基建，结果数据常为 CDN URL，平台不强制明文。

#### S-L6. 存储 Server Action 用 key.includes(userId) 子串匹配做归属校验，校验过弱可被构造绕过
- Severity: medium → 复核降为 low
- 位置：`packages/shared/src/storage/actions.ts:86-90, 139-142`
- WHY：getSignedUploadUrlAction 与 deleteFileAction 归属校验为 `if (!key.includes(userId)) throw`，子串匹配非前缀/路径段匹配；key 正则允许 `/` 与 `..`，S3 provider 不规范化路径。理论上可构造含自身 userId 子串的 key 操作非自身命名空间对象；若一 userId 恰为另一 userId 子串则可越权。
- 修复建议：改强前缀/路径段匹配（要求 key 以 `${userId}/` 或 `${userId}-` 前缀开头并据此规范头像命名空间）；校验前规范化 key 并拒绝 `..`/反斜杠/前导 `/`/空段；显式限定 bucket 白名单。
- 复核结论：降 low。bucket 白名单（仅 avatars 桶）限制无法跨桶；Better Auth 随机长 id 使"定向覆盖他人头像须其 key 含攻击者完整随机 id 子串"实际不可能；`..` 在 S3 非目录逃逸。当前真实影响仅"在 avatars 桶内写/删任意含自身 id 的 key"（自身命名空间垃圾写入）+ 一处潜伏弱校验。

#### S-L7. 验证既有项仍存在：generations 桶对象经 /api/storage 完全无鉴权/无归属校验，仅靠不可猜 key 保护
- Severity: low
- 位置：`apps/web/src/app/api/storage/[bucket]/[...key]/route.ts:25-67`
- WHY：GET handler 全程无 session/属主判断，仅 bucket 白名单 + `..`/反斜杠/前导斜杠校验后直接 getObject 返回。generations 桶存放所有用户生成图（key=`${userId}/${nanoid(32)}.ext`）与参考图。响应带 immutable 长缓存头，URL 泄露即对象泄露且无服务端撤销。
- 修复建议：generations 桶改 session + 属主校验（从 key 的 `${userId}/` 段比对会话 userId）或短时签名 URL；avatars 可保持公开。落地前 UI 实测避免破坏全站图片渲染/外链/og:image。
- 复核结论：维持 low（团队 A15 自评一致）。修正：参考图 key 段为服务端 randomUUID（image-edits.ts:724/agent-images.ts:1080），非客户端可预测；"预测 generationId 放大暴露"前提不成立。本质是 122-190 bit 不可猜能力 URL 设计 + URL 泄露 + 长缓存风险。

### 2.5 Info

#### S-I1. getGenerationById 在每次读取时触发全用户范围的 expireStalePendingGenerations（无 userId 作用域）
- Severity: info
- 位置：`apps/web/src/features/image-generation/queries.ts:23-31`（对比 37/55 行均带 userId）
- WHY：getGenerationById 第 24 行调用 `expireStalePendingGenerations({limit:100})` 未传 userId，会对全体用户超时 pending 做扫描/置失败/退款；同文件其他读取都正确传 {userId}。退款幂等且只发给批次本人，故非经济越权，但把全局维护下放到读路径构成写放大。
- 修复建议：为该函数加 userId 入参并按 {userId} 作用域调用；或读路径移除该副作用仅依赖 scheduled-jobs；并核对调用方是否校验返回行归属（IDOR）。
- 复核结论：降 info。getGenerationById 当前为零调用点的死代码（仅桶文件再导出），攻击/资源消耗面不可达，影响为零；属潜在脚枪，将来接线前需修。

#### S-I2. 代理密钥配置不对称：/moderate 入站接受 PROXY_SECRET 与 GATEWAY_SECRET，但出站只发送 PROXY_SECRET
- Severity: info
- 位置：`packages/shared/src/moderation/index.ts:159-161`（getProxySecret）, `656-663`（出站 header）；对照 `apps/web/src/app/moderate/route.ts:24-29`
- WHY：入站 getProxySecrets() 接受两个密钥任一匹配即放行；出站 getProxySecret() 只读 PROXY_SECRET。运维轮换/下线 PROXY_SECRET 时可能误判"配了 GATEWAY 出站就会用"，导致自调用鉴权失败、审核静默降级。
- 修复建议：在 getProxySecret/getProxySecrets 处补 WHY 注释，明确 PROXY_SECRET=出站主密钥、GATEWAY_SECRET=仅入站附加。无需改名（涉及迁移成本）。
- 复核结论：降 info。definitions.ts:729/737 字段 description 已说明二者语义，且 route.ts:33-35 有 fail-closed 兜底，认知陷阱已缓解；仅源码缺 WHY 注释这一可选改进。

#### S-I3. credits/expire 端点把内部异常 message 回显给调用方
- Severity: info
- 位置：`apps/web/src/app/api/jobs/credits/expire/route.ts:67-78`
- WHY：catch 分支把 error.message 原样放进 JSON 响应；processExpiredBatches 内部 DB 事务抛错时 message 可能含 DB/约束细节。位于 CRON_SECRET 鉴权之后，且与同目录其余三个端点不一致（它们不回显原始异常）。
- 修复建议：catch 中仅记日志，对调用方返回固定通用错误体（如 `{success:false,error:"internal_error"}`）。
- 复核结论：维持 info。泄露内容为 server 端 error.message 非用户数据/密钥，且需持有 CRON_SECRET。

---

## 3. 可维护性与重构（Maintainability）

按 severity 从高到低。

### 3.1 High

#### M-H1. 财务核心 credits/core.ts 无任何活跃单元测试，现有 credits 测试位于已废弃 root src/test 树
- Severity: high
- 位置：`packages/shared/src/credits/core.ts:475-697`（consumeCredits）, `337-464`（grantCredits）, `705-838`（void）, `846-941`（processExpiredBatches）
- WHY：core.ts 承载 FIFO 扣费/发放幂等/升级作废/过期回收/双重记账，但 packages/shared vitest 仅跑包内 *.test.ts，该包下唯一相关测试 idempotency.test.ts 只测纯工具函数。看似覆盖 core 的大量测试（src/test/credits/*）从 `@/features/credits/core` 导入 legacy 死树，给 live core.ts 制造虚假覆盖率。任何对 live core.ts 的重构无回归网。
- 修复建议：将 core.ts 纯逻辑（FIFO 选批、normalizeCreditAmount、幂等结果构造、target/refund 数学）抽到不 import @repo/database 的模块补 DB-free 单测；DB 路径在 packages/shared 内以 mock db/真实测试库补集成测试进入 turbo test 门禁；删除/迁移 root 死测试。
- 复核结论：维持 high（覆盖率/可维护性缺口而非运行时缺陷，覆盖最敏感财务代码且 CLAUDE.md 明确要求此类单测）。

#### M-H2. service.ts 是 5310 行超级模块，混杂 7+ 个不相关职责
- Severity: high
- 位置：`apps/web/src/features/image-backend-pool/service.ts:1-5310`
- WHY：单文件承载后端调度/失败错误分类/冷却解析/OAuth token 刷新/Web 账号手工导入/Sub2API 外部 Postgres 同步（含原始 SQL）/分组账号 API CRUD 共 7 类无关职责，被 actions/调度管线/定时任务引用。严重违背单一职责，合并冲突高发、单测难聚焦。
- 修复建议：按职责拆为 backend-scheduler.ts、backend-error-classification.ts（纯函数 DB-free）、cooldown-parsing.ts、oauth-token-refresh.ts、account-import.ts、sub2api-sync.ts、backend-crud.ts；service.ts 作 re-export barrel 过渡；优先抽纯函数。
- 复核结论：维持 high（最大模块、位于关键生成/调度路径、违反 MUST 级 CLAUDE.md 约束、test-ergonomics 已被 env-stub workaround 证实）。

#### M-H3. admin-panel.tsx 是 4350 行 client 上帝组件，25+ 个 useState
- Severity: high
- 位置：`apps/web/src/features/image-backend-pool/admin-panel.tsx:1-4350`
- WHY：单 'use client' 组件 4350 行，同时管理分组/账号/API CRUD、批量操作、三种导入对话框、Sub2API 同步与自动同步任务、分页搜索筛选全部 UI 状态。大量交织状态，任一 Tab 改动需回归全部表单。
- 修复建议：按 Tab/功能域拆为 GroupsTab/AccountsTab/ApisTab/ImportDialogs/Sub2ApiSyncPanel，各持局部 useState；共享数据用轻量 context 或父级 useReducer 收敛。
- 复核结论：维持 high（纯技术债，但 4000+ 行回归面 + 四 Tab 状态交织 + docs/TODO 已记同类组件 PR 门禁阻塞）。修正：create-page-client.tsx 在 image-generation 目录非同目录；useState 实为 25 个。

#### M-H4. 封禁(banned)鉴权逻辑分裂（同 S-H7，maintainability 视角）
- 见 §2.3 S-H7。修复时统一抽 `assertUserNotBanned`。

#### M-H5. 管理员区域鉴权样板逐页手写重复，共享 checkAdmin() 形同死代码；ban 用 adminAction 而改角色用 superAdminAction，权限模型不对称
- Severity: high
- 位置：`apps/web/src/app/[locale]/(dashboard)/dashboard/admin/users/page.tsx:13-23`（与 admin/settings/page.tsx:14-29、admin/status、admin/announcements 雷同）
- WHY：(1) 每个 admin 页手写 `getServerSession→未登录 redirect→getUserRoleById→canAccessAdminArea/canViewImageBackendPool 不符 redirect` 样板（至少 4 页），而 admin.ts 已提供 checkAdmin() 却无人使用；无 admin 段 layout.tsx 集中守卫，新增页忘复制即越权暴露；不同页能力判定已漂移（settings 用 canViewImageBackendPool，users 用 canAccessAdminArea）。(2) banUserAction 用 adminAction、updateUserRoleAction 用 superAdminAction，普通 admin 能封禁但封禁目标无角色层级校验，可封 super_admin/其他 admin/自己。
- 修复建议：新增 admin/layout.tsx 调 checkAdmin() 集中守卫并删各页样板；banUserAction/updateUserRoleAction 增目标保护（禁操作自身、禁 admin 操作 ≥自身等级目标），把"谁能改谁"集中到 roles.ts。
- 复核结论：维持 high。载荷影响是真实的 broken-access-control（普通 admin 可封 super_admin/peers/self），非单纯重复；与 S-H5 同源。

#### M-H6. StorageProvider 接口在 local 与 s3 实现间语义严重不一致，是隐性陷阱
- Severity: high
- 位置：`packages/shared/src/storage/providers/local.ts:47-57`
- WHY：接口声明 getSignedUrl/getSignedUploadUrl 返回"签名 URL"。local 两者都只返回普通 GET 路由 `/api/storage/{bucket}/{key}`：忽略 contentType/expiresIn，且 getSignedUploadUrl 返回的根本不是可上传 URL（路由只实现 GET，PUT 命中只读返回 405）。s3 实现返回真正预签名 PUT/GET。调用方据此假设统一行为：settings-profile-view.tsx:301 对 uploadUrl 发 PUT（local 后端下 405 失败），request-utils.ts:122 期望短时效（local 下 URL 永不过期且无鉴权）。types.ts 注释"签名后的 URL"对 local 是误导。
- 修复建议：接口层区分能力（让 local 走真正本地上传端点并校验属主/类型/大小，或显式建模"后端是否支持预签名/过期"由调用方分支）；修正 types.ts 注释。
- 复核结论：维持 high。已是具体功能 Bug（local 后端默认配置下头像上传必坏 405）；moderation-image 路径有 try/catch 降级。不 critical：失败可见非静默损坏，许多生产设 STORAGE_ENDPOINT。

#### M-H7. create-page-client.tsx 是 9233 行单文件，CreatePageClient 是 ~7480 行单组件（God Component）
- Severity: high
- 位置：`apps/web/src/features/image-generation/components/create-page-client.tsx:1749-9233`
- WHY：除若干 helper 外只导出 CreatePageClient（1749 到末尾约 7480 行），经 useCreateRuntimeState/useState/useRef 维护 74+ 处运行时状态，承载 text/image/edit/chat/agent/waterfall 六种模式全部 UI 与请求逻辑。74 个扁平 string key 共享在一个 Map 里无类型约束，新增状态易冲突或漏清理；任何 PR 触碰此文件被既有 lint error 卡住。
- 修复建议：六模式各抽独立子组件；共享请求/流式/积分逻辑下沉自定义 hook；无副作用纯函数先迁出补单测，逐模式抽离，每抽一块即提交并跑 typecheck/test。
- 复核结论：维持 high（严重违反 CLAUDE.md 单一职责 MUST 规则 + 无类型扁平 key Map 是具体隐患）。

### 3.2 Medium

#### M-M1. runQueuedImageGenerationForUser 是 ~1100 行单函数，承担扣费/审核/调用/存储/结算/退款/元数据全部职责
- Severity: medium
- 位置：`apps/web/src/features/image-generation/operations.ts:1185-2279`
- WHY：单函数约 1100 行、27 个解构参数，混合插入 generation 行、初始扣费、超时判定、审核、上游分发、对象存储、按实际尺寸结算、写多份 metadata。有 7 处几乎相同的失败收尾模板（settle try/catch + db.update failed + return）。失败收尾语义改动需 8+ 处手工同步；30 参数靠位置约定易错配。
- 修复建议：抽统一 failGeneration({...}) 助手封装 settle + status:failed + 返回结构，所有失败分支调用它；成功落库/成功结算各拆独立函数；27 参数收敛为 RunContext 对象按职责分组。
- 复核结论：维持 medium（无活跃 Bug，每分支共用同一 isPendingGeneration 幂等守卫 + 共享 credit-target helper 限制漂移半径）。修正：参数 27 个非 30；credit-math 已由 getFailedGenerationTargetCredits 集中。

#### M-M2. mixWebFirst 在两个函数中以不同条件重复计算，存在语义分叉（漏掉 requiresResponsesBackend）
- Severity: medium → 复核维持 medium
- 位置：`apps/web/src/features/image-generation/operations.ts:849-854, 1262-1264`
- WHY：mixWebFirst 在 runImageGenerationForUser（849-854）含 `!requiresResponsesBackend`，但在 runQueuedImageGenerationForUser（1262-1264）重算时少了该项，而后者计算值正是传给 editImage/generateChatImage/generateImage 的值。
- 修复建议：在 runImageGenerationForUser 计算一次后作为参数传入 runQueued，删除被调函数内重算；抽 resolveBackendRouting(input,size) 纯函数单点定义。
- 复核结论：维持 medium。修正影响：effectiveConfig/billing 用第一函数的正确值；queued 重算值仅影响 retryPoolBackendResult 的 retry-time accountBackendPreference，唯一未守护路径是 chat+agentMode+mixWebFirst+1K 的 retry 后端误选，属路由低效非计费缺陷。

#### M-M3. 8(实为7)处结算失败被 try/catch 空块吞没，注释仅 'best effort settlement'，无日志可追溯
- Severity: medium
- 位置：`apps/web/src/features/image-generation/operations.ts:1535-1537, 1584-1586, 1715-1717, 1756-1758, 1798-1800, 2018-2020, 2165-2167`
- WHY：settleChargedCredits/refundChargedCredits 在失败分支被 `try{...}catch{ /* best effort */ }` 包裹，catch 空、不记日志。结算/退款直接操作 credits_transaction，抛错被静默吞掉，generation 置 failed 且 creditsConsumed 写成 chargedCredits 但实际积分账可能不一致，无任何日志线索对账。
- 修复建议：空 catch 改 logWarn/logError（已 import logWarn），记录 generationId/sourceRef/targetCredits/error.message；结合 failGeneration 助手统一封装；上报告警指标。
- 复核结论：维持 medium。修正：实为 7 处空 catch（line 1828 chat-text-only 的 catch 非空）；结算/退款 sourceRef 幂等 + generation 仍置 failed + expireStalePendingGenerations 独立兜底，故实际危害是可观测性而非确定双花/少扣。

#### M-M4. image-backend-pool 后端错误关键词分类逻辑大量重复，散落 7 个函数难以同步维护
- Severity: medium
- 位置：`apps/web/src/features/image-backend-pool/service.ts:445-680`
- WHY：isRecoverableBackendError 等 7 个函数各维护几十条 normalized.includes(...)，彼此高度重叠（"429"/"rate limit"/"too many requests" 出现 9 处）。新增上游错误模式需多处同步，易遗漏导致分类与冷却策略不一致（影响调度切换与扣费/退款判定）。
- 修复建议：抽单一 ERROR_KEYWORDS 常量表（按类别），各函数查表 + some()；isUsageLimit 作为 isRecoverable 子集组合；补关键词→分类快照测试。
- 复核结论：维持 medium。修正：classifyFailure 实际内联 429/rate-limit 字符串，并不调用 isResetAwareLimitedBackendError（后者由 isMeaningfulSourceCooldownForError 消费）。

#### M-M5. refreshTokenWriteBackCount 与 refreshTokenWrittenBack 是恒为 0/false 的死字段，制造误导
- Severity: medium
- 位置：`apps/web/src/features/image-backend-pool/service.ts:4585-4953`
- WHY：syncImageBackendAccountsFromSub2Api 返回 refreshTokenWriteBackCount:0，createSub2ApiSyncAggregate 初始化 0，runSub2ApiSyncConfig/runAutoSub2ApiAccessTokenSync 还累加它，但全路径从不赋非 0；refreshTokenWrittenBack 恒 false。暗示存在"RT 回写"功能但未实现，命名误导 + 死计算。与功能完整的同名兄弟字段 refreshTokenRotatedCount 并存会主动误导调试者。
- 修复建议：若 RT 回写未实现，删除 refreshTokenWriteBackCount 的初始化/累加/返回及 refreshTokenWrittenBack 字段（删除后类型与调用方仍一致）；若计划中则落实或在 docs/TODO 显式标注未实现。
- 复核结论：维持 medium（虽爆炸半径有限，但"墓碑式假统计 + 命名误导"组合主动误导）。

#### M-M6. 三段近乎相同的 Sub2API 原始 SQL（list/count/sourceIds）内联重复，过滤条件易漂移
- Severity: medium
- 位置：`apps/web/src/features/image-backend-pool/service.ts:3740-3903`
- WHY：listSub2ApiCurrentAccessTokens/countSub2ApiCurrentAccessTokens/listSub2ApiCurrentAccessTokenSourceIds 各自内联几乎一致的 WHERE（deleted_at IS NULL、platform='openai'、type='oauth'、credentials 键、source group EXISTS、plan_filter 三态），仅 SELECT 列与 $ 序号不同。任何筛选语义调整须三处同步，否则 count 与 list 口径悄悄不一致，导致分页 hasMore/cleanup 错误（清理逻辑依赖三者一致，4553-4570）。原始 SQL 拼接绕开 Drizzle 类型检查。
- 修复建议：抽 buildSub2ApiAccountFilter(params) 返回 SQL 片段 + 参数三处复用；或整体迁入 sub2api-source-repository.ts 模块。
- 复核结论：维持 medium（当前三处一致无 live drift，但 count/list/cleanup 不变量 load-bearing 且未在代码中文档化）。

#### M-M7. 升级补差比例计算的金额数学与积分两位取整逻辑在多处重复（CREDIT_DECIMAL 三处+）
- Severity: medium
- 位置：`packages/shared/src/credits/core.ts:25-26,64-72`; `apps/web/src/features/image-generation/resolution.ts:21-23,75-87`; `apps/web/src/features/external-api/quota.ts:5-13`
- WHY：`CREDIT_DECIMAL_PLACES=2`、`CREDIT_DECIMAL_FACTOR` 及 `Math.round((v+EPSILON)*F)/F` 在三个文件完全复制（扣费落账 / 定价 / API key 配额），共享同一精度不变量但命名分化（roundCreditAmount/roundQuotaCredits）。改精度只改一处即造成各路径口径不一致（对账分位级偏差）。
- 修复建议：在 packages/shared 提供单一 credit-rounding 模块（导出 CREDIT_DECIMAL_PLACES、roundCredit、roundUpCredit），三处全部引用并删本地副本。
- 复核结论：维持 medium（当前输出一致无现存差异，风险条件性）。修正路径：第二副本在 image-generation/resolution.ts 非 credits/resolution.ts；重复还存在于 generation-settlement.ts:47、admin-users.ts:294、credit-calculation-details.ts:73，均应迁移。

#### M-M8. relayOnly（纯中转）分叉路径登记（同 §4 测试缺口，maintainability 视角略）
- 见 §4 C-... relayOnly 覆盖条目；维护建议是把 relay 分叉抽到可注入编排层。

#### M-M9. Webhook 事件体用 as 断言强转，缺运行时校验
- Severity: medium
- 位置：`apps/web/src/app/api/webhooks/creem/route.ts:84-116, 143-147`
- WHY：constructRuntimeCreemEvent 仅 `JSON.parse(payload) as CreemWebhookEvent` 无 Zod；路由进一步 `event.object as ...` 全靠 eventType 字符串盲转。Creem 改字段名/结构或发未预期事件时类型系统无保护，运行时 undefined 解引用或静默走错分支（如 checkoutType 默认回退 'subscription'）。违反 CLAUDE.md "校验一切外部输入优先 Zod"。
- 修复建议：为 CreemWebhookEvent 及其 object 变体定义 Zod schema，验签后 schema.parse 收窄为判别联合，替换所有 as；解析失败记 eventType 并返回 4xx/记日志。
- 复核结论：维持 medium。HMAC 防伪造 + 外层 try/catch 返 500 + 服务端 config 查询 + DB 幂等限制实际爆炸半径；唯一真静默误分支是 checkoutType 默认 subscription。建议在 packages/shared/payment/creem.ts 加 schema 覆盖 apps/web 与 legacy 两份副本。

#### M-M10. 订阅积分发放逻辑在 Creem 路由与 epay-fulfillment 中重复且分叉
- Severity: medium
- 位置：`apps/web/src/app/api/webhooks/creem/route.ts:506-611`
- WHY：grantSubscriptionCredits 在 creem/route.ts 与 epay-fulfillment.ts 各写一遍（credits_batch 幂等查重、getSubscriptionMonthlyCredits、按年/月算 creditsToGrant、组装参数、算 expiresAt）。已分叉：年付判定不同（Creem periodDays>60 启发式 vs epay metadata price.interval==='yearly'），sourceRef 命名不同，仅 epay 处理 upgrade 作废。handleCreditPurchase 也重复。
- 修复建议：抽 @repo/shared 下 grantSubscriptionCreditsForPeriod({...}) 与 grantCreditPackagePurchase(...)，两链路统一调用，差异（年付判定/sourceRef）作入参传入。
- 复核结论：维持 medium。修正：每套餐月度积分值已由 getSubscriptionMonthlyCredits 集中（单一真相），重复的是周边编排（年付判定/*12/sourceRef/expiresAt/作废）。

#### M-M11. Creem webhook 积分发放失败被吞，仅打日志后仍返回 received:true（同 S-L2，maintainability 视角）
- Severity: medium
- 位置：`apps/web/src/app/api/webhooks/creem/route.ts:246-282, 568-610`
- WHY/修复/复核：见 S-L2。与 epay 失败回退 pending 的语义不一致，使可自动恢复的失败降级为脆弱人工运维。维持 high→medium 之间，本条按 maintainability lens 定 medium。

#### M-M12. SSRF 防护逻辑（isPrivateIpAddress/assertPublicImageUrl）在 4 个文件各有一份独立副本，且与共享实现并存
- Severity: high → 复核降为 medium
- 位置：`apps/web/src/features/external-api/safe-image-fetch.ts:27-86`（canonical）; image-edits.ts:116-172; agent-images.ts:419-475; async-image-tasks.ts:40-109
- WHY：safe-image-fetch.ts 已导出权威 assertPublicImageUrl/isPrivateIpAddress 并被 chat-completions/responses 经 fetchPublicImage 复用，但 image-edits/agent-images/async-image-tasks 各粘贴一份字节级几乎相同的私网判定表。SSRF 黑名单是安全敏感逻辑，"修一处漏三处"会形成静默回归。
- 修复建议：删三处本地副本统一从 safe-image-fetch 导入（callback_url 校验在 safe-image-fetch 新增 assertPublicCallbackUrl 复用同一 isPrivateIpAddress）；image-edits/agent-images 的前置 assertPublicImageUrl 与 fetchPublicImage 逐跳校验重复可移除前置仅保留 fetchPublicImage。
- 复核结论：降 medium。image-edits/agent-images 的本地副本是冗余前置（其后立即 fetchPublicImage 用 canonical 复检），drift 不会单独开 SSRF 洞；唯一无兜底的是 async-image-tasks 的 validateCallbackUrl（callback_url 唯一守卫 + 默认 redirect:follow）。

#### M-M13. multipart/JSON 图片引用解析在 image-edits 与 agent-images 间大段重复
- Severity: high → 复核降为 medium
- 位置：`apps/web/src/features/external-api/handlers/agent-images.ts:172-509` 与 `image-edits.ts:174-453`（splitUrlList/addUrlReference/jsonReferenceToUrl/getFormImageReferences/getJsonImageReferences/formDataFromJson/getText/getOptionalBoolean/getFileExtension/parseData*/fetchImageReference/resolveImageReferences）
- WHY：两文件（917/1270 行）各实现约 14 个同名解析 helper 逻辑几乎逐行相同（仅错误类名/前缀不同）。入参解析的 bug 修复须两处同步，易遗漏致端点行为分叉。
- 修复建议：抽 external-api/image-reference.ts（导出类型与各 helper，统一带 status 的 ImageReferenceError）+ external-api/form-fields.ts；两 handler 引用共享模块。
- 复核结论：降 medium（当前同步无 live bug，纯 drift 风险）。修正：重复约 14 个 helper 非 55；getFileExtension 在两文件语义不同（一个取文件扩展名，一个映射 content-type），实为同名异义，更强化抽取理由。

#### M-M14. 流式/部分图载荷构造器（toStreamCompletedPayload/toPartialPayload/parseDataImageUrl）在多个 handler 间复制，仅靠 type 字符串区分
- Severity: medium
- 位置：`apps/web/src/features/external-api/handlers/image-generations.ts:75-128` 与 `image-edits.ts:455-508`；parseDataImageUrl 重复于 chat-completions.ts:135-144 与 responses.ts:442-451
- WHY：toStreamCompletedPayload/toPartialPayload 在 generations/edits 是逐行拷贝（仅 type 字面量不同，4 处定义）；parseDataImageUrl 在 chat-completions 与 responses 结构相同。"仅常量不同"复制隐性耦合，如修复 url 模式 base64 退化的 MIME 硬编码（一律 png，即便 webp/jpeg）需 4+ 处分别改。
- 修复建议：toStream/toPartial 提到 images.ts 加 `kind` 参数派生 type；parseDataImageUrl 提到 images.ts 或 image-reference.ts 单点导出；顺带修复 MIME 派生（detectImageOutputFormatFromBuffer + getOutputFormatContentType）。
- 复核结论：维持 medium。修正：parseDataImageUrl 非字节级相同（name 字段不同）；MIME 修复不能读 output.outputFormat（output 类型无该字段），须 thread 请求 output_format 或嗅探字节。

#### M-M15. 每个 handler 先 authenticateExternalApiRequest（内部已 getUserPlan）后又重复 getUserPlan(auth.userId)，计划/能力解析分散且双查
- Severity: medium
- 位置：`apps/web/src/features/external-api/auth.ts:65`；各 handler 重复：image-generations.ts:175、image-edits.ts:534、chat-completions.ts:351、responses.ts:651、agent-images.ts:852
- WHY：authenticateExternalApiRequest 已调 getUserPlan 并返回 auth.plan，但 5 个 handler 又各自 getUserPlan(auth.userId) 再取一次：每请求两次 getUserPlan（性能 + 一致性风险）；image-generations 用 auth.plan 第一道校验却用第二次 plan.plan 后续校验（命名并存难判权威）；能力门禁序列在 5 处各写一遍。
- 修复建议：让 authenticateExternalApiRequest 返回已解析 plan 对象，handler 不再二次 getUserPlan，统一用 auth.plan；通用能力门禁抽 assertImageRequestAllowed(auth,{count,wantsStream}) 复用。
- 复核结论：维持 medium（DRY/一致性 + 每请求多一次 DB round-trip，无正确性/安全影响）。

#### M-M16. getStorageProvider / s3Client 进程级永久单例缓存，与运行时配置设计冲突
- Severity: medium
- 位置：`packages/shared/src/storage/providers/index.ts:4-18`
- WHY：getStorageProvider 把首次解析的 provider 存入模块级 cachedProvider 永不失效；s3.ts:27 的 s3Client 同样永久缓存。但选择依据 STORAGE_ENDPOINT 及 access key/region 全来自 getRuntimeSettingString（运行时可改）。管理员后台从 local 切 S3 或轮换密钥后，运行进程仍用旧 provider/凭证，须重启；多实例缓存还可能不一致，且无注释说明。
- 修复建议：缓存加失效机制（按运行时设置版本号/指纹做 key，设置变更即失效，或写入处广播失效，或短 TTL）；至少在 index.ts 与 s3.ts 顶部补"改存储相关运行时设置需重启"注释并在面板提示。
- 复核结论：维持 medium。

#### M-M17. 两套并存且分叉的 S3 客户端配置（共享 provider vs upload 路由内联）
- Severity: medium
- 位置：`apps/web/src/app/api/upload/presigned/route.ts:12-23`
- WHY：presigned 路由直接 new 独立 S3Client，与 s3.ts 的 s3Provider 各维护一套配置：(1) 路由读 process.env，s3Provider 读 getRuntimeSettingString，运行时来源不一致；(2) 路由用 STORAGE_BUCKET_NAME，其余用 NEXT_PUBLIC_*_BUCKET_NAME，桶命名割裂；(3) 路由没设 forcePathStyle:true，s3Provider 设了——同一 R2/MinIO 端点下两条上传路径寻址风格可能不同。
- 修复建议：presigned 路由复用 s3Provider.getSignedUploadUrl，删内联 S3Client；统一桶名来源与 forcePathStyle；若文档上传桶需独立则通过 provider 传 bucket 参数。
- 复核结论：维持 medium。forcePathStyle 省略 + process.env vs DB 设置分裂是潜在正确性/可操作性风险（R2/MinIO 路径式端点下预签名 PUT 可能 host 错误；面板改存储配置不达此路由）。另存在 src/ 陈旧副本放大重复。

#### M-M18. 用 key.includes(userId) 做属主校验，命名/语义误导且脆弱（同 S-L6，maintainability 视角）
- 见 §2.4 S-L6。复核维持 medium 归类合理（实际不可利用 IDOR，命名/契约误导为主）。

#### M-M19. responses.ts 续承状态依赖单实例进程内 Map 缓存，与 DB 真相双轨
- Severity: medium → 复核降为 low
- 位置：`apps/web/src/features/external-api/handlers/responses.ts:56-59,123-131,228-264`
- WHY：previous_response_id 续承同时存进程内 responseContinuationCache（Map，FIFO，上限 1000）和 generation.metadata。读取先查内存再回落 DB。多实例/重启下随机命中/缺失；缓存键构造与 DB @> jsonb 查询两套逻辑；FIFO 用 keys().next().value 删最旧与 LRU 直觉不符。
- 修复建议：标注缓存仅单实例性能优化、DB 为唯一真相并补注释；或多实例改用 Redis（已有 Upstash）；把键构造/淘汰/DB 查询封进 ResponsesContinuationStore。
- 复核结论：降 low。缓存为纯读穿透优化、DB 为唯一真相、未命中总能正确回落，多实例下功能正确（仅命中率/延迟差异），无正确性问题；真实价值仅补注释 + 可选封装。

#### M-M20. 进程内 inFlightFulfillments Map 做去重，多实例部署失效且注释夸大保护范围
- Severity: medium → 复核降为 low
- 位置：`apps/web/src/features/payment/epay-fulfillment.ts:46-94`
- WHY：fulfillSuccessfulEpayPayment 用模块级 Map<outTradeNo,Promise> 合并同一订单并发履约，仅单进程内存去重。跨实例正确性实际靠 claimEpayOrderForFulfillment 原子 UPDATE + credits_batch 唯一约束。风险是内存 Map 被误当可靠护栏。
- 修复建议：加注释明确"单实例最佳努力优化，跨实例正确性靠 DB claim + 唯一约束"；或删 Map 仅依赖 DB 闸门。
- 复核结论：降 low。当前无实际缺陷（DB 两道闸门完整兜底），纯文档/可维护性，风险假设性。修正：TODO.md 无字面"内存态多实例丢状态"条目（51-52 行为相关但不同说明）。

#### M-M21. AdminUsersManagement 单组件 ~1945 行，含约 10 个结构雷同的 try/catch/toast action 处理函数
- Severity: high → 复核降为 medium
- 位置：`packages/shared/src/support/components/admin-users/admin-users-management.tsx:318-2263`
- WHY：单组件含 60 个 useState，约 10 个 handleX 异步函数遵循完全相同样板（前置校验→setIsX(true)→await xxxAction→data/serverError/异常 toast→finally setIsX(false)）。每操作独立 loading 布尔状态爆炸；next-safe-action 结果处理 10 处复制；列表/筛选/分页/详情 Sheet/多 Dialog/全部写操作单一职责严重缺失。
- 修复建议：用 next-safe-action 官方 useAction hook（项目已用于 image-lightbox.tsx）或抽 runAdminAction(action,input,{onSuccess,successMessage}) 包装器；详情 Sheet/各 Dialog 拆子组件，列表/筛选/分页拆容器。
- 复核结论：降 medium（纯重构债无正确性/安全影响，但违反 CLAUDE.md 单一职责且 10x 复制放大未来改动成本）。修正：useState 60 个非 65。

#### M-M22. admin-users-management.tsx 巨型特权用户管理 UI 职责混杂（另一登记，参 M-M21）
- Severity: medium
- 位置：`packages/shared/src/support/components/admin-users/admin-users-management.tsx:1-2311`
- WHY：单 'use client' 组件 2311 行集中 12 个特权 action 全部状态与对话框（封禁/改角色/加扣积分/改套餐/冻结积分/API Key 启停/新建/编辑/重设密码）。god component，任一特权流程改动需在 2000+ 行定位，易把 super_admin-only 入口误暴露给 canManageRoles=false 的 admin。
- 修复建议：拆 UsersTable+Filters/UserDetailSheet/各特权 Dialog 子组件；super_admin-only 入口可见性判定集中一处。
- 复核结论：维持 medium。修正：UI 越权为未来回归风险非现存漏洞——server action 已正确用 withSuperAdminUsersAction backstop，UI 误连最坏是 disabled-but-clickable，非真实提权。

#### M-M23. system-settings-panel.tsx 是 1825 行巨型客户端组件，混合三种异构编辑器与全部规范化逻辑
- Severity: medium
- 位置：`packages/shared/src/system-settings/components/system-settings-panel.tsx:1-1825`
- WHY：单文件混杂 SettingInput、PlanCapabilityMatrixInput(~325 行)、CreditPackageMatrixInput(~360 行)、大量纯规范化函数（normalize*/compact*）、容器 SystemSettingsPanel。两矩阵编辑器各有独立 draft 类型/规范化/序列化/JSON 预览结构相似却无法复用。DB-free 可单测的 normalize*/compact* 被绑在 'use client' 文件无法被 vitest 覆盖。
- 修复建议：两矩阵编辑器各抽独立组件；normalize*/compact*/as*/numberValue 抽到非 'use client' 模块（matrix-normalize.ts）补单测；容器只保留 Tabs+分组+四 action 编排。
- 复核结论：维持 medium。

#### M-M24. SettingKey 联合类型有 17 个"孤儿" key 不在 SYSTEM_SETTING_DEFINITIONS 中，类型与数据双源漂移
- Severity: high → 复核降为 medium
- 位置：`packages/shared/src/system-settings/definitions.ts:20-159`（类型联合）vs `339-1373`（定义数组）
- WHY：SettingKey 声明 139 个 key，SYSTEM_SETTING_DEFINITIONS 只定义 122 个；17 个 key（PLAN_*_MAX_FILE_MB/MAX_UPLOAD_MB、ENTERPRISE_RESOURCE_PACK_*、ALIYUN_MODERATION_*、SUB2API_AUTO_SYNC_TASKS）只在类型联合。这些 key 被 getRuntimeSettingString/Number 以 SettingKey 形参运行时读取，但因不在 SETTING_DEFINITION_BY_KEY：isSettingKey 返 false 致 setSystemSettings 抛"未知配置项"（类型可写运行时拒写）；不出现在后台面板/不初始化默认/不被 env 收集；SUB2API_AUTO_SYNC_TASKS 不得不在 env-file.ts 用 MANAGED_INTERNAL_ENV_KEYS 白名单特例打补丁。
- 修复建议：(1) SettingKey 从数据派生（const 数组 + `(typeof ...)[number]['key']`）消除双源；(2) 内部 key 引入 InternalSettingKey 分流；(3) 经核实 17 个孤儿均为活跃 env-only 读取（保留 env 回退路径），不可直接删读取，需谨慎；(4) 补 union/数据集合相等单测。
- 复核结论：降 medium。修正：17 个孤儿并非死类型——均经 getRuntimeSetting* 在运行时活跃读取（PLAN_*_MAX 经 applyLegacyPlanSettings、ENTERPRISE_RESOURCE_PACK_* 经 buildFallbackCreditPackages、ALIYUN_* 经 getAliyunConfig），DB 写被阻但 env 回退工作，无 user-facing 破坏，是 env-only 隐性配置面（可能有意），故 recommendation(3) 删读取不安全。

#### M-M25. syncSystemSettingsToEnvFiles 用字符串作 String.replace 替换块，设置值中的 $ 序列会被当成替换模式而损坏
- Severity: high → 本报告归为 SY-H 同源，登记于此
- 位置：`packages/shared/src/system-settings/env-file.ts:75-80`
- WHY：`next = current.replace(/# BEGIN .../g, managed)` 把 managed 作为替换字符串。JS 规范中 $$、$&、$`、$'、$1.. 是特殊替换序列。managed 由各设置值 JSON.stringify 拼接（EPAY_KEY/CREEM 密钥/URL/含 $ 的口令等可能含 $）。某同步值含 $&/$$ 等子串时写回 .env.local 会被替换引擎改写或吞 $，落盘 env 值与 DB 真相不一致，重启后读到坏值且 catch 吞掉无报错。
- 修复建议：用函数式 replacer `current.replace(regex, () => managed)`；或拼接前 `managed.replace(/\$/g,'$$$$')` 转义；补单测断言值含 $&/$$/$1 时逐字保留。
- 复核结论：维持 high（静默损坏部署侧 payment/auth 密钥）。触发需 .env.local 已含旧托管块（走 replace 分支）且某同步值含 $&/$$/$`/$'；$1 因正则无捕获组不损坏，但其余序列会。与 S-M9 的 END 哨兵问题同文件应一并修。

#### M-M26. selectPoolMember 9 个位置参数（多为可选），调用点可读性差易错位
- Severity: low → 归 maintainability（本报告归 low 区，登记于 §3 索引）
- 见 §3.3 M-L1。

#### M-M27. cron validateCronSecret 在 4 个 cron 路由重复实现，且存在 3 种相互分叉变体
- Severity: medium
- 位置：`apps/web/src/app/api/jobs/credits/expire/route.ts:30-49`（另见 image-backend/sub2api/sync/route.ts:9-24、image-backend/web-accounts/refresh/route.ts:9-24、images/expire-pending/route.ts:8-33）
- WHY：相同职责的 Bearer 鉴权函数被复制进 4 个路由且已分叉 3 种：(1) credits/expire 版同步且缺 `tokenHash.length !== secretHash.length` 长度防御（其余 3 个有）；(2) credits/expire 与 expire-pending 缺 CRON_SECRET 时 console.warn，两个 image-backend 版静默 false；(3) sub2api/web-accounts 是 async，另两个 sync。鉴权是安全敏感单点，分散成 4 份后任何加固须手动同步 4 处。
- 修复建议：抽单一共享 assertCronSecret(authHeader)（统一带长度守卫的 timingSafeEqual、统一 Pino 日志），4 路由调用并删本地副本；可提供 withCronAuth(handler) 收敛样板。可复用 epay.ts 已有的 timingSafeEqualString。
- 复核结论：维持 medium（前瞻性 DRY，所有变体当前都正确鉴权，但已 3 变体 + 未来加固须同步 4 文件）。

#### M-M28. cron-expire 测试验证的是与生产完全不同的第 4 份 validateCronSecret 实现，构成假绿灯
- Severity: high → 复核降为 medium
- 位置：`src/test/jobs/cron-expire.test.ts:44-59, 65-100`
- WHY：测试注释自称"从 route.ts 提取"，实际文件内重新实现明文 `token === cronSecret` 比较，而生产用 sha256 + timingSafeEqual，边界行为根本不同；对生产路由零覆盖。该文件位于 root 死 src/ 树（不在 workspace、不部署），但根 vitest.config.ts include `src/test/**` 仍会拾取它。
- 修复建议：删测试内私有副本，改 import 抽出的共享 assertCronSecret 并断言；或随死树一并删除；核对根 vitest 项目是否仍应存在。
- 复核结论：降 medium。turbo test（CI 入口）不含仓库根，apps/web vitest 不拾取根 src/test，故该测试不在 CI 路径、不阻断/拖慢 CI，覆盖的还是死代码树文件；真实危害限于假信心 + 逻辑副本扩散。

#### M-M29. cron 路由使用 console.warn/console.error 而非 Pino logger
- Severity: low → 归 maintainability low（见 §3.3 M-L2）

#### M-M30. credits/expire 路由顶部文档块引用 Vercel Cron + vercel.json，与实际 Docker/Nginx 部署不符
- Severity: low → 归 maintainability low（见 §3.3 M-L3）

> 备注：image-backend-pool 错误关键词谓词族重复（M-M4）、Sub2API SQL 重复（M-M6）、错误分类/冷却链可测性（见 §4 后端池覆盖条目）相互关联，建议在 service.ts 拆分（M-H2）时一并完成纯函数抽取。

### 3.3 Low

#### M-L1. selectPoolMember 9 个位置参数，调用点易错位
- Severity: low
- 位置：`apps/web/src/features/image-backend-pool/service.ts:1174-1184`（定义）、`1607-1621`（调用）
- WHY/修复：9 个位置参数后 8 个可选且类型相近（多个 string/boolean/Set），易错位且 TS 难捕获。改单一 SelectPoolMemberOptions 对象入参，调用点对象字面量。可与 backend-scheduler.ts 抽取一并完成。
- 复核结论：维持 low（坏味道非正确性缺陷，唯一调用点当前正确）。

#### M-L2. getGroupBackendType / normalizeGroupBackendType 归一化逻辑在 service.ts 与 nested-groups.ts 重复实现
- Severity: low
- 位置：`apps/web/src/features/image-backend-pool/service.ts:213-217`
- WHY/修复：service.ts 自实现 normalizeGroupBackendType/getGroupBackendType/normalizeGroupChildGroupIds，而 nested-groups.ts 已有 ImageBackendGroupBackendType 类型与 normalizeChildGroupIds 处理同一概念。枚举/归一化规则变化时两边可能不同步致校验层与运行层判定分歧。收敛到 packages/shared/image-backend/ 单一来源，service.ts import 复用。
- 复核结论：维持 low。注意 service.ts 的 normalizeGroupChildGroupIds 不过滤 "default"（过滤 default 的是 normalizeAccountGroupIds），勿混淆。

#### M-L3. applyBillingMultiplier 在 generation-settlement.ts 与 operations.ts 各有一份语义相近但实现不同的副本
- Severity: low
- 位置：`packages/shared/src/generation-settlement.ts:43-48`; `apps/web/src/features/image-generation/operations.ts:180-183`
- WHY/修复：settlement.ts 用 Math.round（四舍五入），operations.ts 用 roundUpCreditAmount（向上取整），同名异义。抽唯一 applyBillingMultiplier（统一取整方向，建议向上取整）+ 合并 readNumber/readRecord/isRecord 解析工具到 shared。
- 复核结论：维持 low。运行时结算不经 settlement.ts 的该函数（走 getFailedGenerationTargetCredits 读已 roundUp 值），分歧仅在缺 moderationOnlyCredits 的兼容 fallback 才产生 ≤0.01 偏差，非系统性资金偏差。

#### M-L4. 注册奖励发放逻辑在 core.ts 与 actions.ts 重复实现，易出现口径分叉
- Severity: low
- 位置：`packages/shared/src/credits/actions.ts:96-141`（grantRegistrationBonus）; `core.ts:248-288`（ensureRegistrationBonus）
- WHY/修复：两入口各实现同一业务（查 registration_bonus → 不存在则 grantCredits，相同 sourceRef/字段）。已漂移：core 写 metadata.grantedAt，actions 没写；过期天数取数路径不同。让 grantRegistrationBonus 委托 ensureRegistrationBonus 删重复块。
- 复核结论：维持 low。修正：actions 在 expiryDays=0 返回 null 永不过期分支运行时不可达（getRuntimeSettingNumber positive 强制 >0），且两入口已存在时都调 ensureRegistrationBonusExpiry 自愈兜底，无幂等失效/资金风险，残留仅手工同步 + grantedAt 元数据分叉。

#### M-L5. resolution.ts 计费魔数（1.27/10/0.05/0.002/0.003）散落且与定价语义耦合，缺注释来源
- Severity: low
- 位置：`apps/web/src/features/image-generation/resolution.ts:15-20, 124-128, 143-149`
- WHY/修复：1024 基价 1.27、4K 基价 10、参考积分单价 0.05 CNY、文本/图像审核 0.002/0.003 CNY 以无来源魔数硬编码，cny/REFERENCE_CREDIT_PRICE_CNY 换算在 3 文件重复内联。为每个计费常量补 WHY 注释，封装 cnyToCredits 命名函数。
- 复核结论：降 medium→low。纯文档/可维护性，无行为错误；base 值实为可运行时覆盖的系统设置（硬编码仅默认回退），插值/封顶语义在 definitions.ts:1188-1201 已中文文档化，端点/插值已有 resolution.test.ts 覆盖。真正缺的是 resolution.ts 内常量零 WHY 注释 + CNY 换算重复。

#### M-L6. getCreditsBalance 每次读余额都触发全表/全用户过期扫描，读路径承担写副作用
- Severity: low
- 位置：`packages/shared/src/credits/core.ts:232-235, 846-941`
- WHY/修复：getCreditsBalance 与 consumeCredits 入口先 await processExpiredBatches，后者 SELECT 所有过期批次后对每批次开独立事务（N+1）。读余额是高频 UI 调用，积压大量过期批次时退化为 N 个串行事务放大尾延迟；违反查询/命令分离。提供 {settle?:boolean} 默认只读依赖 cron 回收；或过期判定下推 SQL；processExpiredBatches 改批量单事务。
- 复核结论：维持 low（有界尾延迟 + 设计异味，无正确性 Bug，每批次事务原子且 GREATEST 防负）。注意 admin-users.ts:803/889、external-api/handlers/credits.ts:21 等只读路径同样触发。

#### M-L7. consumeCredits FIFO 扣减循环在并发丢失更新时无最大迭代上限，缺防御性保护
- Severity: low
- 位置：`packages/shared/src/credits/core.ts:547-606, 596-598`
- WHY/修复：FIFO 循环每轮重 SELECT 下一批次并条件 UPDATE...RETURNING，updatedBatch 为空时 continue 重进循环。当前靠谓词对齐 + 每轮重算保证单调进展，但无最大迭代/进度断言兜底，未来改隔离级别/SKIP LOCKED 可能无界自旋。加最大迭代守卫或 remainingToConsume 严格下降断言，超限抛错记录；注释写明终止性依赖。
- 复核结论：维持 low（防御性观察，当前由三重兜底保证终止性与正确性）。修正：终止性依赖谓词对齐 + 每轮重算，非"行锁阻塞"。

#### M-L8. getUserRoleById 在读路径内隐式写库（角色自提升副作用），命名误导且位于高频热路径
- Severity: medium → 复核降为 medium（本条 lens=maintainability，归 §3.2 列举不便，登记 low 区上端）
- 位置：`packages/shared/src/auth/role-server.ts:7-27`
- WHY/修复：getUserRoleById 暗示纯读，实际在 role==='admin' 且 email==LOCAL_SUPER_ADMIN_EMAIL 时执行 `db.update(user).set({role:'super_admin'})`。该函数被多处调用覆盖每个 protectedAction/adminAction/superAdminAction 及多数 dashboard 页面渲染。读路径藏写：命名误导、只读副本上会失败、自提升规则埋没难审计。把自提升移到 bootstrap-super-admin.ts 的 ensureLocalSuperAdmin() 一次性流程，getUserRoleById 保持纯读；若保留惰性提升至少改名（resolveUserRoleWithSelfHeal）并注释。
- 复核结论：维持 medium。修正：自提升仅对硬编码 admin@gpt2image.local（.local TLD 收不到真实邮件、仅 self-use bootstrap 创建且本就 super_admin）生效，非任意提权向量，真实危害是可维护性/可审计性。与 AA-Coverage 的提权分支测试条目同源。

#### M-L9. support/actions/index.ts barrel 仅导出 12 个 admin-users action 中的 5 个，陈旧且无人使用
- Severity: low
- 位置：`packages/shared/src/support/actions/index.ts:4-10`
- WHY/修复：barrel 只 re-export 5 个，admin-users.ts 实际导出 12 个；所有真实消费者直接从 '../actions/admin-users' 导入，barrel 实质无人用且长期不同步。未来按惯例从 barrel 导入新 action 会得"导出不存在"或静默漏掉。补全 barrel 并加注释统一为公开入口，或删 barrel 中 admin-users 部分。
- 复核结论：维持 low（零运行时影响，纯卫生）。修正：导出 12 个非 14；该 barrel 是 package.json exports 声明的公开入口。

#### M-L10. /api/session/current 与 better-auth 会话来源重复且各自维护一套用户字段映射与 no-store 头
- Severity: low
- 位置：`apps/web/src/app/api/session/current/route.ts:63-94, 25-53`
- WHY/修复：路由在 getSession 之上自查一次 user 表并返回 `{...session,user:currentUser}`，复制了用户字段投影（与 layout.tsx 投影、better-auth additionalFields 三处不一致，此处不返回 banned/bannedReason）；clearAuthCookies 硬编码 6 个 cookie 名 + 两前缀，库升级改名即静默失效。抽 toCurrentSessionUser(row) 共享投影（显式纳入 banned）；cookie 名集中到常量或改用 better-auth 登出 API。
- 复核结论：维持 low（latent drift，无现存功能 Bug）。修正：同一硬编码 cookie 名也在 proxy.ts:171-172 重复。

#### M-L11. adminAction/superAdminAction/imageBackendPoolViewerAction 重复"取角色+判定+塞 ctx"三段式，且各自硬抛 string Error
- Severity: low
- 位置：`packages/shared/src/safe-action.ts:129-175`
- WHY/修复：三个角色化 client 同形（getUserRoleById→if !canXxx throw→next ctx），复制 role 解析与上下文扩展；错误为裸 new Error(中文)，handleServerError 无法区分未登录与权限不足（一律变"服务器错误"）。抽 roleGatedAction(guard,ctxPatch) 工厂角色只解析一次；定义 ActionAuthzError 在 handleServerError 透传。
- 复核结论：维持 low（DRY + 次要 UX/可观测，无正确性/安全缺陷）。注意 gpt2image-pro/src/lib/safe-action.ts 为陈旧死副本勿动。

#### M-L12. getUserRoleById 自提升 super_admin 与可改任意邮箱的超管操作叠加成隐性后门（security 视角，同 M-L8）
- Severity: low
- 位置：`packages/shared/src/auth/role-server.ts:14-26`
- 复核结论：维持 low。前置条件是攻击者已是 super_admin（改邮箱/设 admin 均 superAdminAction 门控），不构成纵向越权；真实危害仅审计规避/权限洗白。修复同 M-L8。

#### M-L13. getUserPlan 中未知 priceId 用 console.warn 而非 Pino，违反统一日志约定
- Severity: low
- 位置：`packages/shared/src/subscription/services/user-plan.ts:108-110`
- WHY/修复：未知 priceId 用 console.warn 降级 free，违反 Pino 约定（无结构化字段/无法 redact/采样）。改 `logger.warn({userId,priceId},'Unknown subscription priceId; defaulting to free')`，考虑触发监控（付费用户被降级属业务异常）。
- 复核结论：维持 low。第二份相同副本在 src/features/subscription/services/user-plan.ts:112-115 应一并改。

#### M-L14. plan-badge.tsx 自定义 PlanType 联合类型，与 SubscriptionPlan 重复且会静默漂移
- Severity: low
- 位置：`packages/shared/src/subscription/components/plan-badge.tsx:24`
- WHY/修复：组件自声明 PlanType 联合与 SubscriptionPlan 完全重复并据此构建 planConfig 穷举映射；新增套餐时 PlanType 不自动报错对齐，caller 用 `as PlanType` 强转使 TS 不拒绝新值，planConfig[plan] 取 undefined 致运行时崩溃。删本地 PlanType 直接 import SubscriptionPlan，planConfig 声明为 Record<SubscriptionPlan,...>。
- 复核结论：维持 low。真实 drift 已在 src/features/.../plan-badge.tsx 副本（缺 enterprise）出现，证明机制 live。

#### M-L15. 存储读取路由把所有错误吞成统一 404，掩盖真实故障
- Severity: low
- 位置：`apps/web/src/app/api/storage/[bucket]/[...key]/route.ts:48-66`
- WHY/修复：GET 用单一 try/catch 把 getStorageProvider/getObject 全部异常返回 404，S3 宕机/凭证错/配置缺失/流中断全表现为 404 且 catch 无日志。违反"不吞异常 + 记 Pino"约束。区分错误类型：不存在/键非法 404，其余记 logger.error 返 502/500。
- 复核结论：维持 low（只读路径，无数据/安全/计费影响，但违反硬约束且误导排查）。

#### M-L16. 路径穿越校验在路由与 local provider 间重复且口径不一致，且仅 local 后端生效
- Severity: low
- 位置：`apps/web/src/app/api/storage/[bucket]/[...key]/route.ts:36-43`
- WHY/修复：路由查 `includes('..')||startsWith('/')||includes('\\')`，local safePath 查 `includes('..')` + path.resolve+startsWith 兜底，规则不齐；safePath 只在 local 调用，S3 后端时路由字符串黑名单成唯一防线。抽单一 normalizeAndValidateKey(key) 放 storage 包，路由与所有 provider 共用作为唯一入口校验；注释说明 S3 Key 同样需校验。
- 复核结论：维持 low。存在 src/features/storage 陈旧并行副本放大重复。

#### M-L17. 进程内 inFlightFulfillments / responses 续承 Map 多实例问题（见 M-M19/M-M20，复核已降 low）

#### M-L18. mixWebFirst/RunImageGenerationInput 联合分支重复声明 ~10 个相同字段
- Severity: low
- 位置：`apps/web/src/features/image-generation/operations.ts:75-112`
- WHY/修复：RunImageGenerationInput 的 generate/edit/chat 三分支逐字重复 userId/generationId/apiKeyId/relayOnly/backendRequestKind/preferredBackendMemberId/mixWebFirst/forceWebBackend/requiresResponsesBackend；新增公共字段须改三处。提取 RunImageGenerationCommon 公共类型用交叉类型组合。
- 复核结论：维持 low（纯类型重复，strict 下漏字段会 typecheck 报错被 CI 拦截）。

#### M-L19. streaming.ts cancel() 后 start 的 finally 仍调用 emit/done/close，依赖 closed 标志的隐式协作易回归
- Severity: low
- 位置：`apps/web/src/features/image-generation/streaming.ts:127-165`
- WHY/修复：cancel() 仅设 closed=true 清 keepAlive 不通知 start 停止；run 返回后 finally 仍 emit done 并在 !closed 时 close。关闭正确性完全依赖单个 closed 布尔在 write/emit/finally/cancel 四处隐式协作，无注释。在 closed 声明与 cancel 处加注释说明共享关闭不变量；给 2048 抗缓冲魔法数加注释；try/catch 包裹 close() 兜底。
- 复核结论：维持 low（当前由 closed 双守卫正确兜底，预防性硬化）。修正：cancel() 已有注释、keepAliveMs/flushPadding 已具名，cancel-during-run 测试已存在仅缺断言。

#### M-L20. operations.ts 内联实现 PNG/JPEG/WebP 二进制尺寸解析（~95 行位运算），职责混入业务管线
- Severity: low（medium→low）
- 位置：`apps/web/src/features/image-generation/operations.ts:418-513`
- WHY/修复：getPngDimensions/getJpegDimensions/getWebpDimensions/getImageDimensionsFromBuffer/readUInt24LE 约 95 行手写字节偏移/位掩码与魔法数，混在业务文件难导航难单测。迁移到独立纯模块（image-dimensions.ts 或并入 output-format.ts），补针对性单测（含损坏/截断 buffer 返回 null）；output-format.ts 重复的格式签名检测可顺带去重。
- 复核结论：降 low（纯代码组织，逻辑正确有长度/签名校验返 null，无运行时风险）。

#### M-L21. showThinkingControls = true 为恒真常量，却作为条件门控 8 处分支，属误导性死分支
- Severity: low
- 位置：`apps/web/src/features/image-generation/components/create-page-client.tsx:1793`（定义）；使用 3491、5151、6066、6238、6806、7743 等
- WHY/修复：恒真 flag 让阅读者误以为存在隐藏分支，需逐处确认其实永远成立。若确实始终展示则删常量及 8 处条件包裹；若本意随 backend 能力开关则赋真实条件并注释。
- 复核结论：维持 low（纯可读性，所有分支正常工作）。

#### M-L22. create-runtime-store 用模块级单例 fallbackStore 与扁平字符串 key，存在跨实例状态泄漏与 key 冲突潜在风险
- Severity: low（info 上端）
- 位置：`apps/web/src/features/image-generation/create-runtime-store.tsx:22-25, 63-112`
- WHY/修复：Provider 缺失时回退模块级单例 fallbackStore（会话内常驻永不清理），以扁平 string key 索引 Map<string,unknown> 并 `as T` 断言。漏挂 Provider 时多组件无声共享同名 key 状态串台；裸字符串无命名空间易撞键；as T 让类型系统失察。给 key 加命名空间前缀/Symbol；Provider 缺失时开发态 throw 而非静默回退；如需跨导航持久化在文件级注释写明生命周期。
- 复核结论：维持 low（偏 info）。修正：~39 个 distinct key 非 74，当前零冲突；唯一使用者 create-page-client 单页渲染，layout 必提供 Provider，fallback 分支永不执行，属未来误用提醒。

#### M-L23. async 任务结果落地用 'error' in payload 判定成功/失败，与 toOpenAIImagesResponse 返回结构强耦合
- Severity: low
- 位置：`apps/web/src/features/external-api/handlers/image-generations.ts:339-347` 与 `image-edits.ts:856-864`；配合 async-image-tasks.ts:166-180
- WHY/修复：异步路径把 toOpenAIImagesResponse 返回对象塞进 completeAsyncImageTask 并以 `"error" in resultPayload` 判成败——未写进类型系统的隐式契约，重命名 error 字段会静默破坏判定。让 toOpenAIImagesResponse 返回判别联合 {ok:true}|{ok:false,error}，或导出 isErrorPayload(x) 类型守卫单点复用。
- 复核结论：维持 low（latent，无运行时缺陷）。注意私有 isErrorPayload 已在 images.ts:684 存在但未导出非类型守卫，提升为导出守卫可去重 4 处。

#### M-L24. url 模式下 base64 退化为 data: URI 时 MIME 硬编码 image/png，与实际 output_format 不符
- Severity: low
- 位置：`apps/web/src/features/external-api/handlers/images.ts:176`；同硬编码于 image-generations.ts:96、image-edits.ts:476
- WHY/修复：responseFormat='url' 但上游只返回 base64（纯中转）时退化为 `data:image/png;base64,...` 写死 png，若请求 webp/jpeg 则 MIME 与字节不符，严格解码器渲染失败。统一退化构造到单 helper 并按 detectImageOutputFormatFromBuffer 嗅探字节选 MIME（output 类型无 outputFormat 字段，须嗅探或 thread 请求 output_format）。
- 复核结论：维持 low（仅 relayOnly + 上游仅 base64 + 非 png 格式时触发，浏览器/SDK 多嗅探字节容忍）。

#### M-L25. 每个 cron 路由错误处理不一致：仅 credits/expire 有 try/catch 结构化 500（同 §4 cron 覆盖 + M-M27）
- Severity: low
- 位置：`apps/web/src/app/api/jobs/credits/expire/route.ts:65-78`（对比 sub2api/sync:36、web-accounts/refresh:32、images/expire-pending:43）
- WHY/修复：4 个同构端点对 job 失败给出两种 HTTP 响应契约（结构化 500 vs 框架裸 500），调用方无法统一判断。在抽取的 withCronAuth 包装里统一兜底 catch 使 4 端点响应一致，删 credits/expire 特例 try/catch。
- 复核结论：维持 low（未吞异常、均返 500、内部端点，仅契约一致性 + 认知负担）。

#### M-L26. cron 路由使用 console.warn/console.error 而非 Pino logger
- Severity: low
- 位置：`apps/web/src/app/api/jobs/credits/expire/route.ts:35, 68`（另见 images/expire-pending/route.ts:13）
- WHY/修复：console.* 绕过统一日志管道（无 redact/结构化/采样/外部 sink），关键鉴权与失败事件成孤儿。改 @repo/shared/logger 的 logWarn/logError；lint 禁 app/api 下 console。
- 复核结论：维持 low（无功能缺陷，日志一致性/可观测卫生）。legacy src/ 副本同样模式应一并改。

#### M-L27. credits/expire 路由顶部文档块引用 Vercel Cron + vercel.json，与实际 Docker/Nginx 部署不符
- Severity: low
- 位置：`apps/web/src/app/api/jobs/credits/expire/route.ts:9-25`
- WHY/修复：注释教人配 Vercel Cron / vercel.json，但部署为 Docker Compose + Nginx，且生产实际用内置定时调度器（INTERNAL_JOB_SCHEDULER_ENABLED + PG advisory lock）。改注释为真实触发方式（内置调度器为主，外部 cron 以 Bearer CRON_SECRET 调用 POST 为回退），删 Vercel 段落；legacy src/ 副本一并清理。
- 复核结论：维持 low（陈旧/误导注释，CLAUDE.md 视过期注释为 Bug，不影响运行时）。

#### M-L28. images/expire-pending 健康检查文案硬编码 '20 minutes' / '500'，与真实常量解耦存在漂移风险
- Severity: low
- 位置：`apps/web/src/app/api/jobs/images/expire-pending/route.ts:51-52`
- WHY/修复：GET 健康检查 description 写死 '20 minutes'，真实阈值由 IMAGE_GENERATION_PENDING_TIMEOUT_MS 决定；scheduled-jobs.ts:15-16 的 `limit:500` 也是裸魔法数。文案从共享常量推导或去掉具体数字；500 抽具名常量（或运行时设置）。
- 复核结论：维持 low（偏 info，文案无功能消费，magic number 耦合）。

#### M-L29. multipart 解析/SSRF 副本/payload 构造器重复（见 M-M12/M-M13/M-M14，部分复核已降 medium）

#### M-L30. 内联 copy(en, zh) 临时双语方案在各组件重复定义，绕过 next-intl 消息目录
- Severity: medium → 复核维持 medium（本报告归 medium 区，登记于此索引）
- 位置：`apps/web/src/features/image-generation/components/create-page-client.tsx:1766-1769`；另见 image-lightbox.tsx、history-client.tsx、gallery-client.tsx（全仓 14 文件）
- WHY/修复：多组件各自定义 `copy=(en,zh)=>(isZh?zh:en)` 并硬编码中英文案，validationMessage 用 startsWith 匹配英文错误前缀再翻译。与 next-intl 并行两套 i18n，新增语言无法覆盖内联文案；上游改英文文本翻译即静默失效。迁入 next-intl messages 用 useTranslations；validationMessage 改为校验层返回稳定 message key + 参数前端格式化。
- 复核结论：维持 medium（重复 + 潜在静默失效，但两 locale 当前正确渲染）。

> 说明：本节 Low 区以 M-L 编号；部分原属 medium 但复核降级的可维护性条目（M-M19/M-M20/M-M21/M-M24/M-M28/M-M30/M-L30）已在 §3.2/§3.3 据复核结论标注最终 severity。

---

## 4. 测试覆盖率缺口（Coverage）

按 severity 从高到低。每条附"建议测试"。

### 4.1 High

#### C-H1. runImageGenerationForUser 的整条扣费/结算/退款编排零直接测试
- Severity: high
- 位置：`apps/web/src/features/image-generation/operations.ts:839-2280`（核心金融编排，尤其 1439-1472 初始扣费、1407-1437 settleChargedCredits、1547-1605 审核结算、1695-1772 失败结算、2105-2181 成功结算、1476-1545 超时退款）
- WHY：全部 5 个 v1 handler 的唯一汇入点，承载平台全部扣费真相（chargeAdditionalCredits/settleChargedCredits/refundChargedCredits 三闭包驱动 consumeCredits 与 refund）。唯一 import 它的 chat-completions.test.ts 将其整体 vi.mock（24-25 行）从未真正执行，高价值分支全部零覆盖：初始扣费 catch→failed+Insufficient；settle delta>0 用 `:charge` 后缀补扣 / delta<0 退款 / delta=0 不动（防双扣关键）；审核 block/error 结算到目标额；生成异常/result.error/缺图失败路径结算+落库；成功路径按 billableOutputs 重结算。函数与 @repo/database 紧耦合无法 DB-free 驱动。
- 修复建议：将三结算闭包及依赖抽到接受注入接口的纯编排层 createGenerationSettlement(deps)，db 收敛为可 mock 端口；或在 operations.test.ts vi.mock @repo/database、@repo/shared/credits/core、./service，断言 consumeCredits/refund 的调用次数/金额/sourceRef 后缀。优先覆盖 delta>0/<0/=0 三态与初始扣费失败两路。
- 建议测试：`'settleChargedCredits charges delta with :charge sourceRef when target exceeds charged'` 断言 consumeCredits 以 sourceRef=`${gen}:moderation:charge`、amount=delta 调用一次；`'settleChargedCredits refunds when target below charged'` 断言 refundGenerationCredits 以 abs(delta) 调用；`'initial charge failure marks generation failed and returns Insufficient credits'`。
- 复核结论：维持 high。修正：失败结算的目标额政策 getFailedGenerationTargetCredits 已抽到 @repo/shared/generation-settlement 且良好测试（7 用例），但编排（delta 计算、:charge 后缀、consume/refund 接线、初始扣费失败、落库/返回形）完全未测。consumeCredits(sourceRef) 的 DB 偏唯一索引幂等提供防双扣纵深。

#### C-H2. 套餐能力/数量/上下文长度等鉴权门闩全部无测试
- Severity: high
- 位置：`apps/web/src/features/image-generation/operations.ts:875-990`（promptOptimization 门 875-880、能力门 889-942、batch 门 947-955、count 上限门 956-961、maxChatContextChars 门 966-980、responses 输入门 981-990）
- WHY：请求进入扣费前的全部授权与配额校验：未开通能力即返错、requestedCount 超 imageGenerationConcurrency 即拒、聊天上下文超 maxChatContextChars 即拒。TODO.md #16 记录 count 校验刚从 maxBatchCount 改挂 imageGenerationConcurrency（语义变更风险点）却无单测。门闩被改坏（> 写成 >=、能力键拼错、count 回挂错字段）会让低套餐用户越权批量生图或注入超长上下文放大上游成本。chat-completions.test.ts 把 runImageGenerationForUser 整体 stub，这些门从不运行。
- 修复建议：抽 validateGenerationRequest(input, planCapabilities):{error?} 纯函数（不 import db），写参数化单测覆盖每个能力位关闭、count=limit/limit+1 边界、上下文 len=max/max+1 边界、responses 模式要求。
- 建议测试：`'rejects batch when imageGeneration.batch disabled'`、`'rejects count exceeding imageGenerationConcurrency'`（count=limit 通过、limit+1 返回含 limit 的错误）、`'rejects chat context over maxChatContextChars'`、`'rejects promptOptimization control without Pro'`、`'rejects edit when imageGeneration.edit disabled'`。
- 复核结论：维持 high（门闩当前正确，但 economic-loss 路径的未检测回归面 + CLAUDE.md MUST + #16 语义变更）。

#### C-H3. external-api/quota 的每-key 配额预留与退款（含条件 UPDATE 幂等）零测试
- Severity: high
- 位置：`apps/web/src/features/external-api/quota.ts:98-145`（reserve 条件 UPDATE）、`147-168`（refund GREATEST）、`15-24`（normalizeExternalApiKeyCreditLimit）、`48-54`（getExternalApiKeyQuotaRemaining）
- WHY：operations.ts 扣用户积分前后 reserve/refund 外部 key 配额，形成双账本。reserveExternalApiKeyCredits 用单条带 WHERE 的原子 UPDATE 实现"额度足够才扣"，0 行命中即抛 ExternalApiKeyQuotaExceededError——防超额的唯一闸门却零测试。纯函数 getExternalApiKeyQuotaRemaining / normalizeExternalApiKeyCreditLimit 同样无测试。
- 修复建议：纯函数直测；reserve/refund 用 vi.mock('@repo/database') 注入返回空数组的 update 链断言 0 行命中抛错且 required/remaining 正确，refund GREATEST 不扣成负，apiKeyId 缺省时 early return 不调 db.update。
- 建议测试：`'normalizeExternalApiKeyCreditLimit rejects negative and rounds'`（-1 抛错、''/null→null、1.005→1.01）；`'getExternalApiKeyQuotaRemaining returns null for unlimited and floors at 0'`；`'reserveExternalApiKeyCredits throws QuotaExceeded when update affects 0 rows'`；`'reserve/refund no-op when apiKeyId undefined'`。
- 复核结论：维持 high（relay-only 阻止单 key 超额的唯一闸门，金融敏感双账本，零回归网）。

#### C-H4. SSRF 防护 safe-image-fetch.ts（审计修复 A6/A7）零测试
- Severity: high
- 位置：`apps/web/src/features/external-api/safe-image-fetch.ts:27-142`
- WHY：assertPublicImageUrl/fetchPublicImage/isPrivateIpAddress 无单测。被 responses.ts:464、chat-completions.ts、agent-images.ts 共用拦截内网/云元数据。isPrivateIpAddress 分支极多（10/127/0、100.64-127 CGNAT 含阿里云元数据、169.254、172.16-31、192.168、198.18/19、>=224、::1/fe80/fc/fd、::ffff: 映射），任一退化即重开 SSRF。fetchPublicImage 逐跳重定向复检（manual + 每跳 assertPublicImageUrl + MAX_REDIRECTS=3）防"公网 302 跳内网"绕过，同样无测试。
- 修复建议：新建 safe-image-fetch.test.ts。isPrivateIpAddress 表驱动；fetchPublicImage 用 vi.stubGlobal('fetch') 返回 302+Location 到内网断言抛 SafeImageFetchError，超 MAX_REDIRECTS 抛 'Too many redirects'。
- 建议测试：`describe('assertPublicImageUrl')` it.each 覆盖 169.254.169.254/100.100.1.1/10.x/127.0.0.1/192.168.x/172.16.x/[::1]/fd00::1 均 reject；`describe('fetchPublicImage')` `'rejects redirect to private IP'`、`'throws after exceeding MAX_REDIRECTS'`。
- 复核结论：维持 high。修正：仓库存在至少三份 isPrivateIpAddress 副本（safe-image-fetch canonical、async-image-tasks.ts:L40-63、agent-images.ts:L444+），async-image-tasks.test.ts 的唯一测试不覆盖共享模块；副本分歧风险强化本发现。

#### C-H5. 鉴权入口 authenticateExternalApiRequest 零测试（banned 拦截 / relay 降级复核 / 定时安全比较）
- Severity: high
- 位置：`apps/web/src/features/external-api/auth.ts:35-91`
- WHY：v1 全部 5 个 handler 的唯一鉴权入口无单测。关键分支无覆盖：缺失/格式错 Bearer 返 null（getBearerToken 25-33）；命中但 user.banned=true 时拒绝（61）；relayOnly 请求期复核（套餐降级后即使 DB relayOnly 仍 true 也须经 canUsePlanCapability(plan,'externalApi.relay') 复核，67-71）；safeEqual 定时安全比较等长/不等长分支（16-23）。
- 修复建议：getBearerToken、safeEqual 抽到无 DB 模块单测；主体用 vi.mock 模拟 db 查询/getUserPlan/canUsePlanCapability 验证 banned/relay 降级/未命中三返回路径。
- 建议测试：`'returns null for missing or non-Bearer authorization'`；`'returns null when matched user is banned'`；`'downgrades relayOnly to false when plan lost externalApi.relay capability'`；`'keeps relayOnly true when capability present'`；`'safeEqual returns false for different-length inputs without throwing'`。
- 复核结论：维持 high（安全关键唯一闸门零覆盖，符合 CLAUDE.md 硬约束；属缺测试非活跃漏洞）。

#### C-H6. 角色/权限矩阵 roles.ts 纯函数零单测，observer_admin 越权边界无任何断言守护
- Severity: high
- 位置：`packages/shared/src/auth/roles.ts:17-48`
- WHY：roles.ts 是授权体系判定核心（adminAction/superAdminAction/imageBackendPoolViewerAction/checkAdmin 全依赖），DB-free 但零测试。关键边界：observer_admin 必须能看后端池但绝不能进后台/管权限；admin 不能管权限（仅 super_admin）。误把 observer_admin 加进 ADMIN_MANAGEMENT_ROLES 或改 isAdminRole 分支无测试会失败，直接越权。normalizeUserRole 对未知/null 回退 'user' 的兜底也无断言。
- 修复建议：新增 roles.test.ts（DB-free 无需 mock），表驱动遍历 4 角色逐一断言三能力门。
- 建议测试：`'observer_admin can view backend pool but cannot access admin area or manage permissions'`；`'admin can access admin area but only super_admin can manage permissions'`；`'user has no privileged capability'`；`'normalizeUserRole falls back to user for unknown/null/undefined/empty'`。
- 复核结论：维持 high（observer_admin 整个执行边界是两个无守护常量数组，一行变更即静默提权无测试失败）。

#### C-H7. getUserPlan 订阅状态机除 active 外的所有分支零覆盖（lifetime/canceled/过期/未知 priceId）
- Severity: high
- 位置：`packages/shared/src/subscription/services/user-plan.ts:85-133, 160-188`
- WHY：getUserPlan 是判定付费特权的财务闸门，核心是 isSubscriptionCurrentlyActive 状态机。user-plan.test.ts 仅 3 个测试，唯一真实订阅用例只覆盖 status='active' 且未来到期。零覆盖分支：lifetime 永久有效；canceled 且周期内应保留付费；active 但已过期必须降级 free（关键收入分支）；priceId 无法映射返回 hasActiveSubscription:true 但 plan='free'；currentPeriodEnd 为 null 视为永久有效的边界。
- 修复建议：复用现有 dbMock 注入不同 status/currentPeriodEnd 组合断言 plan/hasActiveSubscription/subscriptionStatus/cancelAtPeriodEnd；考虑导出 isSubscriptionCurrentlyActive 直接测真值表。
- 建议测试：`'keeps lifetime active regardless of currentPeriodEnd'`；`'downgrades active subscription whose period has expired to free'`；`'keeps canceled subscription within period as paid and sets cancelAtPeriodEnd'`；`'downgrades canceled past period to free'`；`'returns free plan but hasActiveSubscription true for unknown priceId'`；`'treats null currentPeriodEnd as never-expiring'`。
- 复核结论：维持 high（财务闸门多高风险纯逻辑分支未覆盖，coverage lens 上限）。当前实现正确，是回归风险非现存缺陷。

#### C-H8. 异步任务 callback_url SSRF（已在 §2 S-H3 登记，security 视角）

#### C-H9. Epay 防篡改金额校验 isExpectedEpayAmount 零覆盖且未导出（不可单测）
- Severity: high
- 位置：`apps/web/src/features/payment/epay-fulfillment.ts:62-73, 185, 262`
- WHY：isExpectedEpayAmount 把订单期望金额与网关回传 verifyInfo.money 都转分，要求 paidCents>=expectedCents 且 <=expectedCents+10（容忍 10 分）。这是阻止低价/篡改金额套取高价套餐的反欺诈门闩，但完全无测试且为非导出局部函数无法被 vitest import。容忍区间被误改（+10 误为 +1000、>= 误为 ==）会静默通过。整条履约链 fulfillSuccessfulEpayPaymentInner/handleCreditPurchase/handleSubscription 同样零覆盖。
- 修复建议：把 isExpectedEpayAmount 及金额纯逻辑提取到不 import @repo/database 的模块并导出补 amount 单测；DB 分支用 vi.mock('@repo/database') 覆盖。
- 建议测试：`'accepts paid==expected'`；`'accepts paid within +10 cents tolerance'`（9.90/10.00）；`'rejects underpayment'`（10.00/9.99）；`'rejects overpayment beyond tolerance'`（10.00/10.11）；`'rejects NaN'`；集成 `'throws amount-mismatch and resets order to pending'`。
- 复核结论：维持 high。修正定性：verifyInfo.money 受商户 key 签名保护（webhook 已验签），外部攻击者不能任意伪造低值，故 isExpectedEpayAmount 是防价格/配置漂移与自发结账操纵的纵深防御而非唯一防线；但带魔数 10 分窗口的未测金额比较仍是 coverage high。

#### C-H10. Epay 签名验证 verifyEpayParams/signEpayParams 零覆盖（支付鉴权门闩）
- Severity: high
- 位置：`packages/shared/src/payment/epay.ts:178-221, 383-409`
- WHY：verifyEpayParams 是 /api/webhooks/epay 与 /api/payments/epay/return 的鉴权入口（buildSignPayload 过滤空值/排除 sign + 键排序 + 追加商户 key MD5，timingSafeEqualString 常量时间比对）。签名通过决定是否履约发放积分，防伪造回调白嫖的根本防线，却零测试。关键未验证：filterParams 剔除空值与 sign；键排序稳定；timingSafeEqualString 对不等长返 false（length 校验在前）；hex 大小写不敏感。
- 修复建议：新增 epay 测试覆盖 signEpayParams/verifyEpayParams/buildSignPayload，用固定商户 key 构造已知签名向量做回归锚点（epay.ts 顶部 import @repo/database，按本包惯例 vi.mock）。
- 建议测试：`'accepts valid signature'`；`'rejects tampered money'`；`'rejects wrong-length signature'`（不抛）；`'is case-insensitive on hex sign'`；`'excludes empty/sign/sign_type'`；`'sorts keys lexicographically'`。
- 复核结论：维持 high（异步通知发放积分的唯一签名鉴权门，零回归锚点）。当前实现正确，属缺回归保护非现存漏洞。

#### C-H11. 升级补差比例计算 createSubscriptionCheckoutQuote 零覆盖（金额计算）
- Severity: high
- 位置：`apps/web/src/features/payment/subscription-upgrade.ts:124-212`
- WHY：createSubscriptionCheckoutQuote 计算订阅升级应补金额（按剩余天数比例与剩余积分比例取较小值抵扣，amountDue=max(MIN_UPGRADE_PAYMENT_CENTS, target-proration)）。以分为单位的 toCents/fromCents/Math.floor/Math.min 直接决定用户实付，错算即多收/少收。含多处前置守卫（目标必须更高 PLAN_RANK、计费周期须一致、须有当前套餐）。核心比例算法纯数学、注入 now 可确定性测，却零覆盖。
- 修复建议：vi.mock('@repo/database') + mock findRuntimePlanByPriceId/getSubscriptionMonthlyCredits/getRemainingSubscriptionCredits 传固定 now；或将纯比例计算抽 DB-free 纯函数单独测。
- 建议测试：`'prorates by remaining days for mid-cycle upgrade'`；`'caps proration by unused subscription credits'`；`'enforces MIN_UPGRADE_PAYMENT_CENTS floor'`；`'throws on same-or-lower target'`/`'interval mismatch'`/`'current priceId null'`。
- 复核结论：维持 high（直接决定实付金额，CLAUDE.md MUST，零覆盖）。是缺口非已证实算错。

#### C-H12. Creem webhook 订阅积分发放与年付判定 grantSubscriptionCredits 零覆盖
- Severity: high
- 位置：`apps/web/src/app/api/webhooks/creem/route.ts:506-611`
- WHY：grantSubscriptionCredits 是订阅积分发放财务核心（幂等键 periodKey=sub.id+current_period_start_date 去重、periodDays>60 判年付发 monthlyCredits*12 vs monthlyCredits、periodEnd 作过期时间 NaN 回退 getCreditPackExpiresAt）。isYearly 的 60 天阈值是易错魔法边界（60/61 天差 11 倍）。handleCreditPurchase 的 sourceRef 幂等、handleSubscriptionCanceled 的二分逻辑同样零覆盖，整个 Creem webhook 路由无测试。
- 修复建议：isYearly 判定/creditsToGrant 计算/periodKey 生成抽 DB-free helper 测；webhook handler 用 vi.mock('@repo/database') 覆盖幂等跳过与各事件分支。
- 建议测试：`'grants monthly for ~30-day period'`/`'grants 12x for yearly >60-day period'`/`'boundary: 60-day monthly, 61-day yearly'`；`'skips grant when batch for periodKey exists'`；`'keeps active+cancelAtPeriodEnd in period'`/`'marks canceled after period end'`。
- 复核结论：维持 high。是缺测非已证实误发——正常月度(~30d)/年度(~365d)分类正确，边界 bug 潜伏；periodKey + credits_batch (source_type, source_ref) 提供幂等兜底。

#### C-H13. setSystemSettings（系统设置写入主入口）零单测
- Severity: high
- 位置：`packages/shared/src/system-settings/index.ts:532-601`
- WHY：setSystemSettings 是所有管理员配置写入唯一入口，覆盖 PLAN_CAPABILITY_MATRIX/CREDIT_PACKAGE_MATRIX/各套餐价格/积分基数及支付认证密钥。事务内多分支：isSettingKey/SETTING_DEFINITION_BY_KEY 双重拒绝未知 key；entry.clear 时 DELETE；secret 传空白时 continue 不清空；coerce 后空串则 DELETE 否则 onConflictDoUpdate 并强制从定义推导 isSecret。任一分支回归导致配置误删/密钥被空串覆盖/财务矩阵写坏。defaults.test.ts 已证可在 mock @repo/database 下测，但当前零测试。
- 修复建议：新增 set-settings.test.ts 复用 defaults.test.ts 的 dbMock 模式覆盖各分支与事务回滚。
- 建议测试：`'rejects unknown setting key throwing 未知配置项'`；`'clear entry deletes stored setting'`；`'skips blank secret to avoid wiping stored secret'`；`'empty coerced string deletes the row'`；`'upsert always stamps isSecret from definition not input'`。
- 复核结论：维持 high（写入财务矩阵与支付/认证密钥，四分支任一回归影响大且资产敏感，CLAUDE.md 硬约束）。

#### C-H14. moderateContent 的 fail-open/fail-closed 编排零覆盖（核心安全决策）
- Severity: high
- 位置：`packages/shared/src/moderation/index.ts:705-791`
- WHY：整个 moderation 模块无测试文件。moderateContent 决定生图请求 allow/block/error(fail-closed)。其失败路径正是 A12/A13 修复逻辑（729-739 把代理异常计入 errors，771-788 按 shouldFailClosed 决定 error 还是 fail-open allow）。一旦回归 fail-open，违规内容放行并照常扣上游成本，无回归测试守护。
- 修复建议：新增 moderation 测试，mock getRuntimeSetting* 与 logger，覆盖 provider block 短路；仅配代理且代理 reject + fail-closed → error（守护 A12）；同上但 fail-closed=false → allow 且 logWarn；所有 provider 抛错且 fail-closed → error；无 provider 无代理 → skipped。
- 建议测试：`'fails closed to error when only proxy is configured and proxy throws'`；`'fails open to allow when fail-closed disabled'`（logWarn 一次）。
- 复核结论：维持 high（守护已被利用过的 fail-open 安全回归 A12，合规 + 经济双风险，无其他回归测试）。

#### C-H15. checkRateLimit 的 fail-open/fail-closed 路由分支未测
- Severity: high
- 位置：`packages/shared/src/rate-limit/index.ts:234-254`
- WHY：checkRateLimit 在未配置 Upstash 时 type==='auth'||'strict' 走内存兜底（fail-closed），其他类型返回 skipped:true（fail-open）。这正是 A9 修复判定点。无测试覆盖此路由——auth 漏出兜底名单或判定写反时默认部署下敏感端点重新 fail-open，CI 不报警。DB-free 仅依赖 process.env。
- 修复建议：删除 UPSTASH_* 环境变量后断言 checkRateLimit(id,'auth')/'strict' 返回 skipped===false（走兜底），checkRateLimit(id,'global')/'ai' 返回 skipped===true、success===true。
- 建议测试：`'falls closed for auth/strict and open for others'`。
- 复核结论：维持 high（活跃安全控制的回归守护缺口，默认无 Upstash 部署即生效）。

#### C-H16. shouldBlockAliyunRisk 风险等级判定（纯函数）零覆盖且因 DB 耦合无法单测
- Severity: high
- 位置：`packages/shared/src/moderation/index.ts:191-203`
- WHY：shouldBlockAliyunRisk 决定阿里云审核结果是否拦截（非 string 返 false；未知 label 按 normalized!=='pass' 拦截即默认拦截未知；已知 label 按 ALIYUN_RISK_ORDER 与套餐 blockRiskLevel 比较）。审核"松紧"真相来源，错判直接漏放违规或误拦合法。本应最易测的纯函数，但未 export 且模块顶层 import '../system-settings'（→ @repo/database）使整模块 import 即触发 DB 连接，无法隔离测——可测试性缺陷。
- 修复建议：抽 shouldBlockAliyunRisk/ALIYUN_RISK_ORDER/getContentChunks 等纯函数到不 import '../system-settings' 的 risk.ts，index.ts re-export 补单测。
- 建议测试：`'blocks unknown non-pass labels and respects plan threshold'`（'high'/'low'→true、'low'/'medium'→false、'pass'/'low'→false、123/'low'→false、'weirdlabel'/'high'→true）。
- 复核结论：维持 high。修正：兄弟测试 plan-capabilities.test.ts 已演示 vi.mock('../system-settings') 可消除 DB import，真正不可测根因是函数未 export 而非 DB 耦合本身；推荐重构（抽 risk.ts re-export）正确。

#### C-H17. checkMemoryRateLimit（A9 fail-closed 兜底）核心限流逻辑零覆盖
- Severity: high → 复核降为 medium
- 位置：`packages/shared/src/rate-limit/index.ts:199-265`
- WHY：index.test.ts 仅断言阈值解析，未测限流决策。checkMemoryRateLimit 是 A9 核心修复（无 Upstash 时对 auth/strict 内存兜底防暴力破解），含易错安全分支：窗口滚动重置、命中上限边界(count<=requests)、remaining 不为负钳制、>10000 桶过期清理。纯内存 DB-free 却无一断言。把 <= 写成 < 会放过一次额外请求。
- 修复建议：用 vi.useFakeTimers，RATE_LIMIT_STRICT_REQUESTS_PER_MINUTE=3 连续 4 次断言前 3 次 success===true、第 4 次 success===false 且 remaining===0，advanceTimersByTime(60000) 后第 5 次放行；在未配置 UPSTASH 环境下经 checkRateLimit(id,'strict') 间接触发，memoryBuckets 模块单例需 vi.resetModules 隔离。
- 复核结论：降 medium（边界逻辑当前正确，覆盖缺口非现存缺陷，但安全敏感 + 硬约束要求边界单测，不降 low）。

> 备注：以下 §4.1 后端池相关原 high 条目经复核多降为 medium，归入 §4.2。auth-authz 的多个 coverage high 经复核降 medium/low，亦在下文据复核结论登记。

### 4.2 Medium

#### C-M1. 队列 per-user 并发与优先级排序无测试，仅覆盖全局并发
- Severity: medium
- 位置：`apps/web/src/features/image-generation/queue.ts:86-110, 69-75, 112-130`
- WHY：queue.test.ts 仅验证全局串行。withImageGenerationQueue 的核心 per-user 并发（scheduleQueue 98 行 runningByUser>=userConcurrency 跳过）与 priority 加权排序（PRIORITY_WEIGHT highest>priority>normal，同优先级按 id FIFO）决定 Ultra 插队/高并发真实行为，全部零覆盖。per-user 计数在 finally 减错会泄漏 slot 永久卡死，或优先级反转饿死低优先级。
- 修复建议：扩充 queue.test.ts 覆盖同 userId 两任务 userConcurrency=1 串行/user-b 并行、不同优先级 highest 先于 normal、任务 resolve 后 runningByUser 清理。
- 建议测试：`'limits per-user concurrency independent of global'`；`'runs higher priority before normal'`；`'frees user slot after completion'`。
- 复核结论：降 high→medium（per-user finally 逻辑读起来正确，无现存 slot-leak/优先级反转，纯覆盖缺口）。

#### C-M2. runBatchImageGeneration 的抛错传播、stopOnError=false 与并发钳制无测试
- Severity: medium
- 位置：`apps/web/src/features/image-generation/batch-runner.ts:43-73, 35-38, 76-78`
- WHY：batch-runner.test.ts 仅覆盖正常路径。未覆盖：run 抛异常（55-59 设 shouldStop 保存首个 thrownError，70-72 rethrow，漏 rethrow 会吞异常）；stopOnError=false 仍跑完全部 count；workerCount 钳制 Math.max(1,Math.min(count,floor(concurrency)))（Infinity/NaN/0/负/超过 count 回退）；firstBatchError 选首个 error。已扣费但无结果且无报错。
- 修复建议：补测 run 第二项 throw 时 runPromise rejects 且抛首个错误后续不 started；stopOnError:false 跑全部；concurrency 传 NaN/Infinity/0 退化为 1、大于 count 不超 count；firstBatchError 返回首个 errored。
- 建议测试：`'rethrows the first thrown error and stops scheduling'`；`'with stopOnError=false runs all items despite an error'`；`'clamps non-finite concurrency to 1'`；`'firstBatchError returns the first errored result'`。
- 复核结论：维持 medium（当前实现正确，财务敏感付费路径回归风险）。

#### C-M3. relayOnly（纯中转）扣费但不落库/不落存储的分叉路径无测试
- Severity: medium
- 位置：`apps/web/src/features/image-generation/operations.ts:1245, 1268-1342, 1509-1538, 1929-1962`
- WHY：relay-only key 是新功能，relayOnly=true 时不写 generation 历史、不上传对象存储，但仍正常扣费/审核/退款，超时退款分支特意处理 UPDATE 无行命中也退款（1510 行 if(updated||relayOnly)）。分叉判断写错可能扣费却不退款（多扣）或落库泄露用户数据（违反零服务器存储隐私边界）。完全在 mock 掉的 operations 之外零测试。
- 修复建议：随 C-H1 可测试化重构一并覆盖：传 relayOnly:true 断言不调 generation insert/storage.putObject；仍调 consumeCredits；超时/失败时 refundChargedCredits 仍被调用；成功透传 imageBase64/imageUrl 且 storageKey 为空串。
- 建议测试：`'relayOnly skips generation insert and object storage but still charges'`；`'relayOnly refunds on timeout even though generation update matches no row'`；`'relayOnly passes through upstream base64 with empty storageKey'`。
- 复核结论：维持 medium（代码读起来行为正确，是未守护回归面，财务双账 + 幂等索引部分兜底）。

#### C-M4. 外部 API Key 配额子系统 quota.ts 零测试（per-key 额度=核心防经济损失控制）
- Severity: medium
- 位置：`apps/web/src/features/external-api/quota.ts:8-168`
- WHY：整个 per-key 信用额度子系统无单测。多个纯函数零覆盖：normalizeExternalApiKeyCreditLimit（负数/NaN 抛错、''/null→null、roundQuotaCredits 两位舍入）；getExternalApiKeyQuotaRemaining（null→null、Math.max(0,...) 下钳）。
- 修复建议：新建 quota.test.ts 仅 import 纯函数（必要时抽到无 DB 文件）覆盖二者全部分支。
- 建议测试：`'normalizeExternalApiKeyCreditLimit returns null for empty/null/undefined'`；`'rounds credit limit to 2 decimals'`；`'throws on negative or non-finite limit'`；`'getExternalApiKeyQuotaRemaining returns null when limit is unlimited'`；`'clamps remaining to zero when used exceeds limit'`。
- 复核结论：降 high→medium。真正防经济损失硬约束在 reserveExternalApiKeyCredits 的 DB UPDATE WHERE（并发安全）与 refund GREATEST，未测纯函数主要影响精度舍入/null=无限/钳零等展示归一语义。与 C-H3 互补（C-H3 强调原子 UPDATE 闸门，本条强调纯函数）。

#### C-M5. per-key 额度原子预留 reserveExternalApiKeyCredits 的并发防双花分支无法被单测（DB 紧耦合）
- Severity: medium
- 位置：`apps/web/src/features/external-api/quota.ts:98-145`
- WHY：reserveExternalApiKeyCredits 用条件 UPDATE（WHERE isActive=true 且 creditLimit IS NULL OR creditLimit-creditsUsed>=amount）作 per-key 原子门闩，0 行返回抛 ExternalApiKeyQuotaExceededError。并发耗尽、=amount 边界、isActive=false 三路径无法验证；refund 的 GREATEST(0,used-amount) 也不可测。
- 修复建议：纯逻辑（roundQuotaCredits/错误构造/amount<=0 短路/apiKeyId 缺失短路）拆纯函数测；原子 UPDATE 用 scheduler-selection.test.ts:166-177 同款 vi.mock 注入返回 [] 的 update().returning() 验证抛错且 required/remaining/limit/used 正确。
- 建议测试：`'throws ExternalApiKeyQuotaExceededError with correct required/remaining when update affects 0 rows'`；`'is a no-op for missing apiKeyId or non-positive amount'`；`'refund clamps creditsUsed at zero'`。
- 复核结论：降 high→medium。修正："DB 紧耦合不可测"夸大——repo 已用 vi.mock(@repo/database) + drizzle-orm operators mock 成功测同型 UPDATE，本条可用现有模式直测，属缺测非结构不可测。

#### C-M6. 套餐分级暴露模型 models.ts 纯函数零测试（错误分级会向低档套餐泄露高档模型）
- Severity: medium
- 位置：`apps/web/src/features/external-api/models.ts:29-108`
- WHY：getExternalResponsesImageModels/getExternalChatCompletionModels 决定不同套餐可见/可用模型，无单测。关键分支无覆盖：responsesAllowed/chatCompletionsAllowed=false 返空数组；gpt55Allowed ?? isPlanAtLeast(plan,'ultra') 默认推断（44 行，GPT55_CHAT_MODEL 仅 ultra+）。门控回归则低档用户在 /v1/models 看到并调用越权模型，isExternalResponsesImageModelAllowed 据此放行，构成功能性越权。
- 修复建议：新建 models.test.ts 表驱动覆盖能力关闭→空数组、gpt55 仅 ultra 可见、显式 gpt55Allowed 覆盖默认。
- 建议测试：`'returns empty list when responses capability disabled'`；`'includes gpt-5.5 only for ultra and above by default'`；`'honors explicit gpt55Allowed override'`；`'chat completions reuses responses model set when allowed'`。
- 复核结论：维持 medium（覆盖缺口 + 可信回归路径，但有纵深防护——isExternalResponsesImageModelAllowed 先校验 capabilities，能力矩阵本身已测）。

#### C-M7. chat-completions-utils 的 tool/function 角色与字符串型 image_url 分支未覆盖
- Severity: medium
- 位置：`apps/web/src/features/external-api/handlers/chat-completions-utils.ts:49-117`
- WHY：现有测试只覆盖 system/user/assistant + 对象型 image_url。未覆盖：tool/function 角色并入 history 加 'Tool output:' 前缀（110-116，映射错污染上下文）；getChatCompletionContentImages 对字符串型 image_url（32-35）；flushPromptToHistory 对连续多条 user 消息；buildChatCompletionAssistantContent 无文本仅图片回退 'Image generated.'、includeText:false 抑制文本。纯函数 DB-free。
- 修复建议：在 chat-completions-utils.test.ts 追加覆盖上述分支。
- 建议测试：`'maps tool/function role into history with Tool output prefix'`；`'extracts string-form image_url parts'`；`'flushes earlier user message into history when followed by another user message'`；`'falls back to "Image generated." when only images and no text'`；`'omits text when includeText is false'`。
- 复核结论：维持 medium（客户面 v1 chat-proxy 纯函数覆盖缺口，CLAUDE.md MUST，代码本身正确属回归保护风险）。

#### C-M8. 失败分类与冷却链（classifyFailure / resolveCooldownDate / parseResetDateFromError / clampResetDate / parseDurationMs）零单测且不可测
- Severity: medium
- 位置：`apps/web/src/features/image-backend-pool/service.ts:823-921, 758-786, 713-756, 707-711, 349-384`
- WHY：这条链是后端池核心状态机（classifyFailure 决定后端置 error/limited/active 并算 cooldownUntil，影响 selectPoolMember 多久不可调度）。分类优先级回归会把瞬时 429/503 误判 unrecoverable 永久禁用，或把 invalid_refresh_token 误判可恢复反复重试；clampResetDate 14 天上限失效会让后端被恶意 retry-after 冻结数月。全为模块内未导出且与 system-settings 耦合，DB-free vitest 无法直测。现有测试仅覆盖 isImageBackendSwitchableError 4 用例，未触及 status/cooldownUntil 产出。
- 修复建议：抽四个纯函数（parseDurationMs/clampResetDate/parseResetDateFromError/resolveCooldownDate）到不 import @repo/database 模块并导出补边界单测；classifyFailure 注入/参数化 cooldown 分钟数解耦后覆盖 status/cooldownUntil 各分支。
- 建议测试：`'429/rate limit 置为 active 并按 RATE_LIMIT 分钟数算 cooldown'`；`'usage limit 置 limited 且优先采用 retry-after'`；`'invalid refresh token / 401 置 error 且 cooldownUntil=null'`；`'moderation_blocked 返回空对象不改状态'`；`'parseResetDateFromError 解析多格式'`；`'clampResetDate 截断超 14 天且对过去返回 null'`；`'parseDurationMs 解析 90s/15m/2h/1d/1h30m'`。
- 复核结论：降 high→medium（覆盖/可测性缺口，未指出现存回归，论证"若回归则后果严重"）。

#### C-M9. reportImageBackendResult 的 retryable/switchable 失败转移决策无任何断言
- Severity: medium
- 位置：`apps/web/src/features/image-backend-pool/service.ts:1652-1765`
- WHY：reportImageBackendResult 是生图管线失败后决定是否换后端重试的唯一出口（返回 {retryable,switchable,status,cooldownUntil} 并把计数/status/cooldownUntil/lastError 落库）。成功分支清空 cooldownUntil 并对 web 账号走 nextWebAccountMetadataAfterSuccess 扣额度。其 outcome 计算与 DB 写在 image-backend-pool 测试目录 0 断言。
- 修复建议：用 scheduler-selection.test.ts 同款 dbMock 测各类 error 的 retryable/switchable 与写入 status/cooldownUntil/successCount/failCount、成功时清空 cooldownUntil/lastError、缺 memberId 短路。
- 建议测试：`'429 失败: retryable/switchable=true、status=active、未来 cooldownUntil、failCount+1'`；`'moderation_blocked: retryable/switchable=false、status 不变'`；`'invalid api key: switchable=true、status=error、cooldownUntil=null'`；`'成功: 清空 cooldownUntil/lastError 且 successCount+1'`；`'缺 memberId 短路不发 db.update'`。
- 复核结论：降 high→medium。修正："决策零断言"对 load-bearing 半部为假——真正的 failover 布尔 switchable 来自 isImageBackendSwitchableError，已在 backend-error-classification.test.ts 覆盖（含 moderation/safety→false）；retryable 仅进日志非控制流。真实缺口是 wrapper 的未测 glue（outcome 映射、per-member DB 写、成功清 cooldown、web-metadata 扣减、memberId 短路）。

#### C-M10. Web 账号额度扣减与可用性门控（nextWebAccountMetadataAfterSuccess / isWebAccountQuotaAvailable）零单测
- Severity: medium
- 位置：`apps/web/src/features/image-backend-pool/service.ts:1005-1017, 1019-1046, 963-984`
- WHY：isWebAccountQuotaAvailable 决定 quota 耗尽的 web 账号是否仍被选中（quota>0 或 restoreAt 已到才可用，imageQuotaUnknown 无条件可用）；nextWebAccountMetadataAfterSuccess 每次成功后 quota 减 1，减到 0 时置 limited 并设 cooldownUntil=restoreAt。减额回归会让已耗尽账号被反复选中打到上游 429，或永不减额致额度失真。三者未导出零测试，前者纯函数。
- 修复建议：导出（或抽纯模块）补单测覆盖 quota 边界、imageQuotaUnknown、restoreAt 过去/未来。
- 建议测试：`'quota>0=true，quota=0 restoreAt 未来=false，restoreAt 已过=true'`；`'imageQuotaUnknown 始终可用'`；`'non-web backend 始终可用'`；`'quota 1→0 时 status=limited 且 cooldownUntil=restoreAt'`；`'quota 3→2 时仍 active'`；`'imageQuotaUnknown 成功不改 quota'`。
- 复核结论：降 high→medium（逻辑正确无现存缺陷，回归风险在资源消耗/恢复路径）。

#### C-M11. 并发计数器 acquire/releaseImageBackendInflight 与 backendLoadRate 负载均衡逻辑无单测
- Severity: medium
- 位置：`apps/web/src/features/image-backend-pool/service.ts:205, 422-443, 390-396`
- WHY：backendInflight 进程内 Map 记每后端在途数，selectPoolMember 排序在 priority 相同时用 backendLoadRate(inflight/concurrency) 与 backendInflightCount tie-break。release 边界（current<=1 时 delete 否则 -1）回归成永远 -1 或不 delete 会出现负数/泄漏，使后端被永久判高负载不再调度。两导出函数 + backendLoadRate 在测试里 0 覆盖。
- 修复建议：补纯内存单测（acquire 增加、release 配对归零并删 key、release 不变负、backendLoadRate=inflight/max(1,concurrency)），并补 selectPoolMember 排序用例验证低负载优先。
- 建议测试：`'acquire×3 后 release×3 归零且 key 删除'`；`'未 acquire 直接 release 不得负'`；`'缺 memberType/memberId 时 no-op'`；`'backendLoadRate concurrency=0 时按 1 兜底'`；`'priority 相同 A 在途 0 / B 在途 2 时选 A'`。
- 复核结论：维持 medium（偏低端，纯进程内状态重启即丢，release 已有 delete/no-op 防护，回归影响调度退化非计费）。修正：需走 vi.mock(@repo/database) 模式而非"直接测"；backendLoadRate/backendInflightCount 模块私有需经 selectPoolMember 间接验证。

#### C-M12. scheduler-selection 仅测 50 截断回归，未覆盖 priority/load/lastUsed/preferredMemberId 排序与计费 multiplier 透传
- Severity: medium
- 位置：`apps/web/src/features/image-backend-pool/scheduler-selection.test.ts:282-399`；被测 service.ts:1436-1458（排序）与 1489-1580（toResolvedPoolConfig 计费）
- WHY：selectPoolMember 最终排序按 preferredMemberId>priority>负载率>inflight>lastUsedAt>createdAt 多级 tie-break，决定哪个后端承接请求与扣费分组；toResolvedPoolConfig 据 group 计算 billingMultiplier 写入 backend.billingMultiplier（直接进扣费）。现有 3 用例未断言同分组按 priority/最久未用排序、preferredMemberId 置顶、嵌套 mixed 父组按父×子透传 billingMultiplier 端到端落到 config。
- 修复建议：基于现有 dbMock 增补排序与计费透传用例，可先 acquireImageBackendInflight 设在途数再 resolve。
- 建议测试：`'同 priority 时选 lastUsedAt 最早的成员'`；`'priority 较小者优先于负载更低者'`；`'preferredMemberId 命中无视 priority 置顶'`；`'父 mixed 组 multiplier=2、子组=1.5 调度到子组成员时 backend.billingMultiplier===3'`；`'成员留在父组时仅取父组值'`。
- 复核结论：维持 medium（multiplier 核心数学已在 group-billing.test.ts 测，未测仅 resolver→backend 的薄接线 + 确定性低复杂度 sort comparator）。

#### C-M13. 错误关键字谓词族（isRecoverable/isInvalidCredential/isUsageLimit/isOverload/isUnsupportedModel/isUserRequest）仅经 isImageBackendSwitchableError 间接覆盖 4 例
- Severity: medium
- 位置：`apps/web/src/features/image-backend-pool/service.ts:445-505, 569-591, 593-621, 633-655, 657-681, 534-545`
- WHY：这些谓词共维护上百个错误关键字，是 classifyFailure 与 isImageBackendSwitchableError 判定基石，决定换号/冷却/永久禁用三命运。现有测试仅经 isImageBackendSwitchableError 断言 4 类，未覆盖 unsupported model（应可恢复+换号）、invalid credential（应 error 状态）、insufficient credits/billing_hard_limit、overload 502/503/504。关键字表高 churn 易误判，缺各谓词布尔真值的细粒度断言。
- 修复建议：导出谓词（或随 service.ts 拆分抽纯模块）为每个谓词写真值表测试，特别覆盖 unsupported model 既可恢复又 switchable、invalid credential switchable=true 但 classifyFailure 给 error 两类易混边界。
- 建议测试：`'isUnsupportedModelBackendError 命中 model_not_supported/不支持该模型且 switchable=true'`；`'isInvalidBackendCredentialError 命中 401/invalid api key/token expired'`；`'isUsageLimitBackendError 命中 insufficient credits/billing_hard_limit 但不命中纯 429'`；`'isOverloadBackendError 命中 502/503/internal server error'`；`'moderation_blocked 文本 recoverable=true 但 switchable=false'`。
- 复核结论：维持 medium（逻辑现正确但缺细粒度真值表测试，决定三类高影响命运 + 两类易混边界）。

#### C-M14. 鉴权分层 actions.ts 无单测：管理员/订阅能力门控未验证（adminAction 与 imageBackendPoolViewerAction 边界）
- Severity: medium
- 位置：`apps/web/src/features/image-backend-pool/actions.ts:87-91`（admin/viewer 包装）, `93-119`（protectedAction 偏好读写）；service.ts:1955-1962、1994-2020
- WHY：写操作经 adminAction，用户偏好读/写经 protectedAction/imageBackendPoolViewerAction。setUserImageBackendPreference 还有"非订阅能力则抛错"的 canUsePlanCapability 门控，listSelectableImageBackendGroups 按 plan 过滤。这些是越权防线，无任何 actions 层或门控测试——误把某 adminAction 降级为 protectedAction，CI 不报警。
- 修复建议：为 setUserImageBackendPreference 套餐门控写 DB-mocked 单测（canUsePlanCapability=false 抛错且不写库、groupId 不存在/不可选抛错、合法时落库）；加静态断言遍历 actions.ts 导出确认配置类 action 均经 adminAction。
- 建议测试：`'canUsePlanCapability 为 false 且 groupId 非空时抛错且不写库'`；`'groupId 指向不可选/禁用分组时抛错'`；`'合法分组时按 existing 走 update 否则 insert'`；`'listSelectableImageBackendGroups 无 backendGroups.select 能力时返回 []'`；`'upsert*/delete*/sync* 均使用 adminAction client'`。
- 复核结论：维持 medium（门控代码正确非现存漏洞，但安全边界回归保护缺失 CI 不报警）。

#### C-M15. user-plan 测试质量：self-use 超管与正常路径 DB 调用次数耦合，仅 1 个正常订阅用例，priceId 映射依赖 PAYMENT_PROVIDER 全局态
- Severity: medium
- 位置：`packages/shared/src/subscription/services/user-plan.test.ts:83-111`
- WHY：唯一正常付费用例靠临时设 PAYMENT_PROVIDER='epay' 才能让 getPlanFromPriceId('pro_monthly') 命中（PRICE_IDS 随提供商变），只测 epay+pro 一种组合。Creem（生产默认）下的 priceId 映射、starter/ultra/enterprise 各档均未覆盖；映射回归会让付费用户映射成错误套餐。self-use 分支断言了 dbMock.select 次数，但正常路径未对 select 次数/条件断言。
- 修复建议：为 getPlanFromPriceId 增独立 DB-free 单测覆盖两种 PAYMENT_PROVIDER × 全部套餐档（monthly/yearly）；getUserPlan 正常路径增 starter/ultra/enterprise 用例；避免靠环境变量驱动映射。
- 建议测试：`it.each(['epay','creem'])('maps every paid priceId to its plan for %s provider')`；`'returns null for an unrecognized priceId'`；`'maps starter/ultra/enterprise priceIds to the right plan and planName'`。
- 复核结论：维持 medium（偏低端，测试质量缺口；生产 getPlanFromPriceId 逻辑正确，最常用 creem 路径完全未演练）。

#### C-M16. 外接 API Key 配额纯函数零测（与 C-M4 同子系统，登记互补）
- 见 C-M4。

#### C-M17. 本地存储 safePath 路径穿越守卫零有效单测（且与 DB 紧耦合无法直接测）
- Severity: medium
- 位置：`packages/shared/src/storage/providers/local.ts:23-44`
- WHY：safePath 是 local 存储 deleteObject/getObject/putObject 的唯一目录穿越防线（substring 快检 + path.resolve/startsWith 权威校验）。逻辑回归（startsWith 缺 path.sep、resolvedBase 错误）可读/删 baseDir 外任意文件。活动套件零覆盖；唯一存在的 src/test/storage/security.test.ts 在死 legacy 树且只测重新实现的 stub 不 import 真实 safePath。safePath 经 getBaseDir() 依赖 getRuntimeSettingString（→ DB）使 DB-free vitest 无法直接 import。
- 修复建议：抽纯路径判定 resolveSafePath(baseDir,bucket,key) baseDir 入参注入，在 local.test.ts 补单测；getBaseDir 仅取配置后调用纯函数。
- 建议测试：正常 key 返回 join(base,bucket,key)；key 含 '..' throw；bucket 含 '..' throw；绝对路径/Windows 反斜杠不逃逸 base；前缀混淆 base='/data/gen' 不接受 '/data/gen-evil/x'（验证 startsWith 带 path.sep）。
- 复核结论：维持 medium。修正：HTTP 路由（route.ts:32-43）有 ALLOWED_BUCKETS 白名单 + 拒 `..`/前导 `/`/反斜杠的 defense-in-depth，故经 HTTP 入口 safePath 单独回归不会立即任意文件读取；getImageBase64 经 parseLocalStorageImageUrl 是相对更接近未受路由守卫的输入路径，建议一并覆盖。

#### C-M18. 公共存储读取路由 GET 的 bucket 白名单与路径拒绝逻辑零覆盖
- Severity: medium
- 位置：`apps/web/src/app/api/storage/[bucket]/[...key]/route.ts:32-43`
- WHY：唯一对外暴露读取存储对象的端点。安全门：ALLOWED_BUCKETS.has(bucket) 拒非白名单（403）、对 fileKey 的拒绝（空/含 '..'/以 '/' 开头/含 '\\' → 400）。活动套件无 route 测试。该 route key 校验与 local.ts safePath 不一致（不查 URL 编码 %2e%2e、不限字符集），白名单/拒绝放宽即越权读其他桶或穿越。
- 修复建议：新增 route.test.ts，import GET 并 mock getStorageProvider（stub getObject），用构造的 params Promise 调用 GET 断言状态码与是否调用 getObject。
- 建议测试：`'rejects non-whitelisted bucket'`（403 且 getObject 未调用）；`'rejects traversal/backslash/leading-slash keys'`（400）；`'serves whitelisted bucket with correct content-type & cache-control'`（200、image/png、immutable）；`'maps getObject failure to 404'`。
- 复核结论：降 high→medium（local safePath 提供穿越纵深防御，真正动机是 s3 provider 完全无 bucket/key 校验使路由白名单+key 检查 load-bearing；代码当前正确即时影响不及 high）。

#### C-M19. getSignedUploadUrlAction / deleteFileAction 的属主校验（key.includes(userId)）零覆盖且校验本身偏弱
- Severity: medium
- 位置：`packages/shared/src/storage/actions.ts:86-90, 139-142`
- WHY：上传/删除签名 URL 的越权防护核心是 `if (!key.includes(userId)) throw`，IDOR 防护点活动套件零覆盖。该校验偏弱：includes 是子串匹配，若 userId 是另一 userId 子串或 key 任意位置出现目标 userId 子串可绕过。死 legacy 测试 security.test.ts:235-245 还把此弱点当"特性"断言。整段含 bucket 白名单失败路径同样无测。
- 修复建议：把属主判定抽纯函数 keyBelongsToUser(key,userId)（改为锚定 userId 前缀/边界而非子串），在 storage/actions 纯逻辑测试覆盖；bucket 白名单亦抽纯函数测。
- 建议测试：`${userId}/abc.png`→true；他人 key→false；子串攻击 userId='u1' key='u12/evil.png' 当前返回 true→断言期望 false（防回归）；`isBucketAllowed` 白名单内 true、外部桶 false。
- 复核结论：降 high→medium（Better Auth ~32 字符随机 id 使子串碰撞实际几乎不可能，live IDOR 近零；recommendation 的 '/'-segment 不符本仓 key 结构——应锚定 `${userId}` / `${userId}-` / `${userId}/` 前缀边界）。

#### C-M20. /api/upload/presigned 的 fileSize/文件类型校验失败路径零覆盖
- Severity: medium
- 位置：`apps/web/src/app/api/upload/presigned/route.ts:85-98, 75-83`
- WHY：A14 修复后服务端强制 fileSize 校验（number && finite && >0 && <=10MB）与 getFileTypeFromName 白名单（仅 pdf/docx/md/txt）并服务端派生 Content-Type 防存储型 XSS。安全/边界失败路径活动套件零覆盖。fileSize 边界与未授权 401 分支易回归（误把校验改回信任客户端 contentType）。
- 修复建议：新增 route.test.ts，mock auth.api.getSession 与 getSignedUrl，直接 POST 断言状态码与 fileKey/contentType 派生。
- 建议测试：`'401 when unauthenticated'`；`'400 on unsupported extension'`；`'400 on non-finite/negative/zero/missing/over-max fileSize'`（参数化）；`'accepts exactly MAX_FILE_SIZE'`；`'derives safe content-type server-side, ignoring client contentType'`（contentType='text/html' 但 filename='a.pdf' → application/pdf）。
- 复核结论：降 high→medium（A14 安全逻辑当前正确，回归测试缺口非活跃漏洞）。

#### C-M21. getFileTypeFromName 扩展名解析纯函数零覆盖（presigned 上传白名单依赖它）
- Severity: medium
- 位置：`apps/web/src/lib/file-utils.ts:30-36`
- WHY：getFileTypeFromName 是 presigned 上传决定"是否允许 + 用哪个安全 MIME"的唯一类型判定函数，纯函数零依赖却无测试。边界：无扩展名 null、大小写归一(.PDF)、多点取最后段(a.tar.txt→txt)、未知扩展 null。回归直接放行/误拒上传类型。
- 修复建议：新增 file-utils.test.ts 覆盖 getFileTypeFromName 与 getFileTypeFromMime。
- 建议测试：`'doc.PDF'→'pdf'`、`'report.docx'→'docx'`、`'a.tar.txt'→'txt'`、`'noext'→null`、`'a.exe'→null`、`''→null`；getFileTypeFromMime 合法/未知映射；纯 dotfile `.txt`→'txt' 边界。
- 复核结论：维持 medium（上传白名单与安全 MIME 派生单一决策点，CLAUDE.md 要求安全校验/边界必测，零覆盖与硬约束冲突；函数稳定极小故不上调）。注意 src/lib 另有遗留扁平副本，以 apps/web 版为准。

#### C-M22. 角色/权限矩阵纯函数零测（见 C-H6，security 边界）

#### C-M23. 防薅羊毛邮箱归一 canonicalizeEmailForIdentity 零单测（A8 修复点无回归守护）
- Severity: medium
- 位置：`packages/shared/src/auth/email-domain.ts:26-52`
- WHY：canonicalizeEmailForIdentity 是 A8 修复（把 Gmail 点号别名与所有域 +tag 别名归一到同一身份键），被注册查重与 admin 建号/改邮箱查重用于防一邮箱多注册领新人积分。纯字符串 DB-free 却零单测。边界易错：gmail 去点也去 +tag、googlemail 也算 gmail、非 gmail 只去 +tag 保留点号、local 为空回退原值、无 @ 或 @ 在首位原样返回。回归重开 N×100 积分薅羊毛口子无报警。
- 修复建议：新增 email-domain.test.ts 覆盖各分支与 isAllowedRegistrationEmail 域白名单。
- 建议测试：`canonicalize('V.I.C.T.I.M+promo@Gmail.com')==='victim@gmail.com'` 且 `'a.b@googlemail.com'→'ab@googlemail.com'`；`'a.b+x@qq.com'==='a.b@qq.com'`；`'+tag@qq.com'` 回退原值；`'noat'/'@x.com'` 原样；isAllowedRegistrationEmail gmail/qq/163/126 放行、outlook.com/空域拒绝。
- 复核结论：降 high→medium（当前各分支正确，HIGH 经济影响仅在未来回归才发生，coverage lens 校准为 medium）。

#### C-M24. 注册验证码暴力破解防护(A10)的尝试计数状态机不可单测：核心逻辑未抽离且与 DB 紧耦合
- Severity: medium
- 位置：`packages/shared/src/auth/registration-verification.ts:29-41, 117-143`
- WHY：verifyRegistrationCode 实现 A10（6 位码 10^6 空间 + MAX_VERIFY_ATTEMPTS=5 达上限作废）。判定靠 encodeCodeValue/decodeCodeValue（把 'code|attempts' 编进单列）与 attempts>=5 转移。这段纯函数但未 export，verifyRegistrationCode 把 decode/守门/比对/自增/作废与 db 交织一个函数无法 DB-free 测。关键安全分支：attempts>=5 真失效吗、decode 对老数据/'code|NaN' 是否回退 attempts=0（否则永不失效=暴破口子）全无守护。
- 修复建议：把 decode/encode 与 evaluateVerificationAttempt(record,输入码,now)→{valid/invalid/expired/locked,nextAttempts,shouldDelete} 抽纯函数补单测；或按 user-plan.test.ts 范式 vi.mock @repo/database 直测 verifyRegistrationCode。
- 建议测试：`'locks out after MAX_VERIFY_ATTEMPTS wrong tries'`；`'increments attempts on wrong code below limit'`；`'decodeCodeValue falls back to attempts=0 for legacy plain value and NaN'`；`'returns false and deletes on expired record'`；`'succeeds and consumes code on exact match'`。
- 复核结论：降 high→medium（当前两个安全回退与锁定状态机正确，A10 防护此刻有效，是回归风险；安全控制 + 硬约束故 medium 不降 low）。

#### C-M25. 本地超管自动提权后门 getUserRoleById 零单测，提权触发条件无断言
- Severity: medium
- 位置：`packages/shared/src/auth/role-server.ts:7-27`
- WHY：getUserRoleById 内含自动提权：role==='admin' 且 email==LOCAL_SUPER_ADMIN_EMAIL('admin@gpt2image.local') 时副作用升 super_admin。该函数是 adminAction/superAdminAction/checkAdmin 取角色唯一入口，授权链根。提权条件须严格（admin + 精确邮箱、toLowerCase 不敏感），误改邮箱常量/去掉 role 前置/改模糊匹配会成提权后门无报警。
- 修复建议：按 user-plan.test.ts 范式 mock @repo/database，对提权分支与非提权分支各加断言。
- 建议测试：`'promotes admin@gpt2image.local from admin to super_admin and persists'`；`'does NOT promote when role is user even with local email'`；`'does NOT promote a different email even when role is admin'`；`'email comparison is case-insensitive'`；`'normalizes unknown DB role to user'`。
- 复核结论：维持 medium（偏低端，授权链根 + 未来弱化编辑成提权后门，无现存缺陷故不 high）。

#### C-M26. 管理员建号/改邮箱双重查重链 createUserAction/updateUserProfileAction 无测试，越权占位与重复领奖防护无守护
- Severity: medium
- 位置：`packages/shared/src/support/actions/admin-users.ts:1117-1191, 1197-1269`
- WHY：两 action 是绕过 Better Auth databaseHooks 直插 user/account 的高权路径，安全性依赖手写双重查重（isRegistrationEmailTaken canonical 键 + user.email lower 唯一兜底）。updateUserProfile 改邮箱时须排除自身（id <> targetId）。查重短路顺序、排除自身、改邮箱后同步 recordRegistrationIdentity 全无测试。回归后查重被绕过（同邮箱多号薅注册奖励）或改邮箱永报"已占用"。
- 修复建议：按 vi.mock('@repo/database') 范式抽测两 action 查重短路与排除自身逻辑（或抽半纯辅助函数测）。
- 建议测试：`'rejects when isRegistrationEmailTaken returns true'`；`'rejects when user.email unique fallback finds row'`；`'inserts user+credential+balance+identity on clean email'`；`'skips dedup when normalized email unchanged'`；`'excludes self in user.email conflict query (id <> userId)'`；`'syncs registration_identity to new email only when email actually changed'`。
- 复核结论：维持 medium（保护正确无现存漏洞，但在 authz + 防重复领奖反欺诈路径上 CLAUDE.md 要求单测）。

#### C-M27. 超管覆盖积分 adminAdjustCreditsAction 的余额对账/补差扣差分支无单测（金额计算无守护）
- Severity: medium
- 位置：`packages/shared/src/support/actions/admin-users.ts:795-920`
- WHY：adminAdjustCreditsAction 按 mode='set'|'deduct' 调整余额，含 normalizeAdminCreditAmount 四舍两位；set 模式 adjustment=amount-beforeBalance（正→grant、负→consume、0→noop）；deduct 模式 amount>beforeBalance 抛"余额不足"。这些决定铸/扣多少积分，零测试。符号判断、set→0 noop 短路、deduct 守门、EPSILON 取整边界任一回归多扣/少扣/多发。
- 修复建议：将 mode/amount/beforeBalance→adjustment 与操作(grant/consume/noop/reject) 抽纯决策函数测；或 mock credits/core 与 @repo/database 测分支选择。
- 建议测试：`'set above balance computes positive adjustment -> grant'`；`'set below balance -> consume Math.abs(adjustment)'`；`'set equal balance -> noop audit'`；`'deduct rejects when amount > balance'`；`'normalizeAdminCreditAmount rounds to 2 decimals at EPSILON boundary'`。
- 复核结论：维持 medium（super-admin 门控、低频、可信主体限制爆炸半径；grant/consume 的 amount<=0 守卫吸收最坏 sign-flip，残留为 mis-magnitude/noop/over-deduct/rounding 回归）。

#### C-M28. /api/session/current 会话失效自清 cookie 逻辑无测试（删号/孤儿会话登出路径未守护）
- Severity: medium
- 位置：`apps/web/src/app/api/session/current/route.ts:63-94, 25-53`
- WHY：getCurrentSessionResponse 是前端判定登录态权威端点：getSession 无 user 或 session 有效但 DB 查不到 user（删号）时返 null 并 clearAuthCookies 清掉全部 better-auth cookie。"有 session 但 user 不存在→强制登出"是删号兜底失效关键，无测试。clearAuthCookies 枚举的 cookie 名单漏删某个会让浏览器仍持可用会话痕迹。withNoStore 缓存头同样关键且无断言。
- 修复建议：mock getSession 与 DB 查询、next/headers cookies，断言三返回路径与 cookie 清除/缓存头。
- 建议测试：`'returns null and clears all auth cookies when session has no user'`；`'returns null and clears cookies when session valid but user not in DB'`；`'returns merged session+currentUser when user exists'`；`'always sets no-store/private cache headers'`。
- 复核结论：维持 medium（auth 关键路径零覆盖，但服务端兜底缓解——即使漏删某 cookie route 仍返 null 视为登出，真正鉴权在服务端 + assertUserCanAuthenticate）。

#### C-M29. self-use 超管覆盖与正常路径的 DB 调用次数耦合（见 C-M15）

#### C-M30. 支付金额校验闸门依赖的套餐定价纯函数 getCreditPackagePriceForPlan 零单测
- Severity: medium → 复核降为 medium（原 high 降）
- 位置：`packages/shared/src/credits/packages.ts:275-299`
- WHY：getCreditPackagePriceForPlan(pkg,plan) 纯函数按 PLAN_RANK 向下回退在 pkg.pricesByPlan 寻首个命中价，找不到回退 pkg.price，返回值直接作"期望支付金额"（epay-fulfillment.ts:182-185、creem route.ts:220、actions.ts:371/461）。回退顺序或"缺档回退上一档"出错则校验闸门接受错误金额→低价购高额积分。getCreditPackageCreemProductIdForPlan 同理。二者 DB-free 全仓无单测。
- 修复建议：新增 packages.test.ts 构造 RuntimeCreditPackage 字面量纯函数测，覆盖恰好命中/缺档向下回退/全缺回退 pkg.price/free 边界。
- 建议测试：`'falls back to the nearest lower configured plan price when the requested plan is missing'`（pricesByPlan={starter:20} 时 getCreditPackagePriceForPlan(pkg,'pro')===20、(pkg,'free')===pkg.price）；`'routes to the per-plan creem product id, else credits_<id>'`。
- 复核结论：降 high→medium（当前逻辑正确，最易利用的 epay 路径另有 isExpectedEpayAmount + DB 幂等兜底，真实暴露是静默回归而非现存低价购漏洞）。

#### C-M31. 支付金额防篡改解析函数 moneyToCents 零单测
- Severity: medium（原 high 降）
- 位置：`packages/shared/src/payment/epay.ts:622-630`（另登记 C-M37 同函数另一视角）
- WHY：moneyToCents 以正则 `^\d+(\.\d{1,2})?$` 校验后换算整数分，非法返 NaN。是 epay 金额校验唯一换算入口（isExpectedEpayAmount 两侧）。换算出错（'20.5' 补零、整数、超两位小数）导致少收/误拒/绕过支付校验。grep 确认无测试。
- 修复建议：在 packages/shared/payment 新增 epay.test.ts 专测 moneyToCents 覆盖整数/补零/两位/前后空格/非法返 NaN（epay.ts 顶部 import @repo/database，需先抽 DB-free 模块或 vi.mock）。
- 建议测试：`moneyToCents('20')===2000`、`'20.5'===2050`、`'20.05'===2005`、`20.1===2010`；`'20.555'/'-1'/'abc'/' 20 '` 为 NaN。
- 复核结论：降 high→medium（逐例验证当前逻辑正确无 live bug，仅缺回归保护，且消费方有 Number.isFinite + 10 分容差纵深；"极易单测"略夸大——须先抽 DB-free 模块）。

#### C-M32. Epay metadata 编解码与 normalizeEpayMetadata 零覆盖（履约路由依据）
- Severity: medium
- 位置：`packages/shared/src/payment/epay.ts:486-620`
- WHY：encode/decode/normalizeEpayMetadata 决定 epay 支付路由为 credit_purchase 还是 subscription、归属 userId、升级补差 expectedAmount/prorationCredit。fulfillSuccessfulEpayPaymentInner 第一步 decode 并校验 metadata.outTradeNo===verifyInfo.outTradeNo（防套用）。紧凑 base64url 单字母键双向兼容、numberValue 清洗、type/userId/outTradeNo 缺失返 null 全零覆盖。编解码不对称或 normalize 漏字段致补差金额丢失或 userId 错配发错账户。
- 修复建议：先把 codec 抽到不 import @repo/database 的 DB-free 模块，再新增 round-trip 与异常输入测试锁定紧凑键映射契约。
- 建议测试：round-trip `'preserves subscription upgrade fields'`/`'preserves credit_purchase quantity'`；decode `'returns null on malformed base64'`/`'type missing'`/`'userId or outTradeNo missing'`；normalize `'maps single-letter to long keys'`/`'coerces numeric strings'`/`'drops non-positive quantity'`。
- 复核结论：维持 medium。修正：epay.ts 顶层 import @repo/database，按本仓规则须先抽 DB-free 模块才能直接 import；运行时有 outTradeNo 失败兜底 + DB-metadata fallback + 下游金额复校限制爆炸半径，是缺测非 live bug。

#### C-M33. 可测试性：epay.ts 顶层 import @repo/database 污染全部纯函数
- Severity: medium
- 位置：`packages/shared/src/payment/epay.ts:15-16`
- WHY：epay.ts 顶层 import { db } 与 epayOrder schema，而 signEpayParams/verifyEpayParams/buildSignPayload/filterParams/moneyToCents/encode/decode/normalize 都 DB 无关（占多数）。DB-free vitest 下仅测纯函数也必须连带加载真实 DB 模块。违反 CLAUDE.md "纯函数须抽到不 import @repo/database 的模块"，是 C-H10/C-M31/C-M32 零覆盖的结构性根因。
- 修复建议：拆 epay.ts，签名/金额/metadata 纯逻辑移到 epay-core.ts（不 import @repo/database），DB 访问留 epay.ts re-export，为 epay-core.ts 加 DB-free 单测。
- 建议测试：`epay-core.test.ts` 直接 import 无需 vi.mock；加结构回归 `'epay-core has no @repo/database import'` 读源文件断言不含该字符串。
- 复核结论：维持 medium（结构/可测性缺陷非运行时缺陷，有已知 vi.mock workaround；但未覆盖的纯函数含安全敏感签名/验签/金额解析，修复低成本机械）。

#### C-M34. moneyToCents 金额解析零覆盖，边界/非法输入未验证（与 C-M31 同函数另一登记）
- Severity: medium
- 位置：`packages/shared/src/payment/epay.ts:622-630`
- 说明：与 C-M31 为同一函数的两份发现，合并处理。建议测试见 C-M31。
- 复核结论：降 high→medium（当前实现正确，回归风险，须先解耦 @repo/database 或 vi.mock）。

#### C-M35. 队列 per-user 并发与优先级（见 C-M1，重复登记合并）

#### C-M36. resolution.ts 的模型解析与尺寸归一化（计费像素来源）大量纯函数无单测
- Severity: medium
- 位置：`apps/web/src/features/image-generation/resolution.ts:30-51, 170-340`
- WHY：归一化尺寸最终决定 getImageCreditCost 的 pixels→计费基价。parseImageSize、fitImageDimensionsToValidSize/normalizeValidImageSize（夹取 256..3840、步长 16、最小/最大像素、最大宽高比 3:1 的迭代生长/收缩）、getImageModel/isImageModel/normalizeImageModel（决定图像还是文本计费分支）都是计费正确性前置纯逻辑。live resolution.test.ts 仅覆盖定价与 validateImageSize，grep 确认对 getImageModel/fitImageDimensionsToValidSize/parseImageSize/roundUpCreditAmount/normalizeImageModel 命中 0。fitImageDimensionsToValidSize 含 while 循环边界易回归。
- 修复建议：在 apps/web 的 resolution.test.ts 增补对上述纯函数测试；删除/迁移死的 src/test/image-resolution.test.ts。
- 建议测试：`'fitImageDimensionsToValidSize clamps oversize, grows undersize, enforces 3:1, snaps to step 16'`；`'getImageModel returns DEFAULT for legacy/blank, null for non-image, passes through gpt-image-*'`；`'roundUpCreditAmount ceils at 2dp without float drift'`。
- 复核结论：维持 medium（主路径计费经定价测试间接覆盖，迭代夹取/生长与模型解析才是真空白，易回归无护栏）。修正：根 src/test/image-resolution.test.ts 经根 vitest.config.ts 可被裸 vitest 执行但不接入 turbo test 且不覆盖被指函数。

#### C-M37. 积分账本核心与 DB 紧耦合致幂等与 FIFO 逻辑无法单测
- Severity: medium
- 位置：`packages/shared/src/credits/core.ts:337-838`
- WHY：consumeCredits（FIFO + 双层幂等）、grantCredits（onConflictDoNothing）、voidActiveSubscriptionCreditsForUpgrade（升级作废 + GREATEST(0,...) 防负）是财务真相，承载并发/重放/不足额/冻结/边界分支。全模块 import db 并把逻辑写在 db.transaction 闭包内，DB-free vitest 无法测，仅纯工具 idempotency.ts 被抽出并测。违反 CLAUDE.md。
- 修复建议：将不依赖 db 的判定/计算抽纯函数单独成文件测（FIFO 比较器、扣费分摊、normalizeCreditAmount、void totalVoided+GREATEST 下限）；DB 事务路径引入与 DB-free 分离的集成测试 project（testcontainers/独立 vitest project）覆盖并发双扣（同 sourceRef 触发 23505→幂等返回）与重放发放。
- 建议测试：`'normalizeCreditAmount rounds to 2dp and throws on non-finite'`；`'FIFO comparator orders bonus<subscription<purchase then never-expire last then earliest expiry'`；`'[db-integration] second concurrent consume with same sourceRef returns alreadyConsumed without double charge'`。
- 复核结论：降 high→medium（生产已有 DB 层兜底：credits_transaction (type,source_ref) 偏唯一 + catch 23505、credits_batch onConflictDoNothing、balance GREATEST/gte，无现行双花；属高价值回归风险非现存缺陷）。与 M-H1 同源。

### 4.3 Low

#### C-L1. 管理员可配置积分包矩阵清洗逻辑（normalizeCreditPackage/parse*）无单测
- Severity: low
- 位置：`packages/shared/src/credits/packages.ts:42-164`
- WHY/修复：normalizeCreditPackage 及 parsePositiveNumber/parsePositiveInteger（含 MAX 上限）、parsePlanNumberMap/parsePlanStringMap 把 CREDIT_PACKAGE_MATRIX 运行时设置（管理员输入）清洗为安全配置，防 1e9 积分/0 价/负数量异常。导出 normalizeCreditPackage（或抽 DB-free）补裁剪/回退分支测；或 vi.mock system-settings 测 getRuntimeCreditPackages 越界矩阵归一化。
- 建议测试：`'clamps credits/price/quantity to max and rejects non-positive'`；`'parsePlanNumberMap drops unknown plan keys and non-positive values'`。
- 复核结论：降 medium→low。happy path 已经 defaults.test.ts:257 间接执行，真正未覆盖的是防御性边界分支；逻辑正确，输入为 admin-only 而非任意用户输入。

#### C-L2. 失败结算 getFailedGenerationTargetCreditsFromMetadata 的 moderation_block 与"有 multiplier 但无 moderationOnly"分支缺测
- Severity: low
- 位置：`packages/shared/src/generation-settlement.ts:50-83`
- WHY/修复：现有测试覆盖 generation_error 读 moderationOnlyCredits、含 billingMultiplier 相乘、无成本明细回退；未覆盖 reason='moderation_block'（应返回 min(chargedCredits,moderationFailureCredits)）、仅 moderationCredits+multiplier!=1、最外层 Math.min(chargedCredits,...) 钳制。增补三用例。
- 建议测试：`'moderation_block keeps the full moderation failure charge capped by chargedCredits'`；`'applies billingMultiplier to moderationCredits when moderationOnlyCredits absent'`。
- 复核结论：维持 low。包装器唯一生产调用方 reason 硬编码 'generation_error'，moderation_block 经包装器当下不可达，下游 Math.max(0,...) 兜底；但 60-74 行那个带 multiplier:2 却被短路、实际不验证 multiplier 的"假绿灯"测试违反 CLAUDE.md，值得修复。

#### C-L3. billing multiplier 计费乘数纯函数全部无测试（直接乘进每笔扣费）
- Severity: low（high→low）
- 位置：`apps/web/src/features/image-generation/operations.ts:159-203`
- WHY/修复：normalizeBillingMultiplier（非有限/<=0 回退 1、四舍两位、夹 [0.01,100]）、getConfigBillingMultiplier、applyBillingMultiplier、applyBillingMultiplierToCreditCost 直接乘进每笔扣费却零覆盖。抽到 ./billing-multiplier.ts 纯模块或直接复用已受测的 group-billing 归一化函数（消除三处副本）。
- 建议测试：`'normalizeBillingMultiplier clamps and rounds'`（NaN→1、0→1、-5→1、'2.5'→2.5、500→100、0.001→0.01）；`'applyBillingMultiplier rounds up'`；`'getConfigBillingMultiplier returns 1 for non-pool backend'`。
- 复核结论：降 high→low。致命场景（multiplier 变 0/NaN）被两层受测兜底拦截（getEffectiveBillingMultiplierForSelectedGroup→normalizeGroupBillingMultiplier 已钳制且 group-billing.test.ts 逐一断言；roundUpCreditAmount 经 resolution.test.ts 间接验证）。残留是 operations.ts 这份副本缺独立测的"改一份漏一份"风险；更优做法是直接复用受测函数。

#### C-L4. 队列等待超时与超时错误文案（并发上限 vs 全局繁忙）无测试
- Severity: low
- 位置：`apps/web/src/features/image-generation/queue.ts:52-67, 142-160, 47-50`
- WHY/修复：排队超时后移除并 reject，错误文案据 runningByUser>=userConcurrency 区分"并发上限已达"与"全局繁忙"（前者引导升级套餐），formatDuration 转 minute/second。无测试，分支选择错误误导用户/客服。timeoutMs 可注入小值 DB-free 测。getQueuedTaskTimeoutError/formatDuration 未导出，需导出或经 error.message 断言。
- 建议测试：`'rejects queued task after timeout with concurrency-limit message when user at limit'`；`'rejects with busy message when global slots exhausted'`；`'formatDuration: 60s→"1 minute(s)", 90s→"90 second(s)"'`。
- 复核结论：降 medium→low（简单静态模板/分支，用户面分类已被 images.test.ts 部分覆盖，回归面适中）。

#### C-L5. 套餐定价纯函数（见 C-M30，复核 medium 但部分原始为 medium 已登记）

#### C-L6. 失败结算 multiplier 分支（见 C-L2）

#### C-L7. checkFileSizePrivilege 上传特权闸门零测试
- Severity: low（high→low）
- 位置：`packages/shared/src/subscription/services/user-plan.ts:214-233`
- WHY/修复：checkFileSizePrivilege 决定上传文件是否超套餐单文件上限，含边界 `<=limit`、MB 换算 toFixed(1)、getUpgradeMessage 升级文案。
- 复核结论：降 high→low。修正：经全仓搜索 checkFileSizePrivilege 零调用方——chat/edit 上传路由自行用 getPlanUploadLimits+validateImageFile 内联门控，本函数实为死代码。更准确的处理是接线到上传路由（替换重复内联）或删除（违反 CLAUDE.md 无死代码），而非仅加测试锁死死行为。若保留为公共 API 则补 DB-free 单测（等于上限→allowed:true、超一字节→allowed:false 含格式化 MB + 非空 upgradeMessage），但低优先级。

#### C-L8. upload-limits.ts 的 getPlanUploadLimits / getAllPlanUploadLimits 零测试
- Severity: low（medium→low）
- 位置：`packages/shared/src/subscription/services/upload-limits.ts:11-40`
- WHY/修复：getPlanUploadLimits 把套餐 maxFileMb/maxUploadMb 经 megabytesToBytes 转字节供 checkFileSizePrivilege 与预签名路由强制；getAllPlanUploadLimits 用 Promise.all 对 5 套餐并发取值，硬编码数组与 SUBSCRIPTION_PLANS 漂移会漏算套餐。mock getPlanLimits 断言字节换算正确，getAllPlanUploadLimits 覆盖全部 SUBSCRIPTION_PLANS。
- 建议测试：`'converts plan MB limits to bytes via megabytesToBytes'`；`'returns limits for every SUBSCRIPTION_PLANS entry'`（键集合断言捕获漂移）。
- 复核结论：降 medium→low（薄胶水，megabytesToBytes 已经 plan-capabilities.test.ts 间接演练，唯一独有逻辑是硬编码套餐数组，当前未漂移）。

#### C-L9. plan-capabilities.ts 多个导出访问器零覆盖
- Severity: low
- 位置：`packages/shared/src/subscription/services/plan-capabilities.ts:548-570, 629-641`
- WHY/修复：getPlanPrivilegesFromCapabilities（合并 PLAN_PRIVILEGES 与运行时 limits、megabytesToBytes 换算）、getPlanModerationConfig、get(Default|Max)PlanModerationBlockRiskLevel 从未被导入调用。补 3-4 个直接断言用例。
- 建议测试：`'getPlanPrivilegesFromCapabilities merges static privileges with runtime byte limits'`；`'getPlanModerationConfig returns the plan moderation row'`；`'getDefault/MaxPlanModerationBlockRiskLevel return matrix values'`。
- 复核结论：维持 low。修正：getPlanPrivilegesFromCapabilities 无任何消费者（live 特权展示用同步 getPlanPrivileges），是准备性/死代码，回归不破坏当前展示；变更时应一并决定接线或删除。

#### C-L10. getUserPlan 的 self-use 超管路径与 DB 紧耦合，超管判定仅 happy-path 覆盖
- Severity: low
- 位置：`packages/shared/src/subscription/services/user-plan.ts:135-158`
- WHY/修复：isSelfUseSuperAdmin 查 user.role 结合 isSelfUseModeEnabled 决定是否当 enterprise 自用超管（无条件授最高套餐旁路）。已覆盖 selfUse 开+super_admin→enterprise 与关→free，未覆盖 selfUse 开但 role 非 super_admin 必须不走旁路、user 表查不到记录的安全默认。
- 建议测试：`'does not grant enterprise to a non-super-admin even when self-use mode is on'`（role='admin'）；`'does not grant enterprise when the user row is missing'`（userRows=[]）。
- 复核结论：维持 low（偏低端）。修正：selfUse+user 已被现有用例覆盖，真正未覆盖仅 userRows=[]（record?.role 可选链安全默认）一例；代码用严格 === + 可选链已正确保护，无逃逸，是覆盖 nicety 非隐患。

#### C-L11. 角色/权限矩阵（见 C-H6）

#### C-L12. Better Auth 注册中间件守门链无集成测试
- Severity: low
- 位置：`packages/shared/src/auth/registration-verification-plugin.ts:78-117, 120-181`
- WHY/修复：registrationVerificationPlugin 集中公开注册安全守门（自用模式禁注册→域白名单→查重→验证码），account/session.create.before 用 assertUserCanAuthenticate 拦截 banned+'account_deleted' 复活登录。钩子顺序与短路全无测试。isPublicRegistrationPath（纯函数可直测）与 assertUserCanAuthenticate 删号判定（须先把谓词抽为不依赖 @repo/database 的纯函数）应抽测。
- 建议测试：`isPublicRegistrationPath` 对 '/sign-up/email'/'/sign-in/social'/'/callback/google' true、'/sign-in/email' false；`'throws ACCOUNT_DELETED when banned && bannedReason==account_deleted'`；`'strips verificationCode from body and forces emailVerified=true on success'`。
- 复核结论：维持 low（覆盖缺口非现存漏洞，防回归）。

#### C-L13. 防薅羊毛邮箱归一（见 C-M23，原 high 降 medium）

#### C-L14. 注册验证码暴力破解状态机（见 C-M24）

#### C-L15. /api/session/current cookie 自清（见 C-M28）

#### C-L16. 存储 URL 工具 getAvatarUrl/isExternalUrl/generateAvatarKey 纯函数零覆盖
- Severity: low（medium→low）
- 位置：`packages/shared/src/storage/utils.ts:21-79`
- WHY/修复：三纯函数被头像链路广泛使用（决定头像走外链直返还是拼 /api/storage/avatars/ 路径及上传 key 生成），DB-free 易测无测试。边界：isExternalUrl 仅认 http/https；getAvatarUrl 对 null/外链/存储键三分支；generateAvatarKey 扩展名提取与归一。
- 建议测试：`isExternalUrl` 各 scheme；`getAvatarUrl` null→undefined、外链原样、存储键→'/api/storage/avatars/<key>'；`generateAvatarKey` 'a.PNG'→.png、无扩展名→.jpg、key 以 userId 前缀开头。
- 复核结论：降 medium→low（当前无缺陷，函数极简 DB-free，影响局限单一头像特性）。注意以 shared 包版本为准（src/features/storage 陈旧副本返回 /image-proxy 路径不同）。

#### C-L17. getStorageProvider 选择 s3/local 的分支与单例缓存无测试
- Severity: low
- 位置：`packages/shared/src/storage/providers/index.ts:6-18`
- WHY/修复：getStorageProvider 据 STORAGE_ENDPOINT 选 s3/local 并用模块级 cachedProvider 单例缓存，无测试覆盖"有/无 endpoint 选不同 provider"与"缓存命中只解析一次"。mock getRuntimeSettingString 断言选择与缓存命中次数。
- 建议测试：`'uses s3 when STORAGE_ENDPOINT set'`；`'falls back to local when unset'`；`'caches provider across calls'`（getRuntimeSettingString toHaveBeenCalledTimes(1)）。
- 复核结论：维持 low（选择/缓存逻辑正确，纯测试套件完整性）。

#### C-L18. self-use 超管覆盖路径（见 C-L10）

#### C-L19. /moderate 路由密钥比对（见 S-M4，security 视角）

#### C-L20. getConfiguredModerationProviders 的 provider 选择/短路逻辑未测
- Severity: low（medium→low）
- 位置：`packages/shared/src/moderation/index.ts:205-227`
- WHY/修复：getConfiguredModerationProviders 决定启用哪些 provider（总开关关→[]、provider='none'→[]、显式选但凭据缺失→[]即全跳过放行）。"缺凭据静默不审核"高价值失败路径无测试。随 shouldBlockAliyunRisk 解耦后 mock getRuntimeSetting* 覆盖。
- 建议测试：`'returns empty when selected provider lacks credentials'`；`'auto-detects both providers when credentials present'`。
- 复核结论：降 medium→low（选择逻辑正确，失败模式真实安全相关故 medium→low 而非更低，函数小测试直接）。

#### C-L21. moderateWithProxy 的响应校验与超时中止路径未测
- Severity: low（medium→low）
- 位置：`packages/shared/src/moderation/index.ts:641-703`
- WHY/修复：moderateWithProxy 校验外部代理返回（非 2xx 抛错、JSON 须 allow/block/skipped/error 否则抛 'invalid decision'），AbortController+setTimeout 超时。代理是不可信第三方响应，失败路径（非 ok、非法 decision、超时 abort）无测试——其正确抛错是 fail-closed 生效前提。需 mock getProxyUrl/getProxyTimeoutMs/getProxySecret 使 proxyUrl 非空走到 fetch。
- 建议测试：`'throws on non-ok proxy response'`；`'rejects invalid proxy decision value'`；`'passes through valid block decision'`。
- 复核结论：降 medium→low（代码当前正确，安全关键 fail-closed 路径回归护栏缺失，无现存 Bug）。

#### C-L22. getClientIp 的 XFF 防伪造头优先级未测
- Severity: low
- 位置：`packages/shared/src/rate-limit/index.ts:274-294`
- WHY/修复：取值顺序 cf-connecting-ip/x-real-ip 优先、x-forwarded-for 最后兜底取最左字段是抗绕过关键。顺序被调整则可伪造 XFF 绕过 per-IP 限流。纯函数构造 mock headers 即可测，无断言。
- 建议测试：`'prefers trusted single-value headers over spoofable XFF'`；`'takes leftmost trimmed XFF as fallback'`（'1.1.1.1, 2.2.2.2'→'1.1.1.1'）；`'returns unknown when no headers'`。
- 复核结论：降 medium→low（缺测覆盖缺口非 live 缺陷，当前 ordering 正确，守护限流抗绕过故 low 而非 info）。

#### C-L23. withRateLimit 中间件包装器（429 短路与限流头注入）未测
- Severity: low（medium→low）
- 位置：`packages/shared/src/rate-limit/index.ts:361-384`
- WHY/修复：withRateLimit 在 result.success=false 时返回 429 不执行 handler，成功时执行并写 X-RateLimit-* 头。短路条件写反或被限流时仍调用 handler 则限流失效。可经 mock checkRateLimit + handler spy 测。
- 建议测试：`'returns 429 and skips handler when rate limited'`（status 429 且 handlerSpy 0 次）；`'runs handler and sets rate-limit headers when allowed'`。
- 复核结论：降 medium→low。修正：真正限流执行点是 proxy.ts（内联实现），withRateLimit 在活跃应用中零调用（辅助函数未接入请求强制路径），补测保护价值有限；更高价值是 proxy.ts 的限流分支（无 middleware 测试）。

#### C-L24. setSystemSettings 写入主入口（见 C-H13，high）

#### C-L25. coerceValue 类型强转与校验逻辑零单测
- Severity: low（medium→low）
- 位置：`packages/shared/src/system-settings/index.ts:187-226`
- WHY/修复：coerceValue 是 setSystemSettings 与 getProcessSettingValue/importSystemSettingsFromEnv 共用的校验/强转核心（number 非有限抛错、json 解析失败抛错、select 不在 options 抛错、boolean 字符串解析）。防止坏数据写入财务/能力配置最后一道校验门，错误强转让 PLAN_*_AMOUNT/IMAGE_BASE_CREDITS_* 被静默写 NaN 或非法 select。失败路径无直接测试。coerceValue 私有需导出或经 setSystemSettings/import 间接驱动。
- 建议测试：`'number rejects non-numeric'`；`'number coerces numeric string'`；`'json rejects malformed'`；`'select rejects value not in options'`；`'boolean parses on/yes/1 as true and others false'`。
- 复核结论：降 medium→low（校验门当前正确工作非现存数据损坏 Bug，回归无检测风险，DB-free 测试基建已就绪）。

#### C-L26. getAdminSystemSettingsSnapshot 的密钥脱敏逻辑无测试（安全相关）
- Severity: low（medium→low）
- 位置：`packages/shared/src/system-settings/index.ts:603-645`
- WHY/修复：getAdminSystemSettingsSnapshot 对 secret 定义项强制 displayValue='' 避免密钥明文回显，并计算 configured/stored/fromEnv 标志。是 getSystemSettingsAction 唯一数据源，脱敏分支回归（isSecret 判定改坏）会泄露全部支付/认证/存储密钥到管理端。零测试。
- 建议测试：`'masks secret values to empty string even when stored'`；`'non-secret stored value returned verbatim'`；`'falls back to trimmed env value when not stored and sets fromEnv=true'`；`'object stored value is JSON.stringified for display'`。
- 复核结论：降 medium→low（脱敏是简单稳定一行三元无现存 Bug；getSystemSettingsAction 受 adminAction 门控，即使回归也仅暴露给已认证 admin）。

#### C-L27. importSystemSettingsFromEnv 的 overwrite 语义与 secret 标记无测试
- Severity: low（medium→low）
- 位置：`packages/shared/src/system-settings/index.ts:241-292`
- WHY/修复：importSystemSettingsFromEnv 由 importSystemSettingsFromEnvAction（默认 overwrite:true）与 bootstrap（importMissing，不覆盖已存）调用。overwrite=false 跳过已存、overwrite=true 用 env onConflictDoUpdate 覆盖、isSecret 由定义推导。错误 overwrite 让管理员后台改过的财务/密钥配置在启动时被旧 env 盖回。defaults.test.ts 测了 initializeMissing 但未覆盖 import 的两条路径。
- 建议测试：`'overwrite=false (importMissing) keeps existing stored value'`；`'overwrite=true replaces stored value with env-derived value'`；`'flags isSecret true for secret-defined keys'`。
- 复核结论：降 medium→low（生产路径行为正确——bootstrap no-overwrite、admin action 故意 overwrite=true，回归风险非 live 缺陷）。注意现 dbMock 需增强 insert/onConflictDoUpdate 才能断言 overwrite=true 替换。

#### C-L28. Sub2API 迁移的非典型分支无测试
- Severity: low
- 位置：`packages/shared/src/system-settings/index.ts:421-524`
- WHY/修复：migrateLegacySub2ApiAutoSyncSettings 含异常/边界分支（allowMobileRtImport=false 时强制 syncMode='responses'、parseSyncMode/parseSub2ApiPlanFilter 非法回退默认、parsePositiveInteger 非正回退 720）。defaults.test.ts 仅覆盖 happy path。迁移分支错误会把历史任务迁成错误同步模式或丢配置。
- 建议测试：`'migration forces syncMode=responses when allowMobileRt is false even if legacy mode=both'`；`'invalid legacy interval falls back to 720'`；`'invalid plan filter falls back to non_free'`。
- 复核结论：维持 low（迁移逻辑正确，仅影响仍有 legacy SUB2API_AUTO_SYNC_* 且无现有 tasks 行的部署，admin-only 运维特性）。

#### C-L29. 运行时取值器 boolean/select/string/json 的 stored↔env 回退路径无测试
- Severity: low（medium→low）
- 位置：`packages/shared/src/system-settings/index.ts:88-170`
- WHY/修复：getRuntimeSettingBoolean/Select/String/Json 是运行时读取配置（缺失回退 process.env）的核心，被全站消费（CONTENT_MODERATION_FAIL_CLOSED、SELF_USE_MODE_ENABLED、PAYMENT_PROVIDER、PLAN_CAPABILITY_MATRIX）。都有"先 stored 否则 env 否则 fallback"分支与解析逻辑。defaults.test.ts 只测了 getRuntimeSettingNumber 边界，其余四个 getter 的优先级与解析分支全无测试。
- 建议测试：`'getRuntimeSettingBoolean reads stored boolean, then parses env truthy strings, else fallback'`；`'getRuntimeSettingSelect returns fallback when value not in allowed list'`；`'getRuntimeSettingString prefers stored over env and trims'`；`'getRuntimeSettingJson parses stored string JSON, returns object directly when already object'`。
- 复核结论：降 medium→low（getter 实现正确，安全开关默认 fallback 偏安全，是预防性回归网而非现行判错）。

#### C-L30. syncSystemSettingsToEnvFiles 序列化与托管块替换无测试，仅测了谓词
- Severity: low（medium→low）
- 位置：`packages/shared/src/system-settings/env-file.ts:23-90`
- WHY/修复：env-file.test.ts 只覆盖 shouldSyncSettingToEnvFile 谓词；serializeEnvLine/quoteEnvValue、按 key 过滤+排序、String.replace 整块替换全无测试。两隐患：值含 '$&'/'$1' 时托管块错误展开（见 S-M9/M-M25）；首次写入 vs 已存托管块两分支产物未验证。写部署机 .env(0600)。抽可注入 fs 的纯函数测，对 $ 特殊字符做回归测试。
- 建议测试：`'serializes string/number/object values with JSON.stringify quoting'`；`'only includes synced keys, sorted, wrapped in BEGIN/END markers'`；`'replaces existing managed block in place preserving surrounding lines'`；`'appends managed block when none exists'`；`'does not corrupt output when a value contains $& or $1'`。
- 复核结论：降 medium→low（损坏只在已存托管块 + 值含特殊序列双条件下触发，所有定义值现状无此子串，且 try/catch best-effort + DB 为真相兜底）。

#### C-L31. getCreditPackagePriceForPlan / moneyToCents 等支付纯函数（见 C-M30/C-M31，复核 medium）

#### C-L32. expireStalePendingGenerations 的退款金额与退款幂等逻辑（财务敏感）未被单测
- Severity: medium → 复核维持 medium（本报告归 §4.2 索引；摘要计入 medium）
- 位置：`packages/shared/src/generation-maintenance.ts:208-339`（退款金额 245-252；refundGenerationCredits 幂等 159-206）
- WHY/修复：expireStalePendingGenerations 把超时 20 分钟 pending 置 failed 并退积分。退款金额 `max(0, chargedCredits-targetCredits)` 与幂等键 sourceRef=`<id>:timeout-refund` 决定退多少/是否重复退；refundGenerationCredits 用 refundAlreadyGranted 去重。generation-maintenance.test.ts 只覆盖两纯 helper。退款属发放路径算错/重放即经济损失；条件 UPDATE WHERE status='pending' 并发护栏无测试。抽 computeTimeoutRefund({chargedCredits,targetCredits}) 纯函数测；refundGenerationCredits 幂等/amount<=0 短路用可注入/DB 标记测。
- 建议测试：`'target=0 -> creditsToRefund=charged'`；`'charged=10,target=4 -> 6'`；`'charged=4,target=10 -> 0(不负)'`；`'sourceRef===<genId>:timeout-refund'`；`'amount<=0 returns refunded:false and skips grantCredits'`；`'existing refund batch returns refunded:false, grantCredits 0 calls'`。
- 复核结论：降 high→medium（运行时逻辑正确——Math.max(0) 防负、credits_batch (source_type,source_ref) + 偏唯一索引幂等、条件 UPDATE 并发护栏、双账兜底，是覆盖/可测性缺口非现存缺陷）。

#### C-L33. Sub2API 同步调度门 shouldRunSub2ApiTask / 区间归一化 / force 解析未导出且零覆盖
- Severity: medium → 复核维持 medium（归 §4.2 索引）
- 位置：`apps/web/src/features/image-backend-pool/service.ts:4649-4669`（另 sub2api/sync/route.ts:33-35 force 解析）
- WHY/修复：shouldRunSub2ApiTask(task,force) 决定本次 cron 是否执行（force 直跑、lastRunAt 不可解析跑、否则按 normalizeSub2ApiSyncIntervalMinutes*60000+lastRunAt 比较 Date.now()）。纯函数且是 cron 频率/幂等核心判定，未导出零测试。route 的 force query 解析同样无测。导出三者（或抽纯模块）单测。
- 建议测试：`shouldRunSub2ApiTask`（force=true→run、lastRunAt='garbage'→run、2h 前 interval=60→run、now interval=60→false）；`normalizeSub2ApiSyncIntervalMinutes`（<=0/NaN→720、2.9→2、0.5→1）；`parseForceFlag`（'1/true/yes'→true、'0/缺省'→false）。
- 复核结论：维持 medium（决定上游 token 同步是否跳过/过度执行的唯一门，无冗余保障，回归静默）。

#### C-L34. destroyExpiredGenerationPhotos 的 retentionHours<=0 禁用分支与失败计数无测试
- Severity: medium → 复核维持 medium（归 §4.2 索引）
- 位置：`packages/shared/src/generation-maintenance.ts:341-458`（禁用短路 353-367；删除失败 failed++ 438-446）
- WHY/修复：GENERATION_IMAGE_RETENTION_HOURS<=0（默认 0=永久保留）时短路返回 {enabled:false}；该分支回归会误删全站已完成图片（影响极大）。删除失败 failed++ 跳过、条件 UPDATE WHERE status='completed' AND storageKey NOT NULL 并发护栏。零测试。抽 resolvePhotoRetentionWindow(retentionHours,now)→{enabled,cutoff} 纯函数测；删除/写库用 DB 标记集成测试。
- 建议测试：`'hours<=0 -> {enabled:false, cutoff:null}'`；`'hours=24 -> cutoff===now-24h(ISO)'`；`'retention=0 时返回 enabled:false 且不删'`；`'deleteObject 抛错时 failed===1 且该行 storageKey 未被置 null'`。
- 复核结论：维持 medium（上端，禁用短路是阻止全站图片对象批量删除的唯一防线，破坏性不可逆潜力，但当前正确实现且回归可能性低故不上调 high）。

#### C-L35. 唯一的 cron 测试是孤儿（见 M-M28，复核 medium）

#### C-L36. 积分过期 cron 编排函数 runCreditsExpireJob 的响应/聚合逻辑零覆盖
- Severity: low（high→low）
- 位置：`apps/web/src/server/scheduled-jobs.ts:32-45`
- WHY/修复：runCreditsExpireJob 调 processExpiredBatches() 并 map 成对外响应 {success,processed,details:[{batchId,userId,expiredAmount}],timestamp}（财务 cron 对外契约）。真实套件无测试（孤儿文件只测底层 processExpiredBatches 自搓响应）。把 results→响应的纯映射抽 buildCreditsExpireResponse(results)（不 import @repo/database）测。
- 建议测试：`'2 results → processed===2, details 长度 2, 仅含三字段, success===true, ISO timestamp'`；`'[] → processed===0, details===[]'`。
- 复核结论：降 high→low。修正：transitive DB 依赖经 @repo/shared/credits/core 非直接；未覆盖代码是平凡纯投影（无分支/算术），财务计算在 processExpiredBatches 已测，是低风险覆盖/可测性缺口。

#### C-L37. runImageMaintenanceJob / runWebAccountsRefreshJob / runSub2ApiSyncJob 的聚合与响应包装零覆盖
- Severity: low（medium→low）
- 位置：`apps/web/src/server/scheduled-jobs.ts:13-30, 47-68, 70-76`
- WHY/修复：三 cron 编排各做响应聚合（runImageMaintenanceJob reduce 求和 creditsRefunded、expired=length；runWebAccountsRefreshJob 读两 runtime setting 透传；runSub2ApiSyncJob 透传补 timestamp）。creditsRefunded 求和回归会让对账失真。把"结果数组→响应对象"纯聚合抽纯函数测。
- 建议测试：`'[{creditsRefunded:6},{creditsRefunded:0}] -> creditsRefunded===6、expired===2'`；`'零行 -> expired:0, details:[]'`；`'photoRetention 对象原样透传'`。
- 复核结论：降 medium→low（唯一聚合是平凡 reduce/.length，真正退款正确性/幂等/未发放记 0 防护已在 generation-maintenance.ts:330-335 解耦并 DB-free 测，编排器仅透传）。

#### C-L38. 三个 cron 路由缺 try/catch，失败路径与 credits/expire 不一致且无测试固化
- Severity: low
- 位置：`apps/web/src/app/api/jobs/images/expire-pending/route.ts:35-44`（同 image-backend/sub2api/sync/route.ts:26-42、web-accounts/refresh/route.ts:26-33）
- WHY/修复：withApiLogging 在 handler 抛错时记录后 re-throw。credits/expire 有显式 try/catch 返结构化 500，其余三个无，底层 job 抛错原样向上（Next 渲染裸 500、无结构化 body），四个 cron 端点失败契约不一致且无测试固化。抽公共 withCronAuth(handler) 包装集中鉴权 + 失败响应。
- 建议测试：`'bad/absent token 返回 401 且 job mock 未调用'`；`'job reject 时响应 500 且 body.success===false、body.message 含 boom'`。
- 复核结论：维持 low（auth-gated 内部端点，uncaught throw 仍 logError + 非 2xx，监控/重试按 status 仍工作，仅缺结构化 body，无正确性/安全影响）。

#### C-L39. 瀑布流预扣费守卫与里程碑阈值逻辑零覆盖且不可单测（内联在巨型组件里）
- Severity: high → 复核维持 high（归 §4.1 high 索引）
- 位置：`apps/web/src/features/image-generation/components/create-page-client.tsx:5411-5453, 5417-5438, 9220-9229`
- WHY/修复：瀑布流批量生成核心财务/并发控制全部内联组件闭包零测试：(1) 余额预检 requiredCredits=creditsPerRequest*loadSize+pendingCredits 与 balance<requiredCredits return（前端唯一阻止余额不足狂点续批的门闩）；(2) loadSize=Math.min(requestCount,Math.max(available,0))，available=waterfallMaxConcurrent-batchActiveRequestsRef.current（并发钳制）；(3) 里程碑阈值 [tier*10,tier*100,tier*1000] 跨越检测。sessionCountRef 在弹窗触发并 return 时提前自增（含本批尚未真正生成的图），真正生成由 onClose 的 triggerBatchGeneration 异步恢复，计数与实际生成数的提前自增/恢复时序易引入重复计数或漏弹下一里程碑。写死在 9000+ 行组件依赖多个 useRef/useState 闭包无法 import。抽 waterfall-batch-planner.ts 导出 planWaterfallLoad/hasEnoughCredits/detectCrossedMilestone 纯函数。
- 建议测试：`'planWaterfallLoad active>=maxConcurrent 返回 0、requestCount 超剩余取剩余'`；`'hasEnoughCredits balance==required 返回 true、少 0.01 false、customApiActive=true 恒 true'`；`'detectCrossedMilestone prevCount=9/add=2/tier=1 命中 10、已 shown 返回 null、单次 add 跨越多阈值只返回最小未展示阈值'`。
- 复核结论：维持 high（用户侧 fan-out 最快的扣费/并发/里程碑路径，已实证恢复路径重复自增脆弱时序，回归即超扣或漏弹，财务爆炸半径与 coverage lens 一致）。预检守卫逻辑本身书写正确（5449 起）。

> 备注：§4 还有多条 frontend-components 纯函数覆盖缺口（sanitizeChatMessages、reference-handoff、compactChatConversations、inferImageSizeDialogState、mention-utils、waterfall-warning-popup、roundUpCreditAmount/parseImageSize 等）经复核为 low/medium，因其内联在巨型组件无法 DB-free import 兼属可测试性缺陷，统一建议随 M-H7 拆分把纯函数迁出独立模块后补单测。

### 4.4（frontend-components 覆盖缺口补充，按 severity）

- 【medium】localStorage 不可信数据净化 sanitizeChatMessages/sanitizePersistedChatMessages 零覆盖：`create-page-client.tsx:1280-1448`。抽到 chat-persistence.ts 导出后补 drop invalid role / coerce missing defaults / reject webConversation missing conversationId / 非数组输入返 [] 等用例。复核降 medium 低端（是已存在的防御性 guard 非缺失，malformed localStorage 仍经服务端校验，refactor-regression 风险）。
- 【medium】引用图 URL 归一化与过期校验 reference-handoff 模块零覆盖：`reference-handoff.ts:28-94`。新建 reference-handoff.test.ts stub sessionStorage/window.location 覆盖 normalizeHandoff 过期/缺字段/非法 mode、consume id 不匹配返 null 不删 / 读后即删、normalizeReferenceFetchUrl 各 scheme。复核维持 medium 但下调 SSRF 叙事（客户端 fetch，非跨租户攻击者可控），核心是过期/防重放/scheme 放行不变量零覆盖。
- 【medium】会话去重压缩与上限裁剪 compactChatConversations/isConversationSnapshotOf 零覆盖：`create-page-client.tsx:1542-1578, 1610-1615`。抽到 chat-persistence.ts 测去重/排序/裁剪到 CHAT_CONVERSATION_LIMIT。复核维持 medium（仅本地 localStorage 缓存，可恢复非破坏性，三处共用同一未测逻辑 + 空 catch 隐藏 quota 失败）。
- 【low】图像尺寸对话框推断 inferImageSizeDialogState/getNearestSupportedSizeForRatio/parseAspectRatioInput 零覆盖：`create-page-client.tsx:354-419`。抽到 image-size-dialog-state.ts 测 auto/ratio/custom gcd 回退、parseAspectRatioInput 拒 0:0/负/>3 位。复核降 medium→low（每尺寸经已测的 normalizeValidImageSize 钳制 + validateImageSize 门控 canConfirm，计费由最终 clamped 尺寸算，缺陷致 UI 默认/预览错非财务）。
- 【low】积分金额取整与尺寸归一化 roundUpCreditAmount/normalizeValidImageSize/parseImageSize 无直接测试：`resolution.ts:82-87, 170-182, 328-331`。在 resolution.test.ts 增补浮点边界与非法输入。复核降 medium→low（roundUpCreditAmount 经定价断言间接执行，裸奔的是 epsilon 边界/parseImageSize 拒绝/钳制取步，预防性补测；applyBillingMultiplier 实在 operations.ts:180-182 非 create-page-client）。
- 【low】@提及触发与插入 getMentionTrigger/insertMentionToken/filterMentionOptions 零覆盖：`create-page-client.tsx:1181-1213, 1221-1223`。抽 mention-utils.ts 测触发边界与插入切片（off-by-one 高发区）。复核维持 low（无副作用纯函数，低成本预防）。
- 【low】瀑布流首次警告持久化 hasSeen/markWaterfallFirstTimeWarningSeen 零覆盖：`waterfall-warning-popup.tsx:42-79`。注入/删除 window.localStorage stub 测三态 + SSR 返 true。复核维持 low（信息提示非硬门闩，财务安全由服务端 consumeCredits 幂等保证，误改最坏只是体验问题）。

### 4.5（auth-authz 覆盖缺口补充，复核结论）

- 【low】/api/session/current 注册中间件守门链（见 C-L12）。
- 【low】adminAdjustCredits / createUserAction / 角色提权分支已分别登记于 C-M25/C-M26/C-M27。

---

## 5. 优先级建议（最先处理的前 10 项）

按"可利用性 × 影响 × 修复杠杆"排序。

1. **S-C1 系统设置写入授权提权（critical）** —— 单一动作即可 admin→super_admin 提权 + 完整账号接管 + 服务端 SSRF + 第三方密钥写入。唯一 critical，必须最先修：把三个写入 action 改 superAdminAction 并收紧 settings/page.tsx 网关。一次性消除最大攻击面，且修复杠杆高（改授权门闩 + 细粒度授权）。

2. **S-H4 / S-H7 管理员封禁对第一方会话不生效（high，authz-bypass）** —— ban 在整个 Web 通道形同摆设，被封用户生成/扣费/工单/设置全可用。修复杠杆集中：抽 assertUserNotBanned 三处统一调用 + banUserAction 撤销会话。是当前"看似生效实则无效"的高欺骗性安全缺口。

3. **S-H5 普通 admin 可封 super_admin 并自助铸 10 万积分（high）** —— 直接财务损失向量 + 锁死顶层控制，零目标权限护栏。修复杠杆高：banUserAction/adminGrantCreditsAction 加目标角色守卫并禁自授信/上提超管。与 S-C1、M-H5 同属"权限模型不对称"根因。

4. **S-H1 / S-H2 聊天历史 SSRF 与跨用户 IDOR 读对象（high）** —— 可外泄云 IAM 凭证、探测内网、读他人私有对象，任意 Pro+ 用户/外部 key 可触发。修复明确：downloadWebHistoryImageReference 改 fetchPublicImage + storage 分支强制属主校验。同文件两高危一并修。

5. **S-H3 异步 callback_url SSRF（high，含 S-M2/S-L5）** —— 已认证 key 持有者获得对内网/元数据发任意-body POST 的原语，30 分钟 TOCTOU。修复杠杆高：postAsyncImageCallback 改 redirect:manual + 逐跳 assertPublicImageUrl + 强制 https，一并覆盖重定向与 DNS 重绑定残留。

6. **S-H6 注册验证码无冷却可无限轰炸 + S-M? middleware /api/auth/* 早 return 旁路 auth 限流（high）** —— 未认证可脚本化邮件轰炸 + 成本放大，且暴露登录/重置/验证码端点缺分布式限流的结构性缺陷。修复：sendRegistrationVerificationCode 加每邮箱冷却/日上限 + 修复 middleware 使 /api/auth/registration-verification 真正过限流（或 betterAuth rateLimit 接 Upstash）。

7. **C-H1 + M-H1 + C-M37 财务编排与积分账本核心零活跃测试（high）** —— runImageGenerationForUser 整条扣费/结算/退款编排与 core.ts FIFO/幂等/作废无任何 CI 回归网，覆盖平台最敏感财务代码，CLAUDE.md 明确要求。修复杠杆：抽 createGenerationSettlement(deps) 与 core 纯逻辑模块补 DB-free 单测 + DB 集成测试，并删 root 死测试。任何计费重构前应先建此网。

8. **C-H9 / C-H10 / C-H11 / C-H12 + C-M30~C-M34 支付鉴权与金额计算零覆盖（high）** —— Epay 签名验证、金额防篡改 isExpectedEpayAmount、升级补差、Creem 年付判定与发放、moneyToCents/metadata codec 全部无回归锚点，直接关联真金白银。修复杠杆：先抽 epay-core.ts（解 @repo/database 耦合，C-M33 根因），再批量补签名/金额/round-trip 单测。

9. **M-H2 / M-H7 / M-H3 超级模块/上帝组件拆分（high，可维护性瓶颈）** —— service.ts(5310 行)、create-page-client.tsx(9233 行)、admin-panel.tsx(4350 行)是后续所有维护与测试的最大阻碍，且拆分（抽纯函数到 DB-free 模块）是解锁 C-H2/C-M8/C-M13/C-L39 等大量 coverage 缺口的前置。建议作为持续重构主线分批推进，每抽一块即提交并跑 typecheck/test。

10. **M-H6 StorageProvider local/s3 语义不一致 + S-M3 URL 取图无流式上限（high/medium，已知功能 Bug + DoS）** —— M-H6 在默认 local 配置下头像上传必坏 405（具体功能 Bug）；S-M3 单请求可逼近 OOM（responses.ts 最严重）。两者均为明确可执行的修复（接口区分能力 / 流式读取带 maxBytes 主动 abort，封装入 safe-image-fetch.ts 供所有处理器复用）。

补充说明：C-H6（roles.ts 权限矩阵纯函数零测）、C-H15（checkRateLimit fail-open 路由）、C-H4/C-H5（safe-image-fetch 与 auth 鉴权零测）、C-H13/C-H14（setSystemSettings 与 moderateContent 零测）虽未进前 10，但均为 DB-free、低成本、安全关键、CLAUDE.md 硬约束要求的回归网缺口，建议紧随前 10 项之后批量补齐（多数可在拆分纯函数后一并完成）。

---

## 附录：复核降级/升级一览（与原始 severity 不同者）

| 编号 | 标题摘要 | 原始 | 复核后 |
| --- | --- | --- | --- |
| S-H5 | 普通 admin 封 super_admin + 自助铸币 | medium | high |
| S-M6 | moderateContent TOCTOU fail-open | medium | low |
| S-M8 | admin 经系统设置改计费/审核参数 | high | medium |
| S-M10 | 存储路由缺 nosniff | medium | low |
| S-L2 | Creem 发放失败吞异常 | info | low |
| S-L6 | key.includes(userId) 弱校验 | medium | low |
| M-M12 | SSRF 防护 4 副本 | high | medium |
| M-M13 | 图片引用解析重复 | high | medium |
| M-M19 | responses 续承内存缓存双轨 | medium | low |
| M-M20 | inFlightFulfillments 内存去重 | medium | low |
| M-M21 | AdminUsersManagement try/catch 模板 | high | medium |
| M-M24 | SettingKey 17 孤儿 key | high | medium |
| M-M28 | cron-expire 孤儿测试假绿灯 | high | medium |
| M-L20 | operations.ts 内联图像尺寸解析 | medium | low |
| C-M2~C-M14 | 后端池/编排多条 coverage | high | medium |
| C-M17~C-M28 | 存储/auth-authz 多条 coverage | high | medium |
| C-M30~C-M34 | 支付纯函数 coverage | high | medium |
| C-L3 | billing multiplier 纯函数 | high | low |
| C-L7 | checkFileSizePrivilege（死代码） | high | low |
| C-L36 | runCreditsExpireJob 响应聚合 | high | low |
| C-H17 | checkMemoryRateLimit | high | medium |

> 注：摘要表 §1 的 severity 统计已采用复核后的最终 severity。
