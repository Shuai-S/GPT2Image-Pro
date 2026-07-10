# 2026-07-10 系统性能审计实施记录

> 对应计划：`docs/plan/2026-07-10-system-performance-audit.md`。
> 用途：记录本轮跨队列、数据库、HTTP、发布与前端预算改造的长期事实，避免后续回退到
> 进程内状态、长事务或无界请求。

## 一、后台任务与持久队列

- `9fd07727`：内部 job 由长事务 advisory lock 改为 `internal_job_lease` 短事务租约；
  `ownerId + runId` fencing、心跳、过期接管，任务主体和第三方 I/O 均在事务外。
- `525f8206`：增加 PostgreSQL 生图并发槽位与 `external_async_task` 基础状态机。
- `a4bcacb4`：PPT/PSD task、worker 租约、对象输入和 callback outbox 持久化；
  `clientRequestId` 加内容摘要幂等，UOL 校验身份与资源归属。
- `720e8443` 至 `13bbd47d`：普通图像/视频 generation task 建立持久协议、worker、
  execution token、结果动态物化、生产对账与 Route 入队，替代请求返回后的后台闭包。
- `aa9e7bd1`：修复等待 semaphore 阶段 timeout/abort 竞态；晚到的槽位只释放、不执行业务。
- `840cb8ba`、`f52f6ce4`：同步/异步视频纳入同一集群 semaphore，入口和 worker 透传
  已解析套餐，避免重复查询。

不可破坏的约束：业务副作用必须在事务外；领取和终态更新必须带租约 token；失权的旧
执行者不得写终态或继续扣费/存储；所有生成仍汇入既有单一图像/视频业务管线。

## 二、数据库热路径与幂等

- `02503433`：积分过期固定 500 条分页，`SKIP LOCKED` 并行领取，同用户聚合结算；
  保持 active 条件更新、余额和 `credits_transaction` 双重记账一致。
- `0a9cf48b`：迁移 `0059` 清理同用户重复订阅并建立唯一索引；所有写路径统一 upsert。
- `8bc4627c`：相同幂等来源若金额漂移则拒绝，避免重放掩盖计费差异。
- `0f97e0f2`：普通图像/视频 async 支持 `Idempotency-Key`。摘要包含 callback、批量数、
  参数及媒体 role/MIME/真实字节，排除服务端 ID/时间；相同内容重放 winner，异内容 409，
  并发 loser 清理自己上传的临时输入。迁移 `0062` 建立 API Key 范围唯一约束。
- `13097ae5`、`02540180`：终态 retention 只选择 completed/failed 且 callback 已安全终止的
  记录，以有界 `SKIP LOCKED` 批次处理。先严格验证并删除 generation/editable 输入对象；
  任一对象清理失败都保留任务行供下轮重试，避免孤儿对象失去追踪。

## 三、调度、HTTP 与存储边界

- `1d83039c`、`2abe86c4`：后端候选过滤下推 SQL，设置每类候选上限，多组先去重再限流；
  指标记录查询数、候选数、租约冲突和选择耗时，调度对拍测试锁定原有车道语义。
- `9b7e58ef`、`9813be89`：统一 `fetchWithDeadline`、组合 abort、正文流式限额与有限错误解析；
  覆盖支付、Adobe、生图、图片回读和注册机等关键路径。
- `ff584c74`：OpenAI moderation 真实中止请求，响应上限 1 MiB，失败继续 fail-closed。
- `f67a7107`、`093c89bb`、`ba73c7a5`：用户大文件经 UOL 获取套餐感知直传授权；创作页
  与无限画布只把对象引用送进 2 MiB 控制面，服务端串行有限读取，降低峰值内存。
- `5405768a`、`38446bfd`：`storage.readObject` 仅允许 Principal 自己的桶/key，并把
  `maxBytes` 收紧到硬上限；输出 schema 明确为 `Uint8Array`，非法实现输出 fail-closed。

## 四、CI、发布与可观测性

- `7b660124` 至 `fc997967`：作为本轮前序基线，完成套餐上下文复用、公开/认证/文档页
  60 秒 ISR、共享会话与客户端依赖收敛、创作页 Promise DAG、SLA 构建期降级、运行时
  站点地址、UOL 身份边界、工具链固定、Docker 原生依赖冒烟与依赖安全补丁。
- `a4de4f49`、`fff3b987`：CI 使用 PostgreSQL 16 执行空库迁移与上一正式版本升级，
  重跑迁移验证幂等并断言关键 schema；正式 tag 不会把自身误当升级基线。
- `4471c0a5`、`48744965`：四组件矩阵只产出 run-scoped `sha-*`；promote 写不可变 exact
  semver 和带四组件 digest 的 OCI release descriptor，最后一次移动 `latest` 或
  `prerelease`。fake-docker 故障注入验证前置失败不会移动 channel。
- `56f6ab35`、`0d8f5e9f`：Sentry 客户端/服务端、`onRequestError`、可选 source map、
  liveness、数据库 readiness 与鉴权 Prometheus 指标落地；未配置 Sentry 时优雅降级。
- `47853b3c`、`464fa5ad`、`d414ef79`：CI 强制 gzip 客户端资源体积预算、公开页与真实登录态
  Lighthouse；Web Vitals 上报 LCP/INP/CLS，登录与采集保持同一 localhost 来源。

## 五、验证边界与残余

本轮通过了相关 DB-free 单测、TypeScript typecheck、Biome 和 Drizzle schema check；完整质量门
以根目录 `turbo lint/typecheck/test/build` 为准。开发机没有 PostgreSQL、Chrome、Docker
Buildx，因此真实迁移、登录态 Lighthouse、跨架构镜像和 OCI descriptor 只能由 CI 验证，
不能把静态配置检查写成真实环境已通过。

仍有两类明确残余：

1. `pnpm audit --prod` 的 esbuild 开发链 1 moderate、2 low，等待 Drizzle/Vite/tsx 上游兼容
   更新，禁止通过未经全量验证的跨 major override 制造表面零告警。
2. 后端池、生图 service/operations、创作页和两处管理面板仍然过大。后续只按
   error-classification、cooldown、协议适配、持久化或独立 UI 面板等真实职责提取，每步保留
   调度对拍或交互回归；不以行数为目标机械拆分。
