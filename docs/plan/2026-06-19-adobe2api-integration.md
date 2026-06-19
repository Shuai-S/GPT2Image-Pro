# adobe2api 接入设计（Adobe Firefly：图像后端 + 模型生态 + 视频）

> 计划文档。覆盖三期接入 `leik1000/adobe2api`（Adobe Firefly 网关）。
> 状态：设计稿（部分上游契约待本地探活验证，见 §8）。日期：2026-06-19。

## 1. 背景与目标

`adobe2api` 把 Adobe Firefly 的图像/视频生成包成 OpenAI 兼容网关，自管 Adobe 账号 cookie 池与自动刷新，模型目录含 Nano Banana / Nano Banana Pro / GPT Image / Sora2 / Veo3 / Kling 3.0 / Kling O3。

按产品决策分三块接入：

- **A. Adobe 的 GPT Image 作为现有图像管线的可选后端**——对用户透明，复用现有创作页与调度。
- **B. 其余图像模型（Nano Banana 等）独立成生态**——新创作 tab + Adobe 账号管理 + Entities 一致性管理。
- **C. 视频生成**——全新创作 tab，支持图生视频并可 @ 引用历史/画廊里已生成的图像。

非目标（本设计不含）：把 Adobe 模型塞进通用外接 API（pool-api）；改动 Adobe 账号鉴权模型（账号池由 adobe2api 自管）。

## 2. adobe2api 契约摘要

- **模型 id 编码一切**：图像 `firefly-<model>-<res>-<ratio>`（如 `firefly-gpt-image-2k-16x9`、`firefly-nano-banana-pro-4k-16x9`）；视频 `firefly-<model>-<duration>-<ratio>[-<res>]`（`sora2`/`sora2-pro`/`veo31`/`veo31-ref`/`veo31-fast`/`kling3`/`kling-o3`）。宽高比/分辨率/时长不是独立参数，拼进 model id。
- **取值域**：ratio `1x1/16x9/9x16/4x3/3x4`（Nano Banana 2 另支持 `1x8/1x4/4x1/8x1`）；res 图像 `1k/2k/4k`、视频 `720p/1080p`；duration `4s/5s/6s/8s/10s/12s/15s`（按模型）。
- **接口**：`/v1/chat/completions`（统一，messages content 支持 `image_url`=http 或 `data:image/...;base64,` → 图生图/图生视频）、`/v1/images/generations`、`/v1/entities`（Kling O3 一致性，prompt 内 `@entity:name`）、`/v1/models`。
- **图生视频**：1 图=首帧；2 图=首+尾帧；`veo31-ref`=1–3 张参考。
- **鉴权与账号**：Service API Key（`Authorization: Bearer` 或 `X-API-Key`）；Adobe 账号经浏览器插件导出 cookie → 导入 adobe2api token 池、自动刷新（账号池在 adobe2api 侧）。媒体落 `data/generated/`、`/generated/*` 提供。
- **Entities**：`POST /v1/entities`（name/type=character|object|location/description/images=1–4 张 base64）；`GET /v1/entities[?sync=true]`；prompt 内 `@entity:name` 引用；同一 prompt 多 entity 须同一 Adobe 账号（服务自动解析）。

## 3. 总体架构与数据模型

### 3.1 专用后端类型 "adobe"

后端池现有成员（`packages/database/src/schema.ts`）：`imageBackendGroup` / `imageBackendAccount`(+`...Group`) / `imageBackendApi`(+`...Group`)，调度复用 `imageBackendInflightLease` / `imageBackendStickyBinding` / `imageBackendSchedulerMetric`。

新增 **`imageBackendAdobe`** 表（与 `imageBackendApi` 平级，但带 Adobe 专属字段）：
- `id, groupId, name, baseUrl, apiKey(密文), isEnabled, priority, concurrency, status, cooldown_until, last_error..., always_active`（复用现有调度字段语义）。
- `enabledModels jsonb`（暴露哪些 model 家族）、`defaultRatio / defaultResolution`、`supportsVideo bool`。
- 复用 `imageBackendApiGroup` 同构的 `imageBackendAdobeGroup` 关联多分组。

> 之所以独立而非塞进 `imageBackendApi`：model-id 编码宽高比/分辨率/时长、entities、视频、cookie 账号池——通用 OpenAI-images 适配器表达不了，强塞会丢能力且尺寸/模型对不上。

### 3.2 适配层 `packages/shared/src/.../adobe/`（或 image-generation 内新模块）

- `composeAdobeModelId({family, resolution, ratio, duration?})` → `firefly-...` 字符串。
- `mapSizeToAdobe(sizeWxH)` → 最近的 `{ratio, resolution}`（Phase 1 用；新 tab 直接暴露枚举不走映射）。
- `buildAdobeRequest(kind, params)` → `/v1/chat/completions` 或 `/v1/images/generations` body；参考图编码为 base64 data URL 放入 messages content。
- `parseAdobeResponse(resp)` → 统一产物（图像 b64/url；视频 url），含 **异步轮询**封装（见 §8 待验证）。
- 媒体 **re-host**：把 adobe2api `/generated/*` 产物拉回我方对象存储（沿用 pool-api 输出 re-host 逻辑），不长期依赖其本地盘。

### 3.3 数据模型新增

- `imageBackendAdobe`(+group) — §3.1。
- `generation` 扩展产物类型：新增 `mediaType`（`image`|`video`，默认 image）与视频字段（`durationSeconds`、视频 storageKey）；或新建 `videoGeneration` 表（与 generation 解耦，避免污染图像热路径）。**倾向新表**（视频状态机、轮询、计费维度都不同）。
- `adobeEntity` 表（id, userId/accountScope, name, type, description, 关联图 storageKey, adobeEntityRef）——Entities 管理。
- 迁移按规范手写 + 登记 `meta/_journal.json`（不用 drizzle-kit generate）。

## 4. Phase 1 — Adobe GPT Image 作为图像后端

目标：最小闭环，复用现有创作页与单一图像管线（`operations.ts: runImageGenerationForUser`）。

- 后端：`imageBackendAdobe` 成员（带 `firefly-gpt-image` 能力）纳入池调度（`image-generation/service.ts` 的池解析新增 adobe 分支，与 pool-api / pool-account 并列）。
- 请求：生成 → `mapSizeToAdobe(size)` → `firefly-gpt-image-{res}-{ratio}` → `/v1/images/generations`（或 chat/completions）；图生图 → `/v1/chat/completions` + 输入图 base64 data URL。
- 响应：`parseAdobeResponse` → 现有图像产物结构 → re-host → 画廊/历史照常。
- 调度/冷却/故障转移/粘性：复用现有池机制（错误分类新增 adobe 错误形态映射）。
- 计费：沿用图像计费（`plan-capabilities` / credits），按现有 size 维度（映射前的请求 size）。
- admin：后端池新增 "Adobe" 后端表单（baseUrl + apiKey + 启用模型 + 默认 ratio/res）。
- UOL：图像生成既有 operation 复用（后端选择是池内部细节，无需新 operation）。

交付校验：起本地 adobe2api + 一个 Adobe 账号，创作页文生图/图生图命中 adobe 后端出图、尺寸符合预期。

## 5. Phase 2 — Firefly 生态 tab + 账号管理 + Entities

- **新创作 tab “Firefly / Adobe”**（`create-page-client.tsx` 的 Tabs 体系新增；或独立路由页）：
  - 模型选择（Nano Banana / Nano Banana Pro / 其余图像家族），**直接暴露宽高比 + 分辨率枚举**（不走 WxH 映射）。
  - 文生图 / 图生图（@ 历史图作输入）。
  - Entities 面板：创建/列出/在 prompt 用 `@entity:name`（角色/物体/场景一致性）。
- **Adobe 账号管理（admin）**：对接 adobe2api 的 token 端点——导入 cookie（粘 JSON / 上传）、查看账号池与刷新状态、配置 endpoint+API Key。账号实际池仍在 adobe2api 侧；我方只做管理代理 + 展示。
- 数据：`adobeEntity` 表；生态模型走 Phase 1 的 adobe 适配层（同一后端类型，按 model 家族分流）。
- UOL：新增 `adobe.generateImage` / `adobe.listModels` / `adobe.entities.*` operation（遵循 UOL-first：先接口后 UI/agent）。
- 能力位：在 `plan-capabilities.ts` 增 Firefly 生态相关能力位（套餐门槛），并同步 `system-settings/definitions.ts` 与 panel（否则同步测试失败）。

## 6. Phase 3 — 视频生成 tab + 图生视频

最大一块；视频是全新产物类型。

- **数据/状态机**：`videoGeneration` 表（status: pending/running/completed/failed，model、duration、ratio、resolution、输入图引用、storageKey、credits）。
- **异步生成**：视频生成耗时长，几乎必为异步——需先确认 adobe2api 的 job/poll 协议（§8）。落地为：提交 → 轮询（复用内置定时任务/或前端轮询）→ 完成 re-host。
- **新创作 tab “视频”**：选模型（Sora2 / Sora2 Pro / Veo3 系 / Kling 3.0 / Kling O3）+ 时长 + 宽高比 + 分辨率。
- **图生视频 @ 历史图**：从画廊/历史选已生成图作首帧（1 图）/首+尾帧（2 图）/参考（veo31-ref 1–3）；传 base64/url 给 adobe2api。
- **画廊/历史**：支持视频展示与播放、下载；缩略图/封面。
- **计费**：新维度——按 模型 × 时长 × 分辨率 定价；接入 credits（预扣/结算/退款，带幂等 sourceRef）。
- UOL：`adobe.generateVideo` / `adobe.video.status` operation。
- 能力位：视频能力位（套餐门槛，默认较高套餐）。

## 7. 横切关注点

- **存储**：所有 adobe 产物 re-host 到我方对象存储；不依赖 adobe2api 本地盘（其有自动清理）。
- **计费**：图像沿用现有；视频新增维度。所有扣费/退款带幂等键（`credits_transaction (user_id, type, source_ref)`）。
- **调度**：adobe 后端复用池的并发租约、冷却、故障转移、粘性、SLA 指标；新增 adobe 上游错误 → 错误分类映射（限流/账号失效/内容审核）。
- **审核**：adobe 产物同样过本站审核管线（fail-closed 透传策略不变）。
- **UOL-first**：每个 adobe 能力先在 `uol/operations/adobe.ts` 暴露 `defineOperation`（Zod schema、权限、能力位、幂等、副作用声明），传输层（server action / api-route / 内置 agent）只做薄适配。
- **admin**：后端池加 Adobe 后端类型；新增 Adobe 账号 / Entities 管理页。

## 8. 待验证未知（实现前必须探活 adobe2api）

文档未明确，需本地起服务 + 真实账号抓样例：
1. **视频是否异步 / job-id + 轮询协议**（决定 Phase 3 状态机）——几乎必为异步。
2. **响应确切结构**：图像（`data[].url` vs `b64_json`；chat 的 `choices[].message.content` 是 url 还是 base64）；视频媒体 URL 位置。
3. **错误格式与限流**（错误分类映射、冷却策略）。
4. **`/v1/images/generations` 是否支持图生图**，还是图生图只能走 `/v1/chat/completions`。
5. **媒体 URL 时效**（`/generated/*` 是否需鉴权 / 过期 → re-host 时机）。

## 9. 风险

- **Adobe ToS / 封号**：用导出 cookie 驱动 Firefly 属灰色（同 sub2api/cliproxyapi 类）；账号易被封，cookie 导入是手工流程。运营需账号池 + 监控 + 易替换。
- **三方依赖**：`adobe2api`（个人维护）作为独立服务隔离部署；版本与协议可能变，适配层要容错。
- **视频范围**：是 gpt2image 从未有过的产物类型，牵动产物模型/画廊/计费/轮询/播放/下载——投入最大。
- **尺寸损失**：Phase 1 的 WxH→宽高比映射有损；新 tab 直接暴露枚举规避。

## 10. 分期与里程碑

1. **Phase 0（前置）**：本地起 adobe2api + 1 Adobe 账号，抓图像/视频/entities 真实请求-响应（解决 §8）。
2. **Phase 1**：adobe gpt-image 专用后端接入现有图像管线（数据模型 `imageBackendAdobe` + 适配层 + admin 后端表单 + 调度复用）。
3. **Phase 2**：Firefly 生态 tab（其余图像模型）+ Adobe 账号管理 admin + Entities。
4. **Phase 3**：视频产物（`videoGeneration` + 异步轮询）+ 视频创作 tab + 图生视频 @ 历史图 + 视频计费 + 画廊播放。

每期独立可上线（dev→蓝绿/灰度）。Phase 0 的探活结论回填本文档 §8 后再开 Phase 1 编码。

## 11. 开放问题（需产品确认）

- 视频计费口径（按时长×分辨率×模型的具体单价 / 套餐门槛）。
- Entities 的归属与配额（per-user vs 全站；与 Adobe 账号绑定关系如何对用户呈现）。
- Adobe gpt-image 与现有 codex/web gpt-image 在调度上的优先级/分组策略。
- Firefly 生态 tab 与现有创作页的导航关系（同页签 vs 独立入口）。
