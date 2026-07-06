# 用户可选分组与分组计费统一设计

本文参考 new-api（QuantumNous/new-api）的分组计费体系，结合本系统既有的
后端分组（`image_backend_group`）与模型定价规则（`MODEL_PRICING_RULES`），
给出"用户手动选择分组、按分组进行积分计费"的完整设计。本文是
`docs/plan/2026-07-04-model-pricing-rules.md` 的姊妹篇：那篇解决"应扣多少
积分"的规则表达，本篇解决"分组如何被用户选择、如何贯穿计费与展示"。

## 参考结论：new-api 的分组体系

new-api 用四个配置项组成分组闭环：

- `GroupRatio`：JSON 映射"分组名 → 计费倍率"，作为乘数进入所有计费公式
  （`quota = tokens * model_ratio * completion_ratio * group_ratio`）。
- `UserUsableGroups`：JSON 映射"分组名 → 面向用户的描述"，控制用户创建
  令牌时下拉框里能自选哪些分组；管理员勾选"用户可选"即加入。
- `token.Group`：令牌级分组字段。请求认证时若令牌指定了分组，先校验用户
  是否有权使用该分组，无权则报错（fail-closed，不静默降级）；为空则回退
  用户默认分组。最终生效分组写入 `relayInfo.UsingGroup`，同时驱动渠道
  路由与计费，并记入消费日志。
- `AutoGroups`：有序分组列表。令牌分组为 `auto` 时按优先级自动选第一个
  可用分组。
- `GetPricing`：定价接口按用户分组返回 `groupRatio` 与 `usableGroup`，
  用户在定价页能看到"同一模型在不同分组下的价格"。

值得吸收的三条设计纪律：

1. 分组选择与计费倍率是同一条数据流——选组即选价，展示、路由、扣费、
   日志用同一个"生效分组"，不存在"按 A 组路由、按 B 组扣费"。
2. 显式选择无权限时报错而非降级，避免用户以为按便宜组计费实际按贵组。
3. 分组价差对用户透明：可选分组永远带着描述与倍率一起展示。

## 现状映射：本系统已有什么

| new-api 概念 | 本系统对应物 | 状态 |
| --- | --- | --- |
| 分组实体 | `image_backend_group` 表（priority、isDefault、isEnabled） | 已有 |
| `GroupRatio` | 分组 `metadata.billingMultiplier`（`group-billing.ts` 读取，0.01~100，嵌套子分组相乘） | 已有 |
| `UserUsableGroups` | `isUserSelectable` 字段 + `metadata.minPlan` + 能力位 `backendGroups.select` | 已有 |
| `token.Group` | `external_api_key.generationGroupId`（Key 级分组绑定） | 已有 |
| 用户默认分组 | `user_image_backend_preference` 表（设置页全局偏好） | 已有 |
| `AutoGroups` | 无；默认分组取 `priority` 最小的启用分组（`getDefaultGroupId`） | 缺失 |
| 按分组差异化定价 | `PricingRuleScope.groupId`（解析优先级 `model+endpoint+group` 最高） | 规则已支持，未接扣费 |
| 分组倍率进扣费 | `operations.ts`：`billingMultiplier = backendBillingMultiplier * modelMultiplier` | 已有（legacy 链路） |
| `GetPricing` 按分组展示 | 营销定价页只展示公开规则，不区分分组 | 缺失 |
| 消费日志记录 UsingGroup | `generation.metadata` 有后端信息，`credits_transaction.metadata` 无定价快照 | 部分缺失 |

结论：基础设施基本齐备，缺的是"用户请求级选择分组"的入口、分组差异化
定价接入真实扣费、以及价差对用户的透明展示。

## 差距清单

1. **请求级分组选择缺失**。分组只能在设置页作为全局偏好切换
   （`user_image_backend_preference`），创作页无法为单次生成临时选组；
   外部 API 只能靠 Key 绑定，请求体无覆盖参数。new-api 的粒度是
   "每个令牌一个分组、创建时自选"，我们应做到"每次请求可选"。
2. **定价规则未接扣费**。`resolveModelPricing` 支持 `groupId` scope 与
   `groupMultiplier`，但图像管线仍走
   `getImageCreditCostBreakdown + applyBillingMultiplierToCreditCost`
   的 legacy 链路，"同模型不同分组不同计费模式"表达不出来。
3. **定价快照未落库**。改价后历史账单无法自证，退款争议缺依据。
4. **价差不透明**。用户看不到"选这个分组这次生成要花多少积分"，也
   看不到分组间的价格对比。
5. **无 auto 分组语义**。偏好被禁用/降套餐后静默回退默认组，用户无感知。
6. **分组可用性校验分散**。`isUserSelectable`、`minPlan`、能力位、
   `isEnabled` 的校验散在 `service.ts` 多处，请求级选择引入后需要单点化。

## 设计

### D1 分组解析：统一优先级与 fail-closed 语义

在 `image-backend-pool/service.ts` 的 `resolveRequestedGroup` 扩展为统一
解析入口（对齐 new-api `middleware/auth.go` 的语义），优先级从高到低：

1. **请求级显式分组** `requestGroupId`（新入参）：
   Web 端来自创作页选择器随 server action 提交；外部 API 来自请求体
   `generation_group` 字段。
2. **API Key 绑定** `external_api_key.generationGroupId`（仅外部 API）。
3. **用户偏好** `user_image_backend_preference`。
4. **auto 回退**：`BACKEND_GROUP_AUTO_ORDER`（见 D6），未配置时保持现状
   （`isDefault`/priority 最小的启用分组）。

校验统一为一个纯函数 `assertGroupSelectable(group, plan, source)`，规则：

- `isEnabled` 为假 → 不可用。
- 来源为"请求级"或"用户偏好"时必须 `isUserSelectable === true` 且
  `canUseBackendGroupForPlan(metadata, plan)` 且套餐具备
  `backendGroups.select` 能力位；来源为"API Key 绑定"时沿用现有校验
  （绑定动作发生时已校验，运行时只查 enabled + minPlan）。
- **显式选择校验失败 → 直接报错**（Web 返回可定位的业务错误，外部 API
  返回 400 + 错误码 `group_not_allowed`），绝不静默降级到其他分组——
  这是 new-api `token.Group` 的 fail-closed 语义，防止"用户选了半价组、
  实际按全价组扣费"。
- **隐式来源（偏好）校验失败 → 回退到 auto/默认分组**，并在响应
  metadata 中标记 `groupFallback: true`，前端提示用户偏好已失效。

解析结果向下游传递一个 `GroupSelection` 结构：

```text
GroupSelection = {
  groupId,                // 用户选择的（父）分组
  source,                 // "request" | "api_key" | "preference" | "auto"
  memberGroupId,          // 实际调度命中的成员分组（嵌套场景）
  effectiveMultiplier,    // getEffectiveBillingMultiplierForSelectedGroup 结果
}
```

规则匹配（D2）使用 `groupId`（用户所选分组，价格承诺以用户所见为准），
倍率使用 `effectiveMultiplier`（含父子分组相乘），两者都进快照。

### D2 计费：定价规则按分组解析并接入扣费

落实 2026-07-04 文档的"下一阶段"，并把分组维度打通：

```text
rule = resolveModelPricingRule(rules, { model, family, modality, endpoint,
                                        groupId: selection.groupId })
final_credits = round(base_cost(rule, usage)
  * selection.effectiveMultiplier      // 分组倍率（父 × 子）
  * backend_member_multiplier          // API/Adobe 后端自身倍率
  * parameter_multiplier)              // 尺寸/质量/时长
```

- `runImageGenerationForUser` 中在现有第 2~3 步（倍率与基础积分计算，
  `operations.ts` 行 1524-1551 附近）前插入规则解析：命中规则则用
  resolver 计价，未命中则**原样走 legacy 链路**，保证渐进迁移、行为
  可回退。
- 分组差异化定价的两种表达并存，优先级明确：
  - 粗粒度：分组倍率（`billingMultiplier`），作用于一切模型；
  - 细粒度：`scope.groupId` 规则（可为某分组把同一模型改成 per_call 或
    不同单价），命中时倍率仍然叠乘。管理员若想让规则单价即为该组终价，
    将该组倍率设为 1 即可。规避 new-api issue #4602 的表达局限。
- 扣费、结算、退款仍走原 `consumeCredits`/`settleChargedCredits`，
  `sourceRef` 约定（`${generationId}:charge` 等）不变——分组只改变
  金额计算，不触碰幂等与记账不变量。

### D3 定价快照落库

每笔扣费在 `credits_transaction.metadata` 与 `generation.metadata` 写入
`pricingSnapshot`（结构沿用 `pricing-resolver.ts` 的 `PricingSnapshot`），
在其基础上补充分组选择上下文：

```text
pricingSnapshot += {
  selectedGroupId, selectedGroupName, groupSource,   // D1 的选择结果
  memberGroupId,                                     // 嵌套实际命中
  groupMultiplier: effectiveMultiplier,
}
```

历史账单、退款与争议排查以快照为准，与管理员之后的改价/改倍率解耦。

### D4 用户界面

- **创作页内联分组选择器**：在模型/尺寸参数区加分组下拉，每项展示
  名称、用户描述（`metadata.userDescription`，对应 new-api
  `UserUsableGroups` 的 desc，存 metadata 免迁移）、倍率标签
  （如 `x0.5 半价` / `x2 高速`）、backendType 与内容安全标识。数据来源
  复用设置页 `user-preference-section.tsx` 已用的可选分组查询。
  - 默认选中用户偏好；本次更改仅随请求生效（`requestGroupId`），
    并提供"设为默认"按钮写回偏好表。
  - 选择器旁实时展示**预计扣费**：调用 UOL
    `modelPricing.previewPublicCharge`（扩展支持传 `groupId`），用户
    切组即见价差——这是"手动选分组"有意义的前提。
- **设置页**：保留现有全局偏好选择器，语义明确为"默认分组"。
- **定价页分组矩阵**：营销定价页从"单列价格"升级为"模型 × 可选分组"
  矩阵（对齐 new-api `GetPricing`）：对每条公开规则叉乘用户可选分组，
  展示倍率折算后的终价；无分组覆盖规则的模型显示"基础价 × 分组倍率"。
- **历史与账单**：生成历史与积分明细展示所用分组名与倍率（读快照）。

### D5 外部 API

- 请求体新增可选字段 `generation_group`（string，分组 ID 或预留值
  `"auto"`），5 个 v1 handler 统一在入口解析后传入
  `runImageGenerationForUser`——单一管线保证一处改动覆盖全部路径。
- 与 Key 绑定的优先关系：**Key 已绑定分组时忽略并拒绝 body 覆盖**
  （400 `group_locked_by_key`）。Key 绑定是发 Key 者的管理约束（如给
  第三方限定低价组），请求方不得越权升组；未绑定时 `generation_group`
  生效，走 D1 的请求级校验。
- `/v1/models` 响应或新增只读端点暴露可选分组列表（复用 D6 的 UOL
  操作），便于外部 agent 程序化选组。

### D6 auto 分组（二期）

新增系统设置 `BACKEND_GROUP_AUTO_ORDER`（`valueType: "json"`，有序
groupId 数组，注册进 `system-settings/definitions.ts`）。当解析结果为
`auto`（显式传入或偏好为空）时，按序取第一个满足
enabled + minPlan + requestKind 兼容的分组。一期不做显式列表，保持现有
priority 回退即等价于"隐式 AutoGroups"；二期补管理 UI 与显式配置。

### D7 UOL 接口层

按 Agent 集成架构约束，新能力先注册为 operation，再接传输：

| operation | 权限 | 说明 |
| --- | --- | --- |
| `backendGroups.listSelectable` | user | 返回当前用户可选分组：id、名称、userDescription、倍率、backendType、minPlan、是否当前偏好。只读。 |
| `backendGroups.setPreference` | user | 写 `user_image_backend_preference`，输入 Zod 校验 + D1 校验。幂等（同值重写无副作用）。 |
| `modelPricing.previewPublicCharge` | public/user | 扩展现有操作：可选 `groupId` 入参，仅接受该用户可选的分组，防止探测隐藏分组定价。 |

创作页选择器、设置页、外部 API 分组列表端点、站内 Agent 与 MCP 全部
经这三个 operation，鉴权与能力校验单点在 `invokeOperation` 网关。

涉及财务的扣费链路改造（D2/D3）**不新增财务写 operation**，仍在
`runImageGenerationForUser` 进程内完成，符合"财务接口化最后做"的约束。

## 数据与迁移

- **零新表、零迁移**：请求级分组是运行时参数；`userDescription` 与既有
  倍率一样放 `image_backend_group.metadata`；快照放既有 JSON metadata
  列；`BACKEND_GROUP_AUTO_ORDER` 走 system_setting。
- 能力位复用 `backendGroups.select`，不新增键（请求级选择与偏好选择是
  同一能力的两种粒度，拆两个键属于过度设计）。

## 安全与不变量

- 财务真相仍在 `credits_transaction`；`consumeCredits` 幂等键
  `(user_id, type, source_ref)` 与 `credits_batch(source_type, source_ref)`
  约定不变；分组只影响金额计算。
- 服务端绝不信任客户端传来的 `groupId`：每次请求重新做 D1 校验
  （enabled、isUserSelectable、minPlan、能力位），防越权用组（IDOR）。
- 倍率读取继续单点在 `group-billing.ts`；能力判定唯一来源
  `plan-capabilities.ts`；定价规则读取单点 `MODEL_PRICING_RULES`。
- 显式选组 fail-closed：校验失败即拒绝，杜绝"降级到更贵分组"的资损面。
- 预览接口只暴露用户可选分组的价格，防止枚举内部分组定价。

## 落地顺序

1. **Phase 1 选组入口（已完成，2026-07-06）**：
   - `group-selection.ts` 纯函数校验层（`checkGroupSelectable` +
     `ImageBackendGroupSelectionError`，DB-free 单测 10 例）；
   - `resolveRequestedGroup` 支持 `requestGroupId`，优先级
     请求级 > Key 绑定 > 偏好 > 默认；显式选择 fail-closed，Key 绑定时
     拒绝覆盖（`group_locked_by_key`）；
   - `requestGroupId` 贯穿 `getEffectiveConfig` / 换号重试 re-resolve
     （盖在 `config.backend` 上，重试不漂移分组）；
   - `generateImageAction` 与内部 generate/edit/chat 路由接收 `groupId`；
   - UOL：`pool.getSelectableGroups`（含倍率/车道/当前偏好）与
     `pool.setPreference` 已接线真实实现；
   - 创作页分组选择器（标准 + compact 形态，覆盖文生图/改图/chat/
     瀑布流），预估扣费随选组即时反映倍率。
2. **Phase 2 计费接入**：resolver 进 `runImageGenerationForUser`（未命中
   规则走 legacy）；`pricingSnapshot` 落 `credits_transaction.metadata`
   与 `generation.metadata`；历史/账单展示分组与倍率。
3. **Phase 3 外部 API 与展示**：v1 handlers 支持 `generation_group`
   （含 Key 锁定语义）；定价页分组矩阵。
4. **Phase 4 auto 分组**：`BACKEND_GROUP_AUTO_ORDER` 设置 + 管理 UI。

每个 Phase 独立可发布、可回退；Phase 2 涉及扣费金额计算，须先补齐测试
矩阵再切换。

## 测试矩阵

| 场景 | 期望 |
| --- | --- |
| 请求级选组通过校验 | 按所选分组倍率/规则计价，快照 source=request |
| 请求级选组不可选（isUserSelectable=false / 套餐不足 / 禁用） | 报错拒绝，不降级不扣费 |
| 偏好分组被禁用后发起生成 | 回退默认组，响应带 groupFallback 标记 |
| Key 绑定分组 + body 传 generation_group | 400 group_locked_by_key |
| Key 未绑定 + body 传合法分组 | 按 body 分组计价 |
| 同模型 A 组命中 groupId 规则、B 组走基础规则 | 两组金额分别正确 |
| 命中规则 + 分组倍率 + 后端成员倍率 + 参数倍率 | 乘积与取整链正确 |
| 无任何规则命中 | 走 legacy 链路，金额与现状完全一致（回归基线） |
| 嵌套子分组调度 | 快照记录 selectedGroupId 与 memberGroupId，倍率为父子乘积 |
| 同一 generationId 重复扣费（并发/重试） | sourceRef 幂等，不双扣 |
| 扣费后管理员改倍率再退款 | 退款金额以落库快照为准 |
| 预览接口传他人不可选的 groupId | 拒绝，不泄露定价 |
| 纯函数层（assertGroupSelectable、快照构造） | DB-free 单测，抽离不 import @repo/database |

## 参考来源

- [new-api 仓库](https://github.com/QuantumNous/new-api)（GroupRatio、
  UserUsableGroups、token.Group、AutoGroups、GetPricing 机制）
- `docs/plan/2026-07-04-model-pricing-rules.md`（定价规则模型与公式）
- `docs/plan/2026-05-31-agent-integration-architecture.md`（UOL 约束）
