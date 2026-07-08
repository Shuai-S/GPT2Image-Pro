# 对话式生成可编辑 PPT/PSD（editable file: ppt/psd）

> 设计文档。把 basketikun/chatgpt2api 的 PPT/PSD「可编辑文件」生成能力接入我们自己的栈
> （统一账号池 / 计费 / storage / 风控），以类官方对话式 tab 提供,并对外暴露 `v1/ppts`、`v1/psds`。

## 1. 目标与背景

- 用户可在创作页以「对话式 tab」生成**可编辑 PPT（.pptx）/ PSD（.psd）**文件,类似官方 ChatGPT 的对话产文件体验。
- 创作页 tab 调整:原 `chat` → 改名 **chat(codex)**;新增 **chat(web)**（纯 web 对话）、**ppt**、**psd** 三个 tab。
- 对外 API:新增 `POST /v1/ppts`、`POST /v1/psds`（异步任务）+ 任务查询 + 产物下载。
- 套餐能力:新增 `export.ppt` / `export.psd`,**默认开放 free**（已落地,见 §10）。
- 文档:README + 本设计文档 + docs/TODO + 接口盘点表同步。
- **决策已定**:①在我们栈内重实现(不代理外部 chatgpt2api);②按任务固定价扣积分。

## 2. 机制（从 chatgpt2api 逐字还原,非 gizmo）

PPT/PSD 产出**不依赖任何 gizmo / tools / tool_choice**,靠三样:

- `model = "gpt-5-5-thinking"`（注意双 5）
- `thinking_effort = "extended"`
- `system_hints = []`（普通生图那条是 `["picture_v2"]`,此处必须空）

配一段**固定中文提示词**驱动 ChatGPT 内建的「生图 + 代码解释器(Python 沙盒)」把素材拼成
`.pptx`/`.psd` 写到 `/mnt/data`,再从会话结果里抠沙盒路径/附件 file_id,换下载链接拉二进制。

提示词模板(移植 chatgpt2api `_editable_prompt`,PPT/PSD 两段硬编码 + 用户补充需求):

- PPT:「制作一个可以编辑的 PPT」,三步——①用生图方式生成 5-6 页精美 ppt;②把所有图像/形状素材拆成单独 png;③用这些素材还原第一次生成的 ppt(导出可编辑文件)。
- PSD:「生成这个图像,把海报分成若干图像…再把拆分的图像拼合成一个 psd 文件」。
- 追加:`"以下是用户补充需求,请直接结合执行:\n" + <用户输入>`。

### 2.1 端点与调用链（复用我们现有 web 对话链路）

1. 上传输入图（PSD 必需,PPT 可空）:`uploadAttachment`（已有,`POST /backend-api/files` → PUT Azure → `POST /files/{id}/uploaded`）。
2. 预备会话:`POST /backend-api/f/conversation/prepare` → conduit_token（复用 `prepareImageConversation` 骨架,改 payload,见 §5）。
3. 发起会话:`POST /backend-api/f/conversation`,message `content_type=multimodal_text`,parts 带上传图 asset_pointer + prompt。
4. 轮询:`GET /backend-api/conversation/{conversation_id}`,直到**同时**凑齐「主文件(.pptx/.psd)」与「.zip」。
5. 产物提取（移植 `_extract_editable_artifacts`）:遍历会话 mapping,按 `create_time` 排序,对每个 assistant/tool 消息——
   - `message.metadata.attachments`（每项 id/name/mimeType/size,可能含 file_id）;
   - 递归遍历消息内嵌 dict 找 artifact 对象;
   - 正则在消息文本/序列化 JSON 上抠沙盒路径。
   - 正则:PPT `(?:sandbox:)?(/mnt/data/[^\s"'\)\]]+\.(?:pptx?|zip))`;PSD `…\.(?:psd|zip)`;asset pointer `(?:file-service|sediment)://([A-Za-z0-9_-]+)`。
   - 产物字段:`{ attachmentId, fileId, name, mimeType, sandboxPath, messageId }`。
6. 下载 URL 解析（移植 `_resolve_editable_download_url`,按序试 4 个端点直到拿到 `download_url`|`url`）:
   1. `GET /backend-api/conversation/{id}/interpreter/download?message_id=&sandbox_path=`（代码解释器产物主路径）
   2. `GET /backend-api/conversation/{id}/attachment/{attachmentId}/download`
   3. `GET /backend-api/files/download/{fileId}`（post_id="" & inline="false"）
   4. `GET /backend-api/files/{fileId}/download`（复用现有 `getDownloadUrl`）
7. 下载二进制 → 存进站内 storage → 返回签名 URL。

MIME 白名单(识别产物类型):PPT = `…presentationml.presentation` / `application/vnd.ms-powerpoint`;PSD = `image/vnd.adobe.photoshop` / `application/vnd.adobe.photoshop`。

## 3. 可行性与硬阻塞（诚实标注）

链路 90% 现成:`chatgpt-web.ts` 已是「web 对话产出可下载文件」的完整实现(PoW/Sentinel/账号池/`getDownloadUrl` 已打 `/backend-api/files/{id}/download`)。真正新增的是「非图片产物识别 + 二进制承载 + 请求体去图片化 + 长任务 DB 态 + 账号能力打标」。

硬阻塞/必须验证:

1. **账号能力**:产物依赖「代码解释器 + `gpt-5-5-thinking` 灰度模型」,限 Plus/Pro。**已核实账号 plan_type 存于 credentials JSON、有现成 plan 筛选范式**(见 §8),故只调 plus/pro 账号可行,风险基本解除;仍需实测这些账号能否吃 `gpt-5-5-thinking`(见 §13 第 2 步)。
2. **模型 slug 可用性**:`gpt-5-5-thinking` + `thinking_effort=extended` 是特定灰度,须实测;上游改版会整条失效(硬编码常量脆弱)。
3. **长任务 × 多实例**:分钟级(上游 600s 超时),现网 3308/3307 双实例 + 现有 async-image-tasks 是进程内内存态 → 轮询命中另一实例即丢任务。**必须 DB 落库任务态**(见 §4)。
4. 产物解析脆弱:沙盒路径/附件结构随上游会话树漂移,正则/遍历易碎(同 codex 组多轮怪癖历史坑)。
5. 生成时长/成本:分钟级 thinking + 代码解释器,占账号久、并发低、易撞 image_gen 滚动限流;须独立冷却/超时,别拖垮出图主链路(SwinIR 事故教训:重后处理别挂同步主链路)。

## 4. 数据模型（迁移:新表 editable_file_task）

长任务必须跨实例可查,故新建轻量表(手写幂等 SQL + 登记 `meta/_journal.json`,不用 drizzle-kit generate):

```
editable_file_task
  id            text pk            -- 内部任务 id (uuid)
  user_id       text not null      -- 归属(越权校验)
  api_key_id    text null          -- 外部 API 来源(计费/审计)
  client_task_id text null         -- 幂等键(对齐 chatgpt2api)
  kind          text not null      -- 'ppt' | 'psd'
  status        text not null      -- 'queued'|'running'|'success'|'error'
  prompt        text not null
  conversation_id text null
  primary_url   text null          -- 主文件签名 URL (.pptx/.psd)
  zip_url       text null          -- 素材/图层 zip 签名 URL
  error         text null
  credits_charged integer null     -- 已扣积分(退款/审计)
  created_at    timestamptz not null default now()
  updated_at    timestamptz not null default now()
  -- 索引: (user_id, created_at desc); (client_task_id) 幂等查重
```

## 5. 后端管线

### 5.1 chatgpt-web.ts（新增,复用私有原语,不动图片路径）

在 `chatgpt-web.ts` 内新增(复用 `getChatRequirements`/`uploadAttachment`/`imageHeaders`/`fetchChatGptWeb`/`readSseText`/`extractConversationId`/`getConversationText`/`conversationNodesAfterMessage`/`webErrorMessage`):

- `EDITABLE_FILE_MODEL="gpt-5-5-thinking"`、`EDITABLE_FILE_THINKING_EFFORT="extended"`、PPT/PSD 提示词常量、MIME 白名单、三个正则。
- `prepareFileConversation`/`startFileConversation`:照 image 版但 payload 改为 `model=EDITABLE_FILE_MODEL`、`thinking_effort="extended"`、`system_hints:[]`、去掉 `paragen_*`/`force_parallel_switch`;message 用 `multimodal_text` + attachments。
- `extractFileArtifacts(conversationText, requestMessageId)`:按 §2.1 步骤 5 提取 `FileArtifact[]`。
- `resolveFileDownloadUrl(config, artifact)`:按 §2.1 步骤 6 四端点顺序试。
- `downloadFileBinary(config, artifact)`:解析 URL → fetch arrayBuffer → 返回 `{ buffer, fileName, mimeType, size }`(不转 base64,保留 mime)。
- `pollFileArtifacts`:套现有 poll 骨架,命中条件=同时有主文件 + zip;独立超时(建议 ~10min,`IMAGE_POLL_TIMEOUT_MS=120s` 太短)。
- 导出 `generateFileWithChatGptWeb({ config, kind, prompt, base64Images })` → `{ conversationId, primary: {buffer,fileName,mimeType,size}, zip?: {...} }`。

### 5.2 editable-file-operations.ts（新增,编排+计费+storage+DB）

- `runEditableFileForUser(input)`:①能力/账号解析 → ②建 `editable_file_task`(queued)→ ③调度到「有代码解释器能力」后端组(仿 codex 组打标),否则快速失败 → ④`generateFileWithChatGptWeb` → ⑤产物存 storage(key `{userId}/{nanoid}.pptx`/`.psd`/`.zip`,复用 `/api/storage` 路由,别新造)→ ⑥更新 task(success + primary_url/zip_url)→ ⑦**按任务固定价 `consumeCredits`**(幂等键 sourceRef=`editable-file:{taskId}`;API 来源走 reserve/refundExternalApiKeyCredits)。失败置 error,不扣或退款。
- 长任务执行方式:提交即建 task 返回 queued;实际生成在**后台**跑(不阻塞请求线程 > 数秒),前端/API 轮询 DB task。避免同步长链路拖垮主进程。

## 6. 计费（按任务固定价,已决)

- 新增运行时设置 `EDITABLE_FILE_PPT_CREDITS` / `EDITABLE_FILE_PSD_CREDITS`(后台可配,**默认各 25 积分**,已定)。
- 扣费在 service 内(`consumeCredits` 双重记账,幂等键 `(user_id, type, source_ref)`);外部 API 走 `reserveExternalApiKeyCredits` + 失败 `refundExternalApiKeyCredits`。handler 不碰钱。
- 幂等:`client_task_id` 作对外幂等键;内部 `task.id`=uuid;计费 sourceRef=`editable-file:{taskId}`。**生成失败退款/不扣**。

## 7. v1 接口契约（对齐 chatgpt2api 便于生态兼容）

- `POST /v1/ppts`、`POST /v1/psds`:body `{ client_task_id?: string, prompt: string, base64_images: string[] }`(data URL 数组;PSD 强校验非空,空报 `base64_images is empty`)。立即返回 `{ object:"editable_file_task", id, taskId, status:"queued", kind }`。
- 查询:`GET /v1/editable-file-tasks?ids=<a,b>` → `{ items:[ { id, taskId, status, kind, created_at, updated_at, elapsed_seconds, result?, error? } ], missing_ids:[] }`;`result = { conversation_id, primary_url, zip_url }`(我们的 storage 签名 URL)。
- 下载:产物直接给站内 storage 签名 URL(不复刻 chatgpt2api 的 `/files/{path}` 自托管路由,统一走 `/api/storage`)。
- 鉴权:`authenticateExternalApiRequest`(Bearer→hashApiKey);门禁 `canUsePlanCapability(plan, "export.ppt"|"export.psd")`。
- 路由镜像两棵树:`app/api/v1/ppts/route.ts` + `app/v1/ppts/route.ts`(psds 同),任务查询 `.../editable-file-tasks`。handler `ppt-generations.ts`/`psd-generations.ts`/`editable-file-tasks.ts`,裹 `withApiLogging`,模板照 `video-generations.ts`/`video-tasks.ts`(同为长任务异步)。

## 8. 账号能力打标

- **已核实**:账号 `plan_type`(free/plus/pro)存在账号 `credentials` JSON(`credentials->>'plan_type'`);系统已有 `Sub2ApiPlanFilter = "all"|"free"|"plus"|"pro"|"non_free"` + 现成 SQL 按级别筛选(service.ts:5639-5732,目前用于 sub2api 同步导入);`getChatGptWebAccountInfo` 也能实时读 plan_type(chatgpt-web.ts:581)。
- 故 PPT/PSD 调度**只需加一条「只选 plus/pro 账号」约束**(复用 `credentials->>'plan_type'` 筛选范式),无需另建打标机制。
- **注意**:plan_type 对 sub2api 同步来源的账号可靠有;非同步来源可能未存 → 保守排除(或用 `getChatGptWebAccountInfo` 回填)。
- 无可用 plus/pro 账号 → 明确错误「no available plus/pro account」,前端引导。
- **两层门要在文档/UI 讲清**:套餐层 free 放开 ≠ 账号层可用,避免免费用户点了必失败的困惑。

## 9. UI tab 改造（create-page-client.tsx,9675 行）

每个新 tab「8 处硬清单」:`ActiveMode` 联合类型 / `readStoredCreateActiveMode` 白名单 / `TabsTrigger` / `onValueChange` 门禁 / tabpanel / 对话式还需 `isConversationMode`+`getConversationMode`+`activeModeToConversationMode`+会话分桶 / 能力位 / 后端 route。

- **chat → chat(codex)**:先只改文案(`copy("Chat (Codex)","对话(Codex)")`);「是否语义锁死走 codex/responses」列为后续可选(默认只改名)。
- **chat(web)**:新增纯 web 对话 tab(强制纯 web 后端,置灰 image_model/quality/exact-size,同 `isWebOnlyBackend`)。
- **ppt / psd**:对话式 panel(照 chat/agent 复用流式/附件/历史);产物是文件 → 消息气泡加「文件卡片(文件名+下载按钮)」;提交打 `/v1/ppts|psds`(或内部 route)+ 轮询任务态,状态中文映射 queued=排队中/running=生成中/success=已完成/error=失败;PSD tab 强制先上传图。
- 面板抽独立子组件 `editable-file-panel.tsx`(避免继续肥化 9675 行单体,参考 video 范式)。

## 10. 套餐能力位（已落地）

已加 `export.ppt`/`export.psd` = `"free"`(提交 e2cb13e):plan-capabilities KEYS+matrix、system-settings 示例、后台 FEATURE_ROWS、同步测试断言。

## 11. UOL（接口先行）

`packages/shared/src/uol/operations/editable-file.ts`:`file.generatePpt`/`file.generatePsd`（`defineOperation`,Zod schema,idempotency keyField=`clientTaskId`,sideEffects=`["external-call","storage","credits"]`,能力位复用 export.ppt/psd）,`uol-bindings.ts` `bindExecute` 委托同一 service。REST handler 与 UOL 共用 service。登记进 `docs/plan/2026-05-31-feature-interface-inventory.md`。

## 12. 文档/README 同步

- README:能力概览加 `POST /v1/ppts`、`POST /v1/psds` + 异步任务查询;核心特性加「对话式生成可编辑 PPT/PSD」;写清账号能力门槛;TODO PSD 接口勾除并补 PPT。
- docs/TODO.md:更新 PSD、补 PPT。
- docs/plan/2026-05-31-feature-interface-inventory.md:登记两个 UOL 操作。
- CLAUDE.md/AGENTS.md 若列端点清单则两处逐字同改。

## 13. 测试与验证顺序（先验证再做重 UI）

1. plan caps(已过测)。
2. 后端管线 + 最小 v1 接口 → 部署 → **用一个 Plus 账号打一发 `POST /v1/ppts` 确认真能出 .pptx**（最大不确定点前置验证）。
3. 跑通 → 补 DB 任务态、账号打标、UI tab、UOL、文档。
4. 单测:计费/幂等/契约(照 CLAUDE.md「财务改动必须有测」);纯函数(产物提取正则、契约序列化)抽出可单测。

## 14. 已决取舍 / 不在本期范围

- 已决:栈内重实现(不代理外部);按任务固定价扣积分。
- PSD 双路线:现有「生成即分层 + ag-psd 组装」(operations.ts layeredGeneration)与本方案「web 对话直出成品 .psd」**并列**,新 psd tab 走后者;文案区分,避免混淆。
- chat 改名:仅改文案,不强制锁后端组(后续可选)。
- 不做:chatgpt2api 的 `/files/{path}` 自托管路由(统一走 storage);gizmo/tool 方式(机制本就不用)。

## 15. 落地顺序

① 套餐能力位(done)→ ② chatgpt-web.ts 文件管线 → ③ editable-file-operations + storage + 固定价计费 → ④ 最小 v1(generations + tasks)→ **⑤ 真账号验证出文件** → ⑥ editable_file_task 迁移 + 账号打标 → ⑦ UI tab(chat 改名/chat(web)/ppt/psd)+ editable-file-panel → ⑧ UOL → ⑨ 文档/README。
