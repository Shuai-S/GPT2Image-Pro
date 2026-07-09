# 2026-07-10 系统工程与性能审计

> 范围：工程规范、公开页面加载、接口热路径、数据库并发、后台任务、部署发布与依赖安全。
> 原则：本轮直接修复可独立验证、回滚边界清晰的问题；涉及财务迁移、分布式队列或核心调度器的改造保留为专项。

## 已完成

1. 生图请求复用套餐与能力上下文，避免同一请求重复查套餐。
2. 公开页、认证页与文档页改为 60 秒 ISR；语言选择不再写 Cookie，CDN 可共享缓存。
3. 共享会话 Provider、移除营销组件 barrel 深依赖，降低公共页面客户端依赖。
4. 创作页服务端数据改为 Promise DAG，消除三段串行瀑布；修复视频价格预览租约泄漏。
5. 首页 SLA 查询使用缓存，构建期跳过数据库；数据库故障时公开页降级为空样本。
6. metadata、canonical、JSON-LD、OG、支付回调、邮件、图片外链、robots 与 sitemap 改读运行时站点地址。
7. UOL 生图与 PPT/PSD 计费用户只从 Principal 派生，API Key 的 relayOnly 不可被输入降级。
8. Turbo 缓存输入补齐；固定 Node/pnpm/Turbo，修复根 DB 脚本与失效 Vitest 配置。
9. Docker standalone 补齐 AMD64/ARM64 sharp、ONNX 原生依赖，并加入构建层加载冒烟。
10. Docker 发布统一到 main，推送镜像前强制 lint、typecheck、test 与生产构建。
11. Nodemailer 升级；Vite、YAML、PostCSS、js-yaml 固定到安全补丁版本。

## 已验证基线

- Web：70 个测试文件、609 项测试通过，其中 UOL 身份边界测试 3 项。
- Shared：55 个测试文件、662 项测试通过。
- Next 生产构建：123/123 页面生成成功。
- 公开首页、定价、博客、法律、PSEO、Docs、Auth 均为 60 秒 ISR；Dashboard 保持动态。
- 运行时域名冒烟：以 `build.example` 构建、`runtime.example` 启动，ISR 后首页、JSON-LD、robots、sitemap 均只包含运行时域名。
- 生产依赖审计：从 11 项（3 high）降到 3 项（0 high、1 moderate、2 low）。

## P0 专项

### 1. 后台任务长事务

证据：`apps/web/src/server/internal-job-scheduler.ts` 的 `withJobLock()` 在
`db.transaction()` 内调用完整 `run()`。图像清理、积分过期、账号刷新、注册补号和
Sub2API 同步都可能包含批量数据库或网络 I/O，期间一直占用连接与事务级 advisory lock。

方案：把“抢租约/写 running 状态”做成短事务，任务在事务外运行，结束后再用短事务写终态。
跨副本互斥改为带 `ownerId + expiresAt + heartbeat` 的租约行，或使用独立 PostgreSQL session
级 advisory lock；不得把第三方网络请求放进事务。

验收：任务运行期间数据库连接不保持 `idle in transaction`；进程崩溃后租约可自动过期；
双副本并发触发只有一个执行者；覆盖成功、失败、超时与接管测试。

### 2. 异步任务与用户队列仅存在单进程

证据：`apps/web/src/features/external-api/async-image-tasks.ts` 使用模块级 Map，
`apps/web/src/features/image-generation/queue.ts` 使用模块级数组与 `runningByUser` Map。
进程重启会丢失 PPT/PSD 任务，多副本会让轮询随机 404，并使用户/全局并发上限按副本放大。

方案：任务状态持久化到 PostgreSQL；执行队列使用 Redis/BullMQ 或 PostgreSQL
`FOR UPDATE SKIP LOCKED` worker。用户并发采用分布式 semaphore，任务领取与状态迁移带租约、
重试次数和幂等键。图像 generation 已有 DB 行，可复用；PPT/PSD 需新增持久任务表。

验收：重启与双副本下任务可继续查询；同一 clientRequestId 不重复扣费；worker 崩溃后可接管；
用户并发上限在集群维度成立。

### 3. 积分过期无界扫描与逐行事务

证据：`packages/shared/src/credits/core.ts` 的 `processExpiredBatches()` 先无 limit 读取全部过期
批次，再为每行开启一次事务，执行批次更新、流水插入和余额更新。积压时形成 1 + 3N 查询和
大量串行事务，也会被用户余额热路径惰性触发。

方案：按固定批量选取并锁定过期批次，使用 `SKIP LOCKED` 支持多 worker；同一用户的过期金额
先聚合后单次更新余额，交易流水批量插入。保持 `active -> expired` 条件更新和双重记账不变量，
每批提交后继续下一批。

验收：10 万过期批次压测无无界内存；查询数与批次数相关而非行数相关；并发 worker 不重复过期；
流水借贷合计与余额变化严格一致。

### 4. 订阅每用户唯一性缺少数据库约束

证据：`packages/database/src/schema.ts` 仅约束 `subscriptionId` 唯一，`userId` 无唯一索引；多处
业务查询按 userId `limit(1)` 且无确定排序。并发 webhook/管理操作可产生同用户多行并读到任意行。

方案：先审计并确定历史多订阅归并规则，再手写幂等迁移清理重复行并增加 userId 唯一索引；
所有创建路径改为 upsert，并补并发 webhook 测试。迁移前不可直接加约束，以免生产升级失败。

## P1 专项

### 5. 后端池选路 SQL 与内存放大

`apps/web/src/features/image-backend-pool/service.ts` 单文件 8,339 行。一次候选选择并行拉取 API、
账号和 Adobe 全候选，再在进程内过滤、排序、尝试租约；嵌套组和多渠道会重复进入该路径。

先记录每次选择的 SQL 次数、候选行数、租约冲突数与总耗时，再把模型/车道/状态/冷却过滤尽量
下推 SQL，并对候选设置小上限。分组静态配置可缓存 30 到 60 秒，租约与 lastUsedAt 保持实时。
拆分 service 前先锁定调度对拍测试，避免改变 alwaysActive、粘性和混合车道语义。

### 6. 第三方 fetch 缺统一截止时间和响应上限

非测试代码仍有约 40 条直接 fetch，分布在生图、ChatGPT Web、支付、审核、注册机和图片回读。
部分已有 AbortSignal，但不是所有路径都同时限制连接总时长与响应正文。恶意或失控上游可长期占用
连接，或返回超大正文造成内存压力。

建立共享 `fetchWithDeadline`/有限正文读取器，按 JSON、图片、视频分别设置上限；支付和审核默认
fail-closed，非关键观测路径可降级。不得把客户端 Authorization/Cookie 转发到非同源 URL，
图片外链继续复用 DNS pin/SSRF 校验。

### 7. 发布标签尚未原子提升

发布前质量门已补，但 Docker 矩阵仍由每个镜像独立推送 `latest`/semver；某个镜像失败时，其他
镜像的可变标签可能已更新，形成组件版本不一致。

改为矩阵只推 `sha-*` 不可变标签；全部平台与全部镜像成功后，由单一 promote job 用 manifest
原子提升 semver/latest。失败时不得移动任何可变标签。

### 8. 数据库迁移缺执行级 CI

当前只检查 SQL 与 journal 文件存在性，CI 未启动 PostgreSQL 执行空库迁移和旧版本升级。
增加 PostgreSQL service：从空库运行全部迁移、从上一个正式 tag 的 schema 运行增量迁移，
再执行关键唯一索引与 schema smoke。财务迁移必须覆盖重复历史数据。

## P2 工程债

- 文件规模：生图 service 5,933 行、创作页客户端 5,858 行、后端池管理面板 3,728 行、系统设置面板 2,732 行。按协议适配、调度、持久化和 UI 面板逐块拆分，禁止纯机械切文件。
- 可观测性：补 Next 16 `instrumentation-client.ts`、`onRequestError` 与 Sentry source map 上传；增加 liveness、数据库 readiness、队列/租约指标和 Web Vitals 性能预算。
- 前端预算：为公开页、Docs、创作页、画布和管理页设置 gzip JS/CSS、LCP、INP、CLS 门槛，加入 Playwright/Lighthouse 关键流程；当前仅有单元测试和构建门禁。
- 请求体：全局 200 MB 是企业套餐上限所需，不能直接下调。大文件改走预签名/流式上传后，再把 Server Action 与代理全局上限收敛到小控制面请求。
- 依赖残留：audit 剩余 esbuild 1 moderate/2 low，来源是 Drizzle 旧 `@esbuild-kit` 和 Vite/tsx 的开发服务器；等待上游进入兼容依赖范围，禁止无测试跨 major override。

## 执行顺序

1. 后台任务短事务与可恢复租约。
2. 持久异步任务和集群队列。
3. 积分过期批处理，随后处理订阅唯一迁移。
4. 后端池 SQL 基准与选路优化。
5. fetch 统一截止时间/正文上限、迁移 CI、原子镜像标签。
6. 可观测性、性能预算与大文件直传。
