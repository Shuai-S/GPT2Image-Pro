# 生图性能优化与渠道并发实施

> 创建日期：2026-07-09
> 适用范围：生图管线的超时分层、413 失败直收、冷却收紧、测活终止、渠道并发
> 提交序列：c9625eaf → 4e6e67d9 → ad42fbba → 0f1b802e → 7ff4edf5 → bbaceac8 → 58b63cf5 + 本文档
> 相关文件已落库，本文件记录设计、风险与回滚信息供后续衔接。

## 一、P0 单次/总超时分层（commit 1-2）

设置项（`packages/shared/src/system-settings/definitions.ts`）新增 `performance`
分类，登记 4 个数值键：

- `IMAGE_PER_ATTEMPT_TIMEOUT_MS`（默认 120000ms、min 5_000、max 1_800_000）
- `IMAGE_TOTAL_TIMEOUT_MS`（默认 1_200_000=20min、min 30_000、max 3_600_000）
- `IMAGE_CONCURRENT_CHANNELS`（默认 1、min 1、max 5）
- `IMAGE_HEALTH_CHECK_TIMEOUT_MS`（默认 90_000、min 5_000、max 180_000）

runtime 注入（`apps/web/src/features/image-generation/service.ts`、`abort-signal-utils.ts`）：
- `mergeAbortSignals` 用 `AbortSignal.any`（Node 20+ 原生）聚合 parentSignal 与
  `AbortSignal.timeout(perAttemptTimeoutMs)`，Per-attempt 超时被 abort 时由
  `retryPoolBackendResult` catch 翻译为 `PER_ATTEMPT_TIMEOUT_ERROR` 文案：
  - 命中 `isRecoverableBackendError`（含 "timed out"）→ 可重试、可切换成员
  - 不命中 `isLocalAbortTimeoutError`（不含 "operation was aborted"）→ 不被当全局超时
- 全局总超时仍冒泡到调用方彻底终止全链
- 三个入口 `generateImage/editImage/generateChatImage` 的 `run` 闭包签名扩展为
  `(candidate, signalOverride?)` 调用方按 `{ ...params, signal: signalOverride }` 覆盖信号

`operations.ts` 把硬编码常量改为读 `IMAGE_TOTAL_TIMEOUT_MS`，`isTimedOut`、
`commonSignal`、`failTimedOutGeneration` 共用同一 `totalTimeoutMs` 窗口避免漂移。

风险：单次超时过短误杀慢上游，运营可在管理后台「性能」分组实时调整。
回滚：直接把设置的 `IMAGE_PER_ATTEMPT_TIMEOUT_MS` 改回较大值即可；代码层把
`retryPoolBackendResult` 的 `perAttemptTimeoutMs` 设为 undefined 即完全回退到
旧的"一条 attempt 等满 20min"行为。

## 二、P1 413 直接失败 + 上游阈值诊断（commit 3）

`isUserRequestBackendError` 与 `USER_INPUT_LIMIT_PATTERNS` 新增 413/414 + 一组
payload too large 文案，让请求体过大被分类为用户错直接返回，不再浪费 unclassified
切换次数。

`getHttpErrorMessage` 6 处调用点（Images/Responses/Adobe）改为先按状态命中
413/414 时走新的 `getPayloadTooLargeMessage`：拼入上游 `content-length`、
`retry-after` 与正文摘要，便于运营在日志里比对"我方阈值 vs 上游阈值"。

前端入口已有 413 拦截保留不动；上游回传的 413 由本分类器拦截。

风险：413 文案匹配靠关键字，若中转使用全新文案（如 "413" 不带 payload 字样）
新文案落入 `isUnclassifiedBackendError` 仍能切换兜底。回滚：从白名单除去这些
新增 includes 即可恢复原 unclassifiedRetry 行为。

## 三、P2 冷却与 dead-relay 收紧（commit 4）

`isDeadRelayBackendError` 拆出 `isServiceTemporarilyUnavailableError`：
"service temporarily unavailable" 不再被当终态踢出，单独走 `classifyFailure`
新增分支 active + overload 冷却桶（落在 isOverloadBackendError 与
isRecoverableBackendError 之间）。

`resolveEffectiveFailureForMember` 在 `failureCooldownEnabled=false` 的 api/adobe
加"最小 30s 缓冲冷却"：原冷却 > now+30s 时截断到 30s；保留确定性 `error` 终态语义。
避免坏后端秒内被连续重选白消耗配额，又不把运营长冷却写入关闭冷却的后端。

测试（`backend-error-classification.test.ts`、`scheduler-selection.test.ts`）：
新增 413 不重试、per-attempt 超时可切换 vs 全局不可切换、502 temporarily
unavailable 不再 error 终态、空成功分类保留 cooldownUntil、并更新既有
"does not cool down" 用例对新缓冲策略的预期。

风险：502 服务暂时不可 用被改走冷却后，可能让坏后端在 cooldown 窗口内仍被其它
moment 命中——但这是直接的"可切后端 + 冷却"行为，比粘性踢出更稳健；管理员在
image-backends tab 可手动停用。回滚：恢复 `isDeadRelayBackendError` 的原始包含
"service temporarily unavailable"。

## 四、P4 测活超时可配置 + 前端手动终止（commit 7-8 两段）

`checkImageBackendApiHealth` 的超时改为读 `IMAGE_HEALTH_CHECK_TIMEOUT_MS`（默认
90000ms，仍受 `[5_000, 180_000]` 钳制）；调用方传 `input.timeoutMs` 仍可显式覆盖。

新增 `/api/admin/image-backend-pool/probe` route：把 `NextRequest.signal` 中继给
`probeImageBackendApi` 的 `AbortController`，使前端 fetch abort 即触发 server
route abort，进而取消上游 fetch；区分"超时自动 abort"与"管理员手动 abort"，
后者 `message: "已手动终止"`、`toast.info` 提示。

`admin-panel.tsx` 的 `runApiHealthCheck` 改用 fetch + AbortController 调本 route；
`testingAbortControllersRef: Map<apiId, AbortController>` 跟踪每条测活的
controller；`测活` 按钮（disabled）旁加 `终止` Button（仅进行中可见）。
`testImageBackendApiAction` 服务端 action 不删（保留给其它调用方），但 admin-panel
不再调用。

`health-check.ts` 顶层 import `@repo/shared/system-settings` 会拖入 DB 连接，
破坏 DB-free 单测；改在 `resolveHealthCheckTimeoutMs` 内动态 import，保持模块
顶层无副作用。

风险：route 模式不再走 next-safe-action 失败重试语义，但测活本就不期望自动
重试；前端 abort 后服务端 fetch 被取消，DB update 仍按 unreachable 写入 lastError。
回滚：admin-panel 复用 `testImageBackendApiAction` 即可恢复 server action 模式。

## 五、新增功能：渠道并发竞赛（commit 9）

`apps/web/src/features/image-generation/dispatch.ts` 的 `dispatchConcurrentChannels`：
- N=1 直接串行 await attemptOne，不引入额外开销。
- N>1 同时启动 N 条 attemptOne（每条带 abortSignal）；任一渠道 discover 成功即调
  `winnerController.abort()` 中止其它渠道，await allSettled losers 后返回胜出结果；
  失败渠道不主动中止其它（"竞赛成功"语义）；全失败返回 `buildAllFailed`。
- 池成员互斥由 `acquireImageBackendInflight` 机制天然处理（无需共享 excludedSet）。
- parentSignal 被外层 abort 时各 channel 同步收到。

`operations.ts` 接入：在 `runGenerationAttempt` 顶部读 `IMAGE_CONCURRENT_CHANNELS`：
- `>1` 且非 Agent 模式 → 调 `dispatchConcurrentChannels` 包装；attemptGeneration 加
  `channelSignal?` 参数（覆盖 commonSignal），fallbackToOpaqueMatte 也透传
  signalOverride 保持取消语义一致。
- channels=1 或 Agent → 直接 await runGenerationAttempt(commonSignal)（原路径）。

不变量保证：
- 扣费幂等单一 generationId；重复扣费被 `consumeResult.alreadyConsumed` 命中撤销。
- `isPendingGeneration` WHERE 子句天然保护：迟到渠道失败分支的 UPDATE no-op。
- lease 清理：失败方 abort 后 retryPoolBackendResult 自动 report（与 P0 一致）。
- 流式事件屏蔽：迟到渠道的 partial_images 等事件不透传（仅胜出渠道事件到客户端）。
- 适用范围：generate、edit（含无限画布生图/编辑调用入口）；瀑布流逐块 maskedOutpaint
  的 editImage 闭包不并发（块内单渠道可靠）；Agent 多轮流式不并发（避免事件流乱序）。

测试（`dispatch.test.ts`，5 用例）：channels=1 串行、N=2 胜出中止输家、全失败回
buildAllFailed、抛错 catch 不阻塞、parentSignal 预 abort 各渠道同步收到。

风险：渠道并发翻倍上游请求量与配额消耗；上限 5 + 默认 1 + Agent 不启用并文档
强调"建议 1-3"。回滚：把 `IMAGE_CONCURRENT_CHANNELS` 设置为 1 即完全退化为
原串行路径。

## 六、质量门与提交节奏

- 全程 `turbo typecheck` / `turbo lint`（DB_POOL_MAX warning 既存）/ `turbo test`
  全绿（65 files / 582 tests）。
- commit 序列：c9625eaf(settings定义) → 4e6e67d9(P0 超时) → ad42fbba(P1 413)
  → 0f1b802e(P2 冷却+分类) → 7ff4edf5(P4 route+abort) → bbaceac8(测活 UI)
  → 58b63cf5(dispatch 并发)。

## 七、待办与后续衔接

- P3（健康检查与慢上游熔断）本轮按用户指示暂不实施，留待 P2 灰度后看线上数据再决定。
- `resolveEffectiveFailureForMember` 当前未导出，30s 最小缓冲目前通过既有
  `reportImageBackendResult` 路径生效；后续可考虑导出便于单测直接断言。
- 本轮手工验证尚未在生产/预发跑：运营调 IMAGE_PER_ATTEMPT_TIMEOUT_MS=30_000 +
  IMAGE_CONCURRENT_CHANNELS=2 验证"慢上游 30s 即切换、并发两渠道先到者胜出"。
- 与工作流 F 的关系：F 关注前端性能（rAF 节流、组件懒加载），与本文件后端 /
  管线主题正交；本轮不大改前端创作页或无限画布，仅 admin-panel 加测活终止按钮。