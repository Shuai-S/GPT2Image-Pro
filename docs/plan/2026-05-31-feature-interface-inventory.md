# 全功能接口盘点表

- 文档日期：2026-05-31
- 用途：统一接口层（UOL / Operation Registry）的功能基线。逐操作列出当前形态、符号位置、权限、只读、副作用、幂等，作为接口化与权限矩阵的事实源。
- 主设计：`docs/plan/2026-05-31-agent-integration-architecture.md`

说明：
- 当前形态：`service-fn`（纯服务函数）/ `server-action`（next-safe-action）/ `api-route`（HTTP）/ `mixed`（service + 传输双形态）。
- 只读：标"语义只读"者可能含维护性写副作用（过期处理/惰性提权等），接口化时按业务语义判定。
- 副作用缩写：DB=数据库读写，扣费/退款=credits，存储=对象存储，外呼=外部 API，邮件=Resend，审计=adminAuditLog，缓存=进程内缓存。

---

## 1. image-generation（图像生成）

| 操作 | 形态 | 符号 | 权限 | 只读 | 副作用 | 幂等 |
|---|---|---|---|---|---|---|
| runImageGenerationForUser（统一管线核心） | service-fn | operations.ts:865 | protected（userId 必填，内部按 plan 能力矩阵校验） | 否 | DB写/扣费/退款/外呼/存储/审核/队列 | 扣费退款层幂等(sourceRef 派生自 generationId)；整体非幂等 |
| generateImage（文生图 POST /api/images/generate） | mixed | route.ts:75 | protected；count>1 需 batch | 否 | 同管线 + API 日志 | 可传 generationId 复用底层；HTTP 层无去重 |
| editImage（图生图 POST /api/images/edit） | mixed | route.ts:367 | protected；edit；count>1 需 batch；上传限额 | 否 | 临时源图上传/删除 + 同管线 | 可传 generationId(s)；临时文件 batchId 隔离 |
| generateChatImage（对话/Agent/瀑布流 POST /api/images/chat） | mixed | route.ts:1271 | protected；agent/waterfall/chat 各自能力 | 否 | 临时参考图/附件/按轮扣费/外呼/审核 | 可传 generationId；按轮幂等；history 携带粘性状态 |
| selectChatGptWebImageCandidate（Web 候选图选定） | api-route | web-select/route.ts:1725 | protected + 归属 + web 账号 | 否 | 外呼 ChatGPT Web + DB写 metadata | 幂等(无扣费)，但每次外呼 Web |
| getGenerationStatus（状态查询 GET /api/images/status/[id]） | api-route | route.ts:1947 | protected + 归属 | 是 | 无（纯读） | 幂等只读 |
| generateImageAction（Server Action 文生图） | server-action | actions.ts:32 | protected（精简 schema，仅单图） | 否 | 同管线 | 不传 generationId 每次新建；底层扣费幂等 |
| deleteGenerationAction（删除记录及孤立图） | server-action | actions.ts:46 | protected + 归属 | 否 | DB删 + 存储删（best-effort，无扣费） | 近似幂等 |
| runBatchImageGeneration（批量并发执行器） | service-fn | batch-runner.ts:24 | 无自有权限（由传入 run 决定） | 否 | 仅内存调度 | 取决于 run |
| withImageGenerationQueue（并发队列） | service-fn | queue.ts:140 | 无（纯调度） | 否 | 进程内可变全局态 | 不适用（单进程内存态） |
| createImageStreamResponse（SSE 封装） | service-fn | streaming.ts:106 | 无（传输层） | 否 | ReadableStream + keep-alive | 不适用 |
| getUserGenerations / Count / Recent / ById / Stats（历史/画廊/统计） | service-fn | queries.ts | 查询级无强制鉴权（按 userId 过滤；Stats 全局应仅管理员） | 语义只读 | 多数先调 expireStalePendingGenerations（DB写） | 查询幂等；过期处理幂等收敛 |
| getUserApiConfig / getEffectiveConfig（后端路由解析） | service-fn | service.ts:3346/3391 | getUserApiConfig 内部校验 customApi.configure + SSRF | 语义只读 | select + SSRF DNS + 池选号 | 解析幂等（池选号非确定） |
| runEditableFileForUser（可编辑文件 PPT/PSD 编排） | service-fn | editable-file-operations.ts:89 | protected（userId 必填；只调付费级 web 账号 accountPlanFilter=paid） | 否 | 租号/外呼 ChatGPT Web 代码解释器/存储/扣费 | 扣费层幂等(sourceRef=editable-file:{taskId})；整体非幂等 |
| file.generatePpt / file.generatePsd（UOL 操作） | uol-operation | uol/operations/editable-file.ts | protected + 能力位 export.ppt/export.psd | 否 | 同 runEditableFileForUser | 必需幂等键 clientRequestId(per-user) |
| postExternalPptGenerations / PsdGenerations（POST /v1/ppts、/v1/psds） | api-route | editable-file-generations.ts | api-key + 能力位 export.ppt/export.psd；PSD 强校验非空图；支持 async + callback_url | 否 | 同 runEditableFileForUser + keep-alive/异步内存任务 | 非幂等；底层 sourceRef 幂等 |
| getExternalEditableFileTask（GET /v1/editable-file-tasks/{task_id}） | api-route | editable-file-tasks.ts | api-key + 归属校验（userId+apiKeyId）；仅 editable_file_task | 是 | 无（读进程内内存任务） | 幂等只读；30min TTL、无 DB 持久回退 |
| POST /api/editable-file/generate（站内 chat(web) 用） | api-route | editable-file/generate/route.ts | session + 能力位 export.ppt/export.psd | 否 | 同上，session 鉴权 | 同上（服务端自生 taskId） |

接口化要点：`runImageGenerationForUser` 已是干净 domain service（5 个 v1 handler + 3 个 web 路由汇入），包一层即可统一暴露。HTTP/multipart 解析、文件读取、history 裁剪、临时图上传等"请求适配层"写死在 route.ts，需抽成与传输无关的输入构建器（File/Buffer 入参）。callbacks 是干净抽象，SSE 封装可替换。队列为进程内单例（多实例不准）。计费/审核/退款事务密集但已内聚在 operations.ts，必须整体保留在内核。web-select 强耦合 ChatGPT Web，宜作 chat 域子操作单列。

---

## 2. credits-billing（积分计费）

| 操作 | 形态 | 符号 | 权限 | 只读 | 副作用 | 幂等 |
|---|---|---|---|---|---|---|
| ensureCreditsBalance | service-fn | core.ts:199 | 无内置（调用方负责） | 否 | 账户不存在则 INSERT | 幂等（select 命中即返回） |
| getCreditsBalance | service-fn | core.ts:232 | 无内置 | 语义只读 | 先 processExpiredBatches（写）+ ensure | 读幂等；过期处理条件更新幂等 |
| getMyCreditsBalance | server-action | actions.ts:149 | protected | 语义只读 | ensureRegistrationBonus（可能发放）+ getBalance | 注册奖励 sourceRef 唯一索引保证只发一次 |
| grantRegistrationBonus | server-action | actions.ts:96 | protected | 否 | 写 batch + transaction + 余额 | 双重保障：交易短路 + onConflictDoNothing |
| ensureRegistrationBonus (lazy) | service-fn | core.ts:248 | 无内置 | 否 | 首次发放 / 修 expiresAt | 交易短路 + sourceRef 唯一索引 |
| ensureRegistrationBonusExpiry | service-fn | core.ts:294 | 无内置 | 否 | UPDATE batch expiresAt；触发全局过期 | 条件更新幂等 |
| grantCredits | service-fn | core.ts:337 | 无内置（webhook/admin/refund 调用方鉴权） | 否 | 事务内 batch+transaction+余额；冻结抛错 | 强幂等：onConflict(source_type,source_ref)；无 sourceRef 不幂等 |
| consumeCredits | service-fn | core.ts:475 | 无内置 | 否 | 过期处理 + FIFO 扣减 + 记账 + 余额 | 传 sourceRef 强幂等（per-user 偏唯一索引）；否则不幂等 |
| useCredits (consume action) | server-action | actions.ts:235 | protected | 否 | consumeCredits（无 sourceRef）+ logEvent | **不幂等**（未传 sourceRef） |
| checkCreditsAvailable | server-action | actions.ts:293 | protected | 语义只读 | getCreditsBalance（含过期处理） | 幂等 |
| getMyActiveBatches | server-action | actions.ts:174 | protected | 是 | 无 | 幂等只读 |
| getUserActiveBatches | service-fn | core.ts:957 | 无内置 | 是 | 无 | 幂等只读 |
| getMyTransactions | server-action | actions.ts:193 | protected | 是 | 无 | 幂等只读 |
| getUserTransactions / Count | service-fn | core.ts:982/1003 | 无内置 | 是 | 无 | 幂等只读 |
| voidActiveSubscriptionCreditsForUpgrade | service-fn | core.ts:716 | 无内置（支付 webhook 调用） | 否 | 作废订阅批次 + expiration 交易 + 扣余额 | 条件更新（status=active）幂等 |
| processExpiredBatches | service-fn | core.ts:857 | 无内置（cron/getBalance/consume 调用） | 否 | 逐批次置 expired + 交易 + 扣余额 + logEvent | 条件更新保证每批只处理一次 |
| runCreditsExpireJob (cron HTTP) | api-route | expire/route.ts:57 | cron-secret（Bearer，timingSafeEqual）；GET 健康检查无鉴权 | 否 | 全量过期处理 | 依赖 processExpiredBatches 幂等 |
| freezeCreditsAccount | service-fn | core.ts:1019 | 无内置（admin 调用） | 否 | UPDATE status='frozen' | 幂等 |
| unfreezeCreditsAccount | service-fn | core.ts:1032 | 无内置 | 否 | UPDATE status='active' | 幂等 |
| setUserCreditsStatus (admin) | server-action | admin-users.ts:1041 | admin | 否 | freeze/unfreeze + 审计 + revalidate | 底层幂等；审计每次追加 |
| adminGrantCredits (manual top-up) | server-action | admin-users.ts:775 | admin（禁自发 + assertCanActOnTarget） | 否 | grantCredits(admin_grant) + 审计 + revalidate | **不幂等**（未传 sourceRef，重复点击重复发放） |
| adminAdjustCredits (set/deduct) | server-action | admin-users.ts:829 | superAdmin | 否 | set 算差额 grant/consume；deduct consume + 审计 | **不幂等**（读后写 TOCTOU 竞态） |
| refundGenerationCredits | service-fn | generation-maintenance.ts:209 | 无内置（管线失败结算调用） | 否 | grantCredits(refund, SYSTEM:generation_refund) | 双重保障：短路 + (refund,source_ref) 唯一索引 |
| createCreditsPurchaseCheckout | server-action | actions.ts:327 | protected（按套餐校验） | 否 | Epay 落单 / Creem 外呼 + logEvent（不直接发积分） | 非幂等（每次建新 checkout）；发积分在 webhook 幂等 |
| grantCredits on purchase (Creem webhook) | api-route | creem/route.ts:466 | external（签名校验） | 否 | grantCredits(purchase, PAYMENT:{orderId}) | credits_batch(purchase,source_ref) 唯一索引 |
| grantCredits on subscription period (Creem webhook) | api-route | creem/route.ts:828 | external（签名校验） | 否 | grantCredits(subscription, monthly_grant) | sourceRef=periodKey 唯一索引 |
| Epay purchase/subscription fulfillment | service-fn | epay-fulfillment.ts:221/437/396/472 | external（验签后调用） | 否 | grant + 升级作废旧积分 | source_ref 唯一索引 + 短路 |
| consumeCredits in image pipeline（生产扣费） | service-fn | operations.ts:1420 | service-fn（handler 已鉴权） | 否 | FIFO 扣减 + finally 回滚兜底 | 传 sourceRef 强幂等（**真正生产扣费入口**） |

接口化要点：grant/consume/void/processExpired/查询族/freeze 等已是干净 service-fn，可直接作底层。actions 与 admin-users 需把 userId 显式化、鉴权/审计/revalidate 剥离为装饰层。**幂等缺口**：useCredits / adminGrantCredits / adminAdjustCredits 未传或用时间戳 sourceRef，统一接口须强制幂等键。事务边界自带，不可嵌套外层事务。财务真相在 credits_transaction（双重记账），扣费幂等键 (user_id,type,source_ref)（迁移0029），发放/退款幂等键 credits_batch(source_type,source_ref)（迁移0025）。FIFO 优先级 bonus>subscription>purchase。admin-users 在 shared 与 apps/web 双副本（shared 为权威）。

---

## 3. subscription-payment（套餐/能力矩阵/Creem/epay/升级/webhook）

| 操作 | 形态 | 符号 | 权限 | 只读 | 副作用 | 幂等 |
|---|---|---|---|---|---|---|
| createCheckoutSession（含升级补差） | server-action | actions.ts:30 | protected | 否 | epay 落单 / creem 外呼 + logEvent（不发积分） | 非幂等（outTradeNo/request_id 含时间戳） |
| createSubscriptionCheckoutQuote（升级补差报价） | service-fn | subscription-upgrade.ts:124 | 无内置 | 是 | 读 creditsBatch + 运行时配置 | 幂等（纯计算） |
| cancelSubscription | server-action | actions.ts:176 | protected | 否 | creem 外呼 + update cancelAtPeriodEnd；epay 抛错 | 弱幂等（重复外呼，结果一致） |
| createCustomerPortal（占位） | server-action | actions.ts:143 | protected | 是 | 查 subscription | 幂等 |
| getUserSubscription | server-action | actions.ts:221 | protected | 是 | select limit 1（无 orderBy，多行取序未定义） | 幂等 |
| hasActiveSubscription | server-action | actions.ts:258 | protected | 是 | select limit 1 | 幂等 |
| getMyPlanAction（套餐+能力快照） | server-action | get-user-plan.ts:14 | protected | 是 | getUserPlan + getPlanCapabilitySnapshot | 幂等 |
| getUserPlan（核心解析） | service-fn | user-plan.ts:69 | 无内置（含 super_admin 旁路→enterprise） | 是 | select subscription(orderBy updatedAt) + user | 幂等 |
| checkFileSizePrivilege | service-fn | user-plan.ts:223 | 无内置 | 是 | getUserPlan + getPlanUploadLimits | 幂等 |
| getPlanCapabilitySnapshot / canUsePlanCapability / getPlanLimits 等能力矩阵族 | service-fn | plan-capabilities.ts + upload-limits.ts | 无鉴权 | 是 | 读 PLAN_CAPABILITY_MATRIX + 旧键回退 | 幂等 |
| Creem Webhook | api-route | creem/route.ts:247 | external（HMAC-SHA256） | 否 | grant + 订阅写 + 反欺诈金额（软门闩） + logEvent | 幂等：sourceRef + credits_batch 唯一索引 |
| epay Webhook（唯一履约入口） | api-route | epay/route.ts:14 → epay-fulfillment.ts:88 | external（MD5） | 否 | claim 原子领单 + grant + 订阅写 + 升级作废 + 反欺诈（硬校验） | 幂等：claim + sourceRef 唯一索引 + 进程内 Map |
| fulfillSuccessfulEpayPayment（履约编排） | service-fn | epay-fulfillment.ts:88 | 无内置（验签后调用） | 否 | 同 epay webhook | 幂等 |
| epay 同步回跳页（仅展示不履约） | api-route | epay/return/route.ts:14 | public（验签仅展示） | 是 | 读本地订单状态（防重放薅羊毛） | 幂等 |
| epay 订单持久化族（save/get/update/claim） | service-fn | epay.ts:288-381 | 无鉴权 | 否 | epay_order upsert / 原子 CAS | upsert/claim 幂等 |
| Creem API 客户端（checkout/get/cancel/customer） | service-fn | creem.ts:290（apps 侧另有副本） | 无内置 | 否 | 外呼 Creem REST | checkout 透传 request_id；cancel 无幂等键 |
| epay 签名/构单/验签纯函数族 | service-fn | epay.ts + epay-fulfillment.ts:72 | 无鉴权 | 是 | 多为纯函数（读运行时 EPAY_*） | 幂等 |
| PlanBadge（套餐徽章组件） | service-fn | plan-badge.tsx | public（纯展示） | 是 | 无 | 不适用 |

接口化要点：subscription 服务层、能力矩阵族、creem/epay 纯逻辑、升级报价均已干净可直接复用。actions.ts 6 个操作需抽纯函数 core(userId,input)；createCheckoutSession 输出形态 creem/epay 不一致需归一。Creem webhook handler 未导出、700+ 行与 NextResponse 强绑定，需抽 service-fn（参照 epay-fulfillment 分层）。幂等键散落、反欺诈金额门闩策略不一致（creem 软 / epay 硬）、subscription.userId 无唯一约束（部分查询缺 orderBy）。creem 客户端双副本需收敛。

---

## 4. user-auth-roles（管理员 CRUD/封禁/角色/改密/会话/bootstrap/注册验证）

| 操作 | 形态 | 符号 | 权限 | 只读 | 副作用 | 幂等 |
|---|---|---|---|---|---|---|
| listUsers（列表+筛选+统计） | server-action | admin-users.ts:419 | admin | 是 | 多表 join 聚合 | 幂等只读 |
| getUserDetail（详情聚合） | server-action | admin-users.ts:554 | admin | 语义只读 | 先 expireStalePendingGenerations（写） | 读为主；expire 幂等 |
| updateUserRole | server-action | admin-users.ts:705 | superAdmin | 否 | update role + 审计 + revalidate | 幂等（每次写审计） |
| banUser（封禁/解封） | server-action | admin-users.ts:731 | admin + assertCanActOnTarget | 否 | update banned + 删会话（强制下线）+ 审计 | 幂等 |
| grantCredits（管理员发放） | server-action | admin-users.ts:775 | admin + 禁自发 + 护栏 | 否 | grantCredits(admin_grant) + 审计 | **不幂等**（未传 source_ref） |
| adjustCredits（扣减/覆盖） | server-action | admin-users.ts:829 | superAdmin | 否 | grant/consume + 审计 | **不幂等**（基于读取计算增量） |
| setUserPlan（手动切换套餐） | server-action | admin-users.ts:962 | superAdmin | 否 | subscription upsert + 审计（不发积分） | 近似幂等 |
| setCreditsStatus（冻结/解冻） | server-action | admin-users.ts:1041 | admin | 否 | freeze/unfreeze + 审计 | 幂等 |
| setExternalApiKeyStatus（启停 key） | server-action | admin-users.ts:1093 | admin | 否 | update isActive + 审计（入参 keyId） | 幂等 |
| createUser（手动建号） | server-action | admin-users.ts:1151 | superAdmin | 否 | 双重查重 + insert user/account + ensureBalance + 账本 + 审计（绕 Better Auth hooks） | 非幂等（靠唯一约束兜底） |
| updateUserProfile（改名/邮箱/验证态） | server-action | admin-users.ts:1231 | superAdmin | 否 | 局部 update + 改邮箱查重 + 账本同步 + 审计 | 幂等 |
| setUserPassword（重设密码） | server-action | admin-users.ts:1310 | superAdmin | 否 | 覆盖/新增 credential + 审计（不落密码） | 幂等 |
| getCurrentSession（会话权威端点） | api-route | session/current/route.ts:44 | public（凭 cookie） | 语义只读 | 读 user；无效则清 cookie（登出兜底） | 幂等 |
| sendRegistrationVerificationCode | mixed | registration-verification.ts:31 | public（自用模式禁用） | 否 | 60s 冷却 + insert verification + 发信（失败回滚） | 非幂等（有冷却节流） |
| verifyRegistrationCode | service-fn | registration-verification.ts:100 | public/internal | 否 | 状态机删码/+attempts（MAX 5 防暴破） | 非幂等（消费型） |
| registrationGuard（注册前置守卫插件） | service-fn | registration-verification-plugin.ts:84 | framework-internal | 否 | 校验+消费验证码+账本写+封禁拦截 | 非幂等 |
| bootstrapSelfUseSuperAdmin（启动期初始化超管） | service-fn | bootstrap-super-admin.ts:96 | system/startup | 否 | 提升/建超管 + 凭据明文落盘 + 进程闸 | 幂等（已存在即返回） |
| getUserRoleById（角色解析，授权链根） | service-fn | role-server.ts:18 | internal | 语义只读 | 通常纯读；local admin 惰性提权写 | 幂等 |
| checkAdmin / isAdmin（路由守卫） | service-fn | admin.ts:25/49 | internal | 语义只读 | 读会话/角色；非管理员 redirect | 幂等 |
| getServerSession / getCurrentUser / isAuthenticated | service-fn | server.ts | internal/protected | 是 | 纯读（耦合 next/headers） | 幂等 |

接口化要点：admin-users 13 个 action 需把权限判定（actor{userId,role}）与业务执行拆开、剥离 revalidatePath。roles.ts / registration-verification-core / session-current-core 已是 DB-free 纯函数有单测。server.ts/admin.ts 依赖 next/headers/redirect，需改为传入已解析 session。createUser 5 步非单事务靠唯一约束兜底。grant/adjust 是最需补幂等键的操作。getUserRoleById 含隐藏写副作用（只读副本会失败）。bootstrap 含凭据明文落盘，仅内部运维，不外暴露。

---

## 5. image-backend-pool（生图后端池/调度/账号/OAuth/Sub2API/冷却）

| 操作 | 形态 | 符号 | 权限 | 只读 | 副作用 | 幂等 |
|---|---|---|---|---|---|---|
| resolveImageBackendPoolConfig（调度选后端） | service-fn | service.ts:1651 | service-internal | 否 | touch lastUsedAt + 读组/账号 + 在途计数 | 非幂等（更新 lastUsedAt + 选号） |
| reportImageBackendResult（上报/冷却调度） | service-fn | service.ts:1669 | service-internal（唯一失败转移出口） | 否 | 更新 success/failCount/status/cooldown；web 扣远端额度 | 非幂等（计数自增，覆盖式） |
| acquire/releaseImageBackendInflight（在途并发计数） | service-fn | service.ts:426/435 | service-internal | 否 | 进程内 Map 增减 | 非幂等（单进程内存态） |
| isImageBackendSwitchableError（错误分类纯函数） | service-fn | service.ts:558 | public/无 | 是 | 无 | 幂等 |
| getSelectableImageBackendGroups | server-action | actions.ts:94 | protected | 是 | 读 + getUserPlan 能力判定 | 幂等 |
| setUserImageBackendPreference | server-action | actions.ts:105 | protected | 否 | upsert preference | 幂等 |
| getImageBackendGroupOptions | server-action | actions.ts:591 | protected（未限管理员） | 是 | DB读 | 幂等 |
| getAdminImageBackendPool（池总览） | server-action | actions.ts:122 | imageBackendPoolViewer | 是 | DB读 | 幂等 |
| saveImageBackendGroup（增删改组/子组/倍率） | server-action | actions.ts:223 | admin | 否 | upsert group；isDefault 互斥 | id 指定幂等；无 id 非幂等 |
| deleteImageBackendGroup | server-action | actions.ts:260 | admin | 否 | 删组 + 解绑成员 | 幂等 |
| saveImageBackendAccount（增改账号/RT换AT） | server-action | actions.ts:269 | admin | 否 | OAuth 换 AT（外呼）+ upsert + 去重；拒改 Sub2API 托管 RT | id 幂等；hash 去重；OAuth 非幂等 |
| bulkUpdateImageBackendAccounts | server-action | actions.ts:310 | admin | 否 | 批量 update；resetAvailability 清 cooldown | 幂等 |
| bulkDeleteImageBackendAccounts | server-action | actions.ts:351 | admin | 否 | 分批 delete | 幂等 |
| deleteImageBackendMember（单删） | server-action | actions.ts:551 | admin | 否 | delete account/api | 幂等 |
| saveImageBackendApi（增改第三方 API） | server-action | actions.ts:509 | admin | 否 | upsert api（新建必带 apiKey） | id 幂等；无 id 非幂等 |
| importAccountsFromRefreshTokens（RT→AT 建账号） | server-action | actions.ts:368 | admin | 否 | 逐条 OAuth 换 AT + 批量 upsert + hash 去重 | 部分幂等；OAuth 非幂等；startIndex 续传 |
| importWebAccountsFromAccessTokens | server-action | actions.ts:404 | admin | 否 | 批量 upsert web 账号 + hash 去重 | 部分幂等 |
| refreshImageBackendAccountInfo（单刷新） | server-action | actions.ts:569 | admin | 否 | 拉远端 + 更新 metadata/status | 非幂等（实拉远端） |
| refreshImageBackendAccountsInfo（批量刷新） | server-action | actions.ts:577 | admin | 否 | 10 并发拉远端 + 更新 | 非幂等 |
| getSub2ApiSyncStatus | server-action | actions.ts:129 | admin | 是 | 探测连接 | 幂等 |
| getSub2ApiSourceGroups | server-action | actions.ts:137 | admin | 是 | 外部 DB 读 | 幂等 |
| getSub2ApiAutoSyncTasks | server-action | actions.ts:144 | admin | 是 | 读 system-settings KV | 幂等 |
| syncSub2ApiAccounts（同步账号到池） | server-action | actions.ts:430 | admin | 否 | 外部 DB 读 + 批量 upsert + 清理 + 落任务 | 部分幂等（hash 去重） |
| runSub2ApiManualSync | server-action | actions.ts:470 | admin | 否 | 同 sync + 落任务 | 部分幂等 |
| runSub2ApiAutoSyncTaskNow | server-action | actions.ts:151 | admin | 否 | 外部 DB 读 + 池写 + 更新任务结果 | 部分幂等 |
| setSub2ApiAutoSyncTaskEnabled | server-action | actions.ts:162 | admin | 否 | 更新 KV enabled | 幂等 |
| setSub2ApiAutoSyncTaskOverwriteLocalUnavailableState | server-action | actions.ts:175 | admin | 否 | 更新任务设置 | 幂等 |
| updateSub2ApiAutoSyncTaskOptions | server-action | actions.ts:190 | admin | 否 | 覆盖任务配置 | 幂等 |
| deleteSub2ApiAutoSyncTask | server-action | actions.ts:211 | admin | 否 | 从 KV 移除任务 | 幂等 |
| CRON: Sub2API 周期同步 | api-route | jobs/.../sync → scheduled-jobs.ts:70 | cron-secret | 否 | 遍历 enabled 任务同步 + 元数据写 | 按 interval/force；hash 去重部分幂等 |
| CRON: 刷新陈旧 web 账号 | api-route | jobs/.../refresh → scheduled-jobs.ts:47 | cron-secret | 否 | 拉远端 + 更新 metadata/status | 非幂等（按 staleMinutes 限流） |

接口化要点：service.ts 几乎全部业务逻辑已是 plain async（POJO 入出参），actions.ts 仅薄包装（Zod + 鉴权 + 调 service）。鉴权抽成传输无关策略；权限不对称（protected/viewer/admin/cron）。in/out 归一逻辑（nullableGroupId、syncMode 强制）目前嵌在 action。inflight Map 单进程，负载均衡多实例退化。OAuth 换 token / web 信息拉取 / Sub2API PG 读是外呼集中点。Sub2API 任务存 system-settings KV。reportImageBackendResult 非幂等且缺断言/单测（C-M9/C-M11）。

---

## 6. system-settings（运行时设置/配置定义/env 同步/脱敏）

| 操作 | 形态 | 符号 | 权限 | 只读 | 副作用 | 幂等 |
|---|---|---|---|---|---|---|
| getAdminSettingsSnapshot（读全部含脱敏） | mixed | actions/index.ts:20 → index.ts:618 | superAdmin | 是 | 读 systemSetting + env 合并；secret displayValue 空串 | 幂等（纯读） |
| updateSystemSettings（批量写/清空） | mixed | actions/index.ts:27 → index.ts:547 + env-file.ts:89 | superAdmin | 否 | 事务 upsert/delete + clearCache + 写 .env.local（secret 空串跳过） | 幂等（按 key upsert，无显式幂等键） |
| importSettingsFromEnv（从 env 导入） | mixed | actions/index.ts:53 → index.ts:256 | superAdmin（service 本身无鉴权，bootstrap 也调） | 否 | upsert + clearCache + 写 .env.local | 幂等 |
| initializeMissingDefaults（默认值+旧键迁移） | mixed | actions/index.ts:74 → index.ts:309 | superAdmin（service 无鉴权） | 否 | 旧键迁移事务 + insert onConflictDoNothing + clearCache | 幂等 |
| syncSettingsToEnvFiles（DB 镜像写回托管块） | service-fn | env-file.ts:89 | internal | 否 | 遍历白名单路径写 .env.local（0o600，best-effort 吞错） | 幂等（整块替换） |
| bootstrapSettingsEnv（启动期导入+初始化+回填） | service-fn | bootstrap.ts:10 | system/bootstrap | 否 | import + initialize（写 DB）+ 回填 process.env；整体吞错 | 幂等（bootstrapped 守卫） |
| getRuntimeSettingValue（多类型 getter 家族） | service-fn | index.ts:75-185 | internal | 是 | 读 systemSetting（10s 缓存）；getProcessSetting* 仅读 env | 幂等（纯读） |

接口化要点：snapshot/set/import/initialize/sync/bootstrap + getter 族均干净可复用。actions 是 superAdmin + zod + 调 service 薄壳；鉴权 + updatedBy 审计需从 ctx 抽到入参/中间件；env 同步是 action 层编排。鉴权不对称（service 无鉴权，bootstrap 无鉴权调用），接口边界必须补鉴权。事务 + clearCache 副作用；多实例缓存/env 镜像不自动失效（DB 为真相）。脱敏只在读路径 + 写路径空串跳过；env 同步会写明文（0o600），警惕 raw getter 绕过。文件写受路径白名单（/root//home/），Windows 不写文件。definitions.ts 是契约真相源，改能力位须同步示例与面板。

---

## 7. storage（对象存储）

| 操作 | 形态 | 符号 | 权限 | 只读 | 副作用 | 幂等 |
|---|---|---|---|---|---|---|
| getSignedUploadUrl（头像/用户文件直传 URL） | server-action | actions.ts:57 | protected | 否 | S3 预签名（local 返回 GET 路由不可 PUT）+ 读套餐能力 | 幂等（无副作用） |
| deleteFile（删除用户文件） | server-action | actions.ts:118 | protected + 归属 + 桶白名单 | 否 | provider.deleteObject | 幂等 |
| readStorageObject（GET 代理） | api-route | storage/[bucket]/[...key]/route.ts:61 | avatars 公开；generations 需 session + 属主；桶白名单 + 防穿越 | 是 | provider.getObject | 幂等 |
| createPresignedUploadUrl（文档上传，独立于 shared） | api-route | upload/presigned/route.ts:31 | protected（Content-Type 服务端派生防 XSS） | 否 | 直接 new S3Client（绕过 provider 抽象）+ 日志 | 幂等（fileKey 随机） |
| getStorageProvider（provider 单例解析） | service-fn | providers/index.ts:20 | internal | 是 | 读运行时设置；进程级永不失效缓存 | 幂等 |
| putObject（写对象，管线调用） | service-fn | s3.ts:210 / local.ts:121 | internal（调用方已鉴权扣费） | 否 | S3 PutObject / local writeFile | 幂等覆盖（key 含随机 nanoid） |
| getObject（读对象） | service-fn | s3.ts:183 / local.ts:115 | internal（调用方限 generations 桶 + 防穿越） | 是 | 读 S3/local | 幂等 |
| deleteObject（批量清理过期图，维护任务） | service-fn | generation-maintenance.ts:444 | internal（cron/admin） | 否 | 批量删 + DB读 generation | 幂等 |
| getSignedUrl（读取预签名 URL） | service-fn | s3.ts:110 / local.ts:93 | internal | 是 | S3 getSignedUrl / local 拼接 | 幂等 |

接口化要点：两套存储栈需统一——shared/storage 主栈（getStorageProvider，s3/local 双后端）vs upload/presigned 独立实现（直 new S3Client 绕过抽象）。DB-free 纯函数（keyBelongsToUser/isBucketAllowed/resolveSafePath/validateUploadRequest）可直接暴露。getSignedUploadUrlAction/deleteFileAction 的桶白名单/归属/能力揉在 action 闭包，需抽 service。GET 路由鉴权/防穿越/IDOR/响应头写在 HTTP 处理器。**local provider getSignedUploadUrl 返回 GET 路由非可 PUT URL**，预签名直传仅 S3 可用。provider 单例进程级缓存永不失效。本域不扣费，存储操作天然幂等。

---

## 8. moderation（内容审核）

| 操作 | 形态 | 符号 | 权限 | 只读 | 副作用 | 幂等 |
|---|---|---|---|---|---|---|
| moderateContent（核心审核编排） | service-fn | index.ts:690 | 无内置（调用方负责） | 否 | 外呼阿里云/OpenAI/审核代理 + 读 settings + 日志（不写业务 DB/不扣费） | 语义只读、可重试；非幂等（无幂等键，重复打第三方） |
| getConfiguredModerationProviders | service-fn | index.ts:202 | 无鉴权 | 是 | 读 runtime settings | 幂等 |
| isContentModerationEnabled（总开关） | service-fn | index.ts:94 | 无鉴权 | 是 | 读 CONTENT_MODERATION_ENABLED | 幂等 |
| POST /moderate（入站审核代理端点） | api-route | moderate/route.ts:76 | proxySecret（PROXY/GATEWAY_SECRET 恒定时间；未配密钥 fail-closed 401） | 否 | 调 moderateContent(skipProxy) + 第三方外呼 | 非幂等；语义只读 |
| secretMatchesAny（密钥恒定时间比对纯函数） | service-fn | proxy-secret.ts:20 | N/A | 是 | 无 | 幂等（纯函数） |
| shouldBlockAliyunRisk（风险等级拦截判定） | service-fn | risk.ts:27 | N/A | 是 | 无 | 幂等（纯函数） |
| getContentChunks（2000 字分块） | service-fn | risk.ts:43 | N/A | 是 | 无 | 幂等（纯函数） |

接口化要点：纯逻辑层（risk.ts / proxy-secret.ts）已 DB-free 有单测。moderateContent 内部 await getRuntimeSetting* 隐式耦合 @repo/database，需保留 async 或配置注入。入参用 Buffer 非 JSON 友好，HTTP 暴露需 base64 编解码（route 与 index 各写一份需收敛）。/moderate route 手写非 Zod 解析 + 独立密钥体系（非 userId/admin），统一时保留密钥鉴权适配器。**fail-open/closed 是安全关键，传输层不可吞掉 decision==='error'（等价放行）**。扣费/退款在调用方（operations.ts），本域只暴露审核决策语义。出/入站密钥不对称，轮换有顺序约束。

---

## 9. external-api-v1（OpenAI 兼容外接 API）

| 操作 | 形态 | 符号 | 权限 | 只读 | 副作用 | 幂等 |
|---|---|---|---|---|---|---|
| authenticateExternalApiRequest（鉴权 funnel） | service-fn | auth.ts:27 | api-key（Bearer，isActive + 未 banned） | 否 | DB读 + 写 lastUsedAt + 限流（'ai' 桶） | 非幂等（写 lastUsedAt + 消耗限流） |
| postExternalImageGenerations（/v1/images/generations） | api-route | image-generations.ts:137 | api-key + externalApi.images.generate；batch/stream 各自能力 | 否 | 扣费/退款 + DB写 + 外呼 + async 回调 + 存储 | 非幂等；底层 sourceRef=generationId 幂等 |
| postExternalImageEdits（/v1/images/edits） | api-route | image-edits.ts:519 | api-key + externalApi.images.edit | 否 | 同上 + fetchPublicImage(SSRF 防护) + 上传源图 | 非幂等；扣费幂等 |
| postExternalChatCompletions（/v1/chat/completions） | api-route | chat-completions.ts:330 | api-key + externalApi.chat.completions | 否 | 扣费/退款 + DB写 + 外呼 + fetchPublicImage + 存储 | 非幂等；扣费幂等 |
| postExternalResponses（/v1/responses，含续承） | api-route | responses.ts:633 | api-key + externalApi.responses(Pro+) + 模型白名单 | 否 | 扣费/退款 + DB写续承(relayOnly 跳过) + 进程内续承缓存 + 外呼 | 非幂等；扣费幂等；续承缓存进程内 |
| postExternalAgentImages（/v1/agents/images，Ultra+） | api-route | agent-images.ts:837 | api-key + externalApi.agent(Ultra+) | 否 | 扣费/退款 + DB写 + 多轮外呼 + 上传源图 + 附件/PDF 解析 | 非幂等；扣费幂等 |
| getExternalCredits（/v1/credits） | api-route | credits.ts:9 | api-key | 是 | DB读（auth 仍写 lastUsedAt） | 幂等只读 |
| getExternalImageTask（/v1/images/{taskId}） | api-route | image-tasks.ts:10 | api-key + 归属 | 是 | 进程内 Map 读（TTL 30min） | 幂等只读 |
| getExternalModels（/v1/models） | api-route | models.ts:21 | api-key + externalApi.models.list | 是 | DB读（getUserPlan + 能力快照） | 幂等只读 |
| getExternalApiKeys（用户面板：列 key） | server-action | external-api-key.ts:71 | protected | 是 | DB读（不含明文/keyHash） | 幂等只读 |
| createExternalApiKey（建 key，明文仅一次） | server-action | external-api-key.ts:105 | protected + keys.manage；relay 需 Pro+ | 否 | insert（keyHash=sha256） | 非幂等（无幂等键） |
| revokeExternalApiKey（吊销，软删） | server-action | external-api-key.ts:145 | protected + 归属 | 否 | update isActive=false | 近似幂等 |
| deleteExternalApiKey（物理删，须先吊销） | server-action | external-api-key.ts:180 | protected + 归属 + 前置吊销 | 否 | delete where isActive=false | 幂等 |
| updateExternalApiKeyModeration | server-action | external-api-key.ts:218 | protected + keys.manage + 归属 | 否 | update（套餐归一可能降级） | 幂等 |
| updateExternalApiKeyGroup | server-action | external-api-key.ts:250 | protected + keys.manage + 归属；非 default 需 backendGroups.select | 否 | update generationGroupId | 幂等 |
| updateExternalApiKeyQuota | server-action | external-api-key.ts:279 | protected + keys.manage + 归属 | 否 | update creditLimit（不重置 used） | 幂等 |
| updateExternalApiKeyRelay | server-action | external-api-key.ts:308 | protected + keys.manage + 归属；开启需 Pro+ | 否 | update relayOnly | 幂等 |
| getExternalApiKeyQuota（service：读配额） | service-fn | quota.ts:19 | 调用方负责归属 | 是 | DB读 | 幂等只读 |
| reserveExternalApiKeyCredits（原子预扣 key 配额） | service-fn | quota.ts:61 | 内部 | 否 | 原子 UPDATE creditsUsed += amount（条件防超额） | 非幂等（累加，无幂等键） |
| refundExternalApiKeyCredits（回退 key 配额） | service-fn | quota.ts:110 | 内部 | 否 | UPDATE creditsUsed = GREATEST(0, -amount) | 非幂等（累减，防负不防多退） |
| createAsyncImageTask / get / complete / toResponse（内存态任务） | service-fn | async-image-tasks.ts:48/85/94/89 | 内部（归属在 handler 校验） | 否 | 进程内 Map（TTL 30min） | create 非幂等；complete 幂等 |
| validateCallbackUrl / postAsyncImageCallback（回调 + SSRF） | service-fn | async-image-tasks.ts:43/122 | 内部 | 否 | 外呼用户 URL（10s 超时，逐跳复检防 TOCTOU） | post 非幂等 |
| setExternalApiKeyStatusAction（管理后台启停任意 key） | server-action | admin-users.ts:1093 | admin（非归属限定） | 否 | update isActive + 审计 | 幂等（每次写审计） |

接口化要点：5 个生图 handler 最终都调 runImageGenerationForUser，单点改 operations.ts 覆盖全部 v1。传输强耦合（withApiLogging + NextRequest + Response/SSE/keepalive + multipart + SSRF 内联，edits/agent 各一份重复需抽公共）。鉴权 funnel 混入限流与 lastUsedAt 写副作用（纯读操作也带写）；注意 funnel 末端 429 误映射 401。两套配额体系：账户积分（sourceRef 幂等）与 key 级配额（reserve/refund 无幂等键，累加累减）。stream/async/keepalive 三种响应 + async Map + 续承缓存均进程内（多实例不共享）。干净可复用：quota.ts 全套、models.ts、auth-token、quota-math。8 个用户 action + 1 管理 action 需 userId 显式化，保留"明文仅一次"/"先吊销后删"/"relay 需 Pro+"/审计约束。relayOnly 横切隐私边界须作一等参数贯穿。路由双挂载 /v1/* 与 /api/v1/* 仅 re-export。

---

## 10. support-announcements（工单/公告/未读计数）

| 操作 | 形态 | 符号 | 权限 | 只读 | 副作用 | 幂等 |
|---|---|---|---|---|---|---|
| createTicket | server-action | ticket.ts:47 | protected | 否 | insert ticket + 初始消息 + 管理员邮件 + revalidate（insert/update 非事务） | 非幂等（无去重键） |
| getMyTickets | server-action | ticket.ts:100 | protected（仅自己） | 是 | unread 由 SQL 计算 | 幂等只读 |
| getTicketDetail | server-action | ticket.ts:128 | protected + 归属（防 IDOR） | 语义只读 | update userLastSeenAt（标记已读写副作用） | 读幂等；标记已读幂等 |
| addTicketMessage | server-action | ticket.ts:176 | protected + 归属；closed 拒绝 | 否 | insert 消息 + update ticket + 管理员邮件 + revalidate | 非幂等 |
| getAllTickets | server-action | ticket.ts:240 | admin | 是 | unread/adminUnread SQL（全表无分页） | 幂等只读 |
| getAdminUnreadTicketCount | server-action | ticket.ts:275 | admin | 是 | count SQL | 幂等只读 |
| getMyUnreadTicketCount（含管理员分支） | server-action | ticket.ts:290 | protected（按角色分流统计范围） | 是 | DB读 + getUserRoleById | 幂等只读 |
| getAdminTicketDetail | server-action | ticket.ts:319 | admin（不校验归属） | 语义只读 | update adminLastSeenAt（标记已读） | 读幂等 |
| adminReplyTicket | server-action | ticket.ts:379 | admin | 否 | insert 回复 + update（open→in_progress）+ revalidate（不发用户邮件） | 非幂等 |
| updateTicketStatus | server-action | ticket.ts:439 | admin | 否 | update status + revalidate | 幂等 |
| sendTicketAdminNotification（内部邮件） | service-fn | notifications.ts:48 | internal/none | 否 | sendEmail(Resend)；收件人空则跳过 | 非幂等（失败吞掉不抛） |
| listActiveAnnouncementsForUser | service-fn | announcements/actions.ts:117 | 无内置（调用方负责） | 是 | leftJoin read + 活跃过滤 | 幂等只读 |
| countUnreadAnnouncementsForUser | service-fn | actions.ts:144 | 无内置 | 是 | count unread | 幂等只读 |
| markAnnouncementIdsReadForUser | service-fn | actions.ts:160 | 无内置 | 否 | insert read onConflictDoUpdate(readAt=now) | 幂等（upsert） |
| getMyUnreadAnnouncementCount | server-action | actions.ts:186 | protected | 是 | 包装 count | 幂等只读 |
| markAllAnnouncementsRead | server-action | actions.ts:193 | protected | 否 | 查未读 + upsert + revalidate | 幂等 |
| markAnnouncementRead | server-action | actions.ts:217 | protected + 公告存在校验 | 否 | upsert + revalidate | 幂等 |
| listAnnouncementsForAdmin | service-fn | actions.ts:236 | 无内置（调用方 admin 校验） | 是 | 全表（含未发布） | 幂等只读 |
| getAdminAnnouncements | server-action | actions.ts:243 | admin | 是 | 包装 + 序列化 | 幂等只读 |
| createAnnouncement | server-action | actions.ts:249 | admin | 否 | insert + 审计 + revalidate | 非幂等（randomUUID） |
| updateAnnouncement | server-action | actions.ts:284 | admin + 存在校验 | 否 | update + 审计（before/after）+ revalidate（updatedAt 使所有用户变未读） | 幂等 |
| deleteAnnouncement | server-action | actions.ts:332 | admin + 存在校验 | 否 | delete + 审计 + revalidate | 幂等 |
| toggleAnnouncementPublish | server-action | actions.ts:357 | admin | 否 | update isPublished 取反 + 补 publishedAt + 审计 + revalidate | **非幂等（toggle 语义）** |

接口化要点：该域**无 HTTP api-route**，全为 server-action/service-fn，统一接口需自建 RPC 层。announcements 已有干净可复用纯函数（list/count/markIds/listForAdmin + sendTicketAdminNotification），鉴权由调用方负责。**ticket.ts 10 个 action 业务逻辑内联在闭包、未抽 service-fn、依赖 revalidatePath，需先下沉为参数化 service-fn**。权限：getMyUnreadTicketCount 按角色分流；管理员端不校验归属（设计如此）。createTicket/addTicketMessage insert+update 非事务需补；标记已读是隐式写副作用（GET 化需拆显式 mutation）。幂等缺口：create/addMessage/reply/createAnnouncement 无幂等键（需 clientRequestId 唯一索引）；toggleAnnouncementPublish 建议改接受目标布尔值。邮件优雅降级（未配收件人跳过）；管理员回复不发用户邮件。本域不扣费、无上传。

---

## 附：接口化通用约束（跨域）

1. **单一管线**：image-generation 全部入口汇入 `runImageGenerationForUser`，单点改即覆盖。
2. **财务真相**：credits_transaction（双重记账）；扣费幂等键 (user_id,type,source_ref)；发放/退款幂等键 credits_batch(source_type,source_ref)。统一接口强制 sourceRef。
3. **能力矩阵**：plan-capabilities.ts 唯一来源，动态能力位（count/stream/mode）由 derive 下沉到 definition。
4. **事务边界**：底层 service 自带 db.transaction，不可嵌套外层事务。
5. **进程内态**：队列/inflight/async-Map/续承缓存/settings 缓存单进程，多实例退化（元数据标 processLocalState）。
6. **鉴权标准**：timingSafeEqual 恒定时间比对（cron/proxy/external/支付验签）。
7. **脱敏边界**：secret 读路径空串、写路径空串=不改；禁 raw getter/env 同步绕过。
8. **双副本**：admin-users / creem 以 packages/shared 为权威，apps/web 旧镜像收敛。
9. **只读语义陷阱**：getCreditsBalance/getUserGenerations/getUserRoleById 等"读中带写"，按业务语义判 readOnly，元数据标 hasMaintenanceWrite。
10. **moderation fail-closed**：decision==='error' 必须透传，传输层不可吞。
