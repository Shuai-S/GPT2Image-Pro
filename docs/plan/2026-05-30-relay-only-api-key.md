# 纯中转 API Key（Relay-Only / Passthrough）实现计划

> 2026-05-30。基于多 Agent 探查（`docs/` 工作流结论）。分支 `dev`。
> **状态：已实现并通过对抗式审查。** 提交：7c6da21 / bec842a / 8400260 / 48b717d / 6210de4 / e957f48 / 80be167。
> 4 包 typecheck 通过；154 测试（shared 45 + web 109）全过。对抗式审查 = 17 误报 + 2 低危确认（均已修复于 80be167）。
> **待用户做端到端 UI 实测**（见 `docs/TODO.md`）。

## 目标

给外部 API Key 增加 **per-key 的"纯中转"开关**：开启后，该 key 发起的 v1 请求
**不写历史记录、不可在站内查看、不上传对象存储、不额外占用服务器存储**，
保护用户隐私；但**仍正确扣费、仍走内容审核**（合规）、仍计 per-key 额度。

## 已确认的产品/安全决策（用户拍板）

1. **保留内容审核**：中转 key 仍走 `moderateContent`（prompt/图片会发给第三方审核服务）。平台是产图法律主体，审核只作闸门、不持久化内容，与"不存历史"不冲突。
2. **一并修复扣费幂等**：给 `consumeCredits` 增加请求级 `sourceRef` + `credits_transaction (type, source_ref)` 偏唯一索引，对齐现有 `grantCredits`/退款的幂等设计。**向后兼容**：不传 `sourceRef` 时行为完全不变。
3. **图片按 `response_format` 自动返回**：`b64_json`→内联 base64（零回源）；`url`→直返上游绝对 URL。
4. **仅 Pro 及以上**可把 key 设为纯中转（新增能力位 `externalApi.relay` 默认 `pro`，admin 可配）。

## 关键架构事实（探查结论）

- 5 个 v1 handler（image-generations / image-edits / agent-images / chat-completions / responses）最终都汇入 `apps/web/src/features/image-generation/operations.ts` 的同一管线（`runImageGenerationForUser` → 内部 `runImageGenerationCore`），**单点改造可覆盖**。
- 现状流：鉴权 → `db.insert(generation)`(pending, 1238) → 预留 key 额度 → `consumeCredits` 扣费 → `moderateContent`(1507) → 调上游 → `storeGeneratedImageOutput`→`putObject` 上传 S3/R2(689) → 结算 → `db.update(generation)`(completed, 2059)。
- 默认 `response_format=b64_json`；现状 b64 靠 `images.ts:getImageBase64` **回源 `/api/storage` 并转发客户端 Authorization** 再编码。
- **财务真相在 `credits_transaction`（双重记账），不在 `generation` 行**。`generation` 行只是历史/画廊展示。→ 跳过 `generation` 行不破坏对账。
- 退款用 `grantCredits` 带 `sourceRef`（落 `credits_batch`，与 `generation` 行无关）→ 已幂等，中转跳过 `generation` 行仍能正常退款。
- `consumeCredits`（charge 路径）**无 `sourceRef`**，非幂等 → 既有隐患（决策 2 修复）。
- `ImageGenerationOperationResult.imageOutputs` 类型 = `GenerateImageResult["imageOutputs"]`，**已含可选 `imageBase64`**；但结果构造(2122)未填充。响应层(`images.ts`)对绝对 http(s) URL 已直接放行。

## 数据模型改动

1. `external_api_key` 新增 `relay_only boolean NOT NULL DEFAULT false`（迁移 `0026`）。
2. `credits_transaction` 新增 `source_ref text`（可空）+ 偏唯一索引 `(type, source_ref) WHERE source_ref IS NOT NULL`（迁移 `0027`）。
3. 类型层（非 DB）：`StoredGeneratedImageOutput` 增加可选 `imageBase64`、`storageKey` 允许空串。

## 中转模式下：保留 vs 跳过

**必须保留**：鉴权 + 计划能力校验；`reserveExternalApiKeyCredits`/`consumeCredits`/结算/退款；per-key `lastUsedAt`/`creditsUsed`；`moderateContent`。

**跳过**（仅当 `relayOnly`）：`db.insert(generation)` 及其全部 `UPDATE`（无行时自然 no-op，但须绕开 `failTimedOutGeneration` 的 `.returning()` 依赖）；`storeGeneratedImageOutput` 的 `putObject` + `uploadResponsesImageFile`；`generation.metadata` 内容字段；Responses 续承持久化 `storeResponsesContinuation`；实际尺寸检测落库。

## 任务分解（每步 TDD + 提交）

### Task 1 — Schema + 迁移（基础，低风险）
- `packages/database/src/schema.ts`：`externalApiKey` 加 `relayOnly`；`creditsTransaction` 加 `sourceRef` + 偏唯一索引（参照 `creditsBatch` 现有写法）。
- 手写迁移 `0026_external_api_key_relay.sql`、`0027_credits_transaction_idempotency.sql`（幂等 `IF NOT EXISTS`）+ `meta/_journal.json` 两条目（idx 26/27）。
- 验证：`turbo typecheck`（database 包）。

### Task 2 — consumeCredits 幂等（财务核心，TDD 先行）
- `packages/shared/src/credits/core.ts`：`ConsumeCreditsParams` 加可选 `sourceRef`；事务内：先按 `(type='consumption', sourceRef)` 查已存在交易 → 命中即返回幂等结果（不再扣批次）；否则正常扣费并写入带 `sourceRef` 的交易，靠偏唯一索引兜底并发（第二个 INSERT 唯一冲突 → 整事务回滚 → catch 后重查返回幂等结果）。
- 不传 `sourceRef` → 走原路径，零行为变化。
- 测试：`packages/shared` vitest — 顺序重复同 `sourceRef` 只扣一次；不同 `sourceRef` 各扣；无 `sourceRef` 行为不变；并发模拟。

### Task 3 — Auth + Settings Action + Pro+ 闸门
- `plan-capabilities.ts`：`PLAN_CAPABILITY_KEYS` + `DEFAULT_PLAN_CAPABILITY_MATRIX.features` 加 `"externalApi.relay": "pro"`。
- `auth.ts`：SELECT + 返回对象加 `relayOnly`。
- `external-api-key.ts`：`createExternalApiKey` 入参/INSERT 支持 `relayOnly`（仅当 `canUsePlanCapability(plan,"externalApi.relay")`，否则忽略/报错）；新增 `updateExternalApiKeyRelay`；`getExternalApiKeys` 返回 `relayOnly`。

### Task 4 — Settings UI
- `external-api-key-section.tsx`：创建表单加"纯中转/隐私模式"开关（仅 Pro+ 可见可用）；每个 key 卡片显示 relay 标记 + 切换；明确文案告知：**该 key 无生成历史、画廊不可见、图片不留存**。

### Task 5 — operations.ts 中转分支 + 类型
- `RunImageGenerationInput` 三个 mode 分支加 `relayOnly?: boolean`；core 函数参数透传 `relayOnly`。
- `relayOnly` 时：跳过 `db.insert(generation)`（仍生成 `generationId` 仅作 sourceRef）；所有 `db.update(generation)` 用 `if (!relayOnly)` 包裹（含 `failTimedOutGeneration` 的 `.returning()` 路径）；存储循环改为直接由 `imageOutputs` 构造 `storedOutputs`（携带 `imageBase64`/上游 `imageUrl`，`storageKey=""`，`fileSize=0`，`size=requestedSize`）；跳过 `uploadResponsesImageFile`。
- 结果构造(2122)与最终 imageUrl：填充 `imageBase64: output.imageBase64`。
- 初始扣费(1401)传 `sourceRef: ${generationId}:charge`（决策 2）；结算 charge 分支用 `${sourceRef}:charge` 区分，避免误判重复导致少扣。

### Task 6 — Handlers + responses + images.ts
- 5 个 handler：构造 input 时 `relayOnly: auth.relayOnly`。
- `responses.ts`：`relayOnly` 时跳过 `storeResponsesContinuation` 及续承内存缓存写入。
- `images.ts`：`toOpenAIImageData`/`toOpenAIImagesResponse` 优先用 `output.imageBase64` 出 `b64_json`（不回源）；`url` 模式直返上游绝对 URL。

### Task 7 — 文档 + TODO
- 更新 `docs/MEMORY.md`、`docs/TODO.md`、本计划完成状态。

## 已知边界 / 残留（写入 TODO）

- **async/stream/callback** 模式下含 base64 的结果会短暂驻留进程内存、callback 会 POST 到用户回调 URL——非落盘落库，但与"零服务器存储"字面有张力。中转默认仍允许 async；若用户要求绝对零驻留再单独禁用。
- 扣费幂等是**请求级（按 generationId）**，可防同一 generationId 重复执行；**跨请求客户端重试**仍需客户端传 `Idempotency-Key`（未来项）。
- `url` 模式 + 上游仅给 base64（无 URL）时无法给出 http URL（我们不落存储），退化为 `data:` URI 或要求用 `b64_json`。中转上游（网关 `/v1/responses`）通常返回 base64，默认 `b64_json` 为常态路径。
