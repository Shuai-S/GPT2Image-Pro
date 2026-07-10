# 2026-07-10 系统工程与性能审计实施验收

> 范围：工程规范、公开页面加载、接口热路径、数据库并发、后台任务、
> 部署发布、可观测性与依赖安全。
> 状态：P0/P1 已实施；P2 中可独立验收的基础设施已实施，巨型模块继续按职责渐进拆分。
> 详细实施记录：`docs/memory/2026-07-10-system-performance-audit-implementation.md`。

## 验收结论

- [x] 后台任务不再把网络或整段业务包进数据库事务；PostgreSQL 租约具备
  `ownerId + runId` fencing、心跳、超时接管和持久终态。
- [x] PPT/PSD、普通图像与视频异步任务、callback outbox 均已持久化；图像和视频
  共用集群级 PostgreSQL semaphore，等待或执行期间失去租约会中止旧执行者。
- [x] 积分过期改为 500 条分页、`SKIP LOCKED`、按用户聚合结算；订阅表增加
  每用户唯一约束并统一走 upsert。
- [x] 后端池候选查询下推可用性条件、设置上限并记录候选数、冲突数与耗时；
  多组候选先去重再限流。
- [x] 第三方 HTTP 统一具备 deadline、组合 abort、有限正文读取与错误正文上限；
  审核路径 fail-closed，公开图片继续执行 DNS pin 与 SSRF 校验。
- [x] Docker 发布改为单一 OCI release descriptor；组件只写不可变 exact semver，
  全部成功后才移动 `latest` 或 `prerelease` channel。
- [x] CI 在真实 PostgreSQL 16 上执行空库迁移、上一正式版本升级、二次幂等迁移和
  关键 schema 断言；正式 tag 会排除自身并选择上一稳定版本。
- [x] 已接入 Sentry 客户端/服务端错误钩子与 source map、Web Vitals、公开页和登录态
  Lighthouse、客户端资源体积预算、liveness/readiness、受保护 Prometheus 指标。
- [x] 创作页与无限画布大文件先直传对象存储，控制面请求收敛到 2 MiB；读取按
  Principal、用户 key、桶、套餐与真实字节上限校验。
- [x] 异步终态 retention 只处理可安全删除的任务；先清理输入对象，失败保留任务行
  重试。普通图像/视频异步入口支持 `Idempotency-Key` 内容一致重放和 409 冲突。
- [x] `storage.readObject` 输出收紧为 `Uint8Array`，并在输出校验与 `maxBytes` 硬上限
  之间形成双重边界。

## P0 实施与证据

### 后台任务租约

状态：已完成，提交 `9fd07727`。

`internal_job_lease` 以短事务完成领取、心跳和终态写入，任务主体在事务外运行。
同名任务由数据库租约跨副本互斥，旧执行者的 `runId` 不能覆盖接管者终态。DB-free
状态机测试覆盖成功、失败、超时、失权与崩溃接管；真实连接是否出现
`idle in transaction` 由部署监控继续观察。

### 持久异步任务与集群并发

状态：已完成，主要提交 `525f8206`、`a4bcacb4`、`720e8443`、`bd210244`、
`13bbd47d`、`aa9e7bd1`、`840cb8ba`。

`external_async_task`、普通 generation/video 业务行、callback outbox 和并发槽位均落入
PostgreSQL。worker 用 `SKIP LOCKED`、租约和 execution token 领取，结果按业务行动态
物化；生产对账器可补回已排队但缺任务的记录。普通图像批量执行恢复有界并发，
同步与异步视频都进入同一集群 semaphore，并复用入口解析的套餐上下文。

### 财务分页与订阅唯一

状态：已完成，提交 `02503433`、`0a9cf48b`、`8bc4627c`。

积分过期每页最多 500 个 active batch，`FOR UPDATE SKIP LOCKED` 支持并行 worker；
同一用户先聚合后更新余额，流水继续遵守双重记账。订阅迁移 `0059` 先归并历史重复，
再建立 `user_id` 唯一索引；Webhook、Epay 和管理员路径复用同一 upsert 服务。

## P1 实施与证据

### 后端池候选热路径

状态：已完成热路径收敛，提交 `1d83039c`、`2abe86c4`。

候选读取按模型、车道、状态和冷却条件尽量下推 SQL，单类候选设置上限；多组同一成员
先去重再限流。调度日志/指标记录 SQL 次数、候选行数、租约冲突和耗时，既有对拍测试
锁定 alwaysActive、粘性、混合车道和满并发回退语义。

### HTTP 资源边界

状态：已完成，提交 `9b7e58ef`、`9813be89`、`ff584c74`。

`@repo/shared/http/fetch` 提供 deadline、外部 signal 合并、流式正文限额、JSON/错误正文
有限解析。支付、Adobe、审核、生图、注册机和图片回读等关键路径已接入；OpenAI 审核
使用真实 abort 和 1 MiB 限额，失败保持 fail-closed。跨来源请求不会透传客户端
Authorization/Cookie。

### 发布与迁移门禁

状态：已完成，提交 `a4de4f49`、`fff3b987`、`4471c0a5`、`48744965`。

迁移 CI 覆盖空库与上一正式版本升级，并对迁移重复执行和唯一索引做断言。Docker 矩阵
只推 run-scoped `sha-*`；promote 脚本先校验四组件 digest，写不可变组件/exact descriptor，
最后仅移动 descriptor channel。故障注入脚本证明任一前置步骤失败时 channel 不移动。

## P2 实施与残余

### 已落地基础设施

- 可观测性：`56f6ab35`、`0d8f5e9f`、`464fa5ad` 接入 Sentry、Web Vitals、
  健康检查、租约/队列指标、登录态 Lighthouse 和前端预算；`d414ef79` 保证登录与
  Lighthouse 使用同一 `localhost` 来源。
- 前序性能基线：`7b660124` 至 `fc997967` 已完成套餐上下文复用、60 秒 ISR、公共
  会话/依赖收敛、创作页 Promise DAG、SLA 构建期降级、运行时站点地址、UOL 身份边界、
  Turbo/Node/pnpm 固定、Docker 原生依赖冒烟与依赖安全补丁，本轮改造未回退这些基线。
- 大文件边界：`f67a7107`、`093c89bb`、`ba73c7a5` 建立 UOL 直传授权、创作页/
  无限画布对象引用和 2 MiB 控制面；`5405768a`、`38446bfd` 收紧用户对象归属、
  `maxBytes` 与 UOL 输出类型。
- 异步生命周期：`13097ae5`、`02540180` 增加终态有界 retention 与严格输入 GC；
  `0f97e0f2` 增加普通图像/视频异步 HTTP 幂等、稳定内容摘要和唯一索引。
- 结构收敛：`78f8e5fd` 将后端错误分类、重置时间解析与冷却状态收敛提取为
  DB-free 模块；`service.ts` 只注入运行时设置并保留既有公共导出，132 项后端池与
  生图回退测试锁定行为。
- 资源预算：CI 强制客户端 gzip 资源体积预算、公开/登录态 LCP、CLS、TBT 等门槛；
  Docker Compose 与发布文档使用 exact tag，避免运行组件漂移。

### 仍需持续推进

- 巨型文件仍需按真实职责渐进提取并逐块回归，禁止机械拆分。当前重点为
  `image-backend-pool/service.ts`、`image-generation/service.ts`、`operations.ts`、
  `create-page-client.tsx`、`admin-panel.tsx`、`system-settings-panel.tsx`；后端池的
  error-classification/cooldown 已完成首块提取，剩余 scheduler、OAuth、导入同步与 CRUD。
- `pnpm audit --prod` 仍报告 esbuild 开发工具链的 1 moderate、2 low；来源为 Drizzle
  旧 `@esbuild-kit` 与 Vite/tsx，等待上游进入兼容范围，不做跨 major override 假修复。
- 本机没有可用 PostgreSQL 服务、Chrome 与 Docker Buildx，无法本地复现真实迁移、
  登录态 Lighthouse 和多架构/descriptor 发布；这些验收已固化在 CI，首次运行结果仍需
  在 GitHub Actions 留档。

## 验收命令

2026-07-10 本地终验：四包 lint/typecheck 全绿；Shared 745、Web 809 项测试通过；
Next 生产构建生成 123/123 页面；五个客户端入口均满足 gzip 预算，创作页最高为
512.7/525.0 KiB。离线 frozen lockfile、Drizzle schema check 和 Docker promote
故障注入脚本通过。`pnpm audit --prod` 仅保留已记录的 esbuild 1 moderate、2 low。

```bash
turbo lint
turbo typecheck
turbo test
turbo build
pnpm performance:assets
pnpm audit --prod
pnpm install --offline --frozen-lockfile
DATABASE_URL=postgresql://test:test@127.0.0.1:5432/test \
  pnpm --dir packages/database exec drizzle-kit check --config drizzle.config.ts
```

CI 额外执行 PostgreSQL 16 空库/升级迁移、登录态 Lighthouse 和 Docker Buildx 发布
故障注入。局部单测或静态检查通过不替代这些真实环境门禁。
