# 模型定价规则设计

本文记录模型定价功能的一阶段落地方案。目标不是把 New API 的 `quota`
单位照搬进来，而是在本系统继续以 `credits` 作为唯一财务单位，并把
“算出应扣多少积分”和“真正扣费记账”分离。

## 参考结论

New API 的倍率文档把计费拆成三层倍率：`ModelRatio`、`CompletionRatio`
和 `GroupRatio`。按 token 的核心公式是：

```text
quota = (input_tokens + output_tokens * completion_ratio)
  * model_ratio
  * group_ratio
```

固定价格模型的公式是：

```text
quota = model_price * group_ratio * quota_unit
```

同一文档还说明 New API 有预消费、后消费和差额调整机制，异步任务代码也
体现了完成后按实际 token 重算差额的路径。Issue #4602 暴露了一个值得避开
的限制：计费模式主要是模型全局维度，分组只作为价格乘数，不能自然表达
“同一个模型在 A 组按次、B 组按量”。

本项目采纳公式的结构，不采纳 `quota` 作为财务单位。财务真相仍在
`credits_transaction`，扣费仍走现有带 `sourceRef` 的幂等 `consumeCredits`；
模型定价模块只负责输出 credits 金额和可落库的 `pricingSnapshot`。

参考来源：

- [New API 倍率设置文档](https://github.com/QuantumNous/new-api-docs/blob/main/docs/guide/console/settings/rate-settings.md)
- [New API text_quota.go](https://github.com/QuantumNous/new-api/blob/main/service/text_quota.go)
- [New API task_billing.go](https://github.com/QuantumNous/new-api/blob/main/service/task_billing.go)
- [Issue #4602](https://github.com/QuantumNous/new-api/issues/4602)

## 规则模型

定价规则的核心类型位于 `packages/shared/src/model-pricing/pricing-resolver.ts`。
一条规则包含：

- `scope`：`model`、`family`、`modality`、`endpoint`、`groupId`。
- `billingMode`：`token`、`per_call`、`composite`。
- `token`：输入、输出、缓存写入、缓存命中、图像输入、音频输入的每百万
  token 积分单价。
- `perCall`：每请求、每张图、每秒、每次工具调用的积分单价。
- `multipliers`：尺寸、分辨率、质量、时长等参数倍率。
- `minimumChargeCredits`：最小扣费。
- `roundingMode`：默认推荐 `ceil_2dp`；旧视频计费可用 `ceil_integer` 保持
  与现有展示和扣费一致。

统一公式：

```text
final_credits =
  round(base_cost * group_multiplier * backend_multiplier * parameter_multiplier)
```

其中 `base_cost` 由 `billingMode` 决定：

- `token`：所有 token usage 按各自每百万积分单价加总。
- `per_call`：请求数、图片数、秒数、工具调用数按单价加总。
- `composite`：`token` 与 `per_call` 同时加总。

## 解析优先级

规则解析越具体越优先。当前实现支持：

1. `model + endpoint + group`
2. `model + group`
3. `model + endpoint`
4. `model`
5. `family + endpoint + group`
6. `family + group`
7. `family + endpoint`
8. `family`
9. `modality`

`model + endpoint` 是对原建议的保守扩展，用于同一个模型在文本接口和视频
接口需要不同规则但没有分组覆盖时的场景。`model + group` 仍高于
`model + endpoint`，用于避免 New API issue #4602 中“同模型不同分组计费
模式不自然”的问题。所有已声明 scope 字段必须精确匹配请求；禁用规则不
参与解析。

## 与现有计费对齐

现有图像计费可以映射为：

```text
base_cost = legacy_total_credits_per_image * image_count
parameter_multiplier = image_model_family_multiplier
backend_multiplier = group_multiplier * backend_member_multiplier
roundingMode = ceil_2dp
```

现有视频计费可以映射为：

```text
base_cost = (base_credits_per_second * video_model_family_multiplier)
  * duration_seconds
backend_multiplier = group_multiplier * backend_member_multiplier
baseRoundingMode = ceil_2dp
roundingMode = ceil_integer
```

旧视频要把模型族倍率预先折进 `creditsPerSecond`，再使用 `baseRoundingMode`
向上取 2 位小数，最后叠后端倍率并取整。这样能保持与现有
`getVideoCreditCost → applyVideoBackendMultiplier` 完全一致的取整链。

一阶段不替换生产扣费路径，只用测试证明 resolver 能表达现有公式。后续接入
时，每笔 `credits_transaction.metadata` 应写入：

```text
pricingSnapshot = {
  ruleId,
  billingMode,
  model,
  family,
  modality,
  endpoint,
  groupId,
  baseCostCredits,
  groupMultiplier,
  backendMultiplier,
  parameterMultiplier,
  finalCredits,
  usage
}
```

历史账单、退款和争议排查以该快照为准，不依赖管理员之后是否改价。

## 测试矩阵

| 场景 | 期望 |
| --- | --- |
| `model + endpoint + group` 与 `model + group` 同时存在 | 命中最具体规则 |
| 同一模型 A 组按次、B 组按量 | 按 `groupId` 解析到不同 `billingMode` |
| 禁用模型规则存在，族规则可用 | 跳过禁用规则，命中族规则 |
| token 输入、输出、cache、image、audio usage | 按每百万 credits 单价加总 |
| New API 三层倍率等价样例 | credits 结果等于公式换算值 |
| 按次计费叠加尺寸、质量、分组、后端倍率 | 各倍率乘积作用于基础价 |
| 组合计费 | token 成本与图片固定附加费相加 |
| 最小扣费 | 在外部倍率前生效并写入快照 |
| 旧图像计费映射 | 每图基础价 × 模型倍率 × 后端倍率结果不变 |
| 旧视频计费映射 | 每秒价 × 时长 × 模型倍率 × 后端倍率，最终整数取整不变 |

## 后续接入顺序

1. 把当前系统设置中的图片、视频价格在服务层转换成 `ModelPricingRule`。
2. 在 UOL 中增加只读 `model_pricing.preview` operation，用于后台预览和测试。
3. 将生成管线的“应扣积分”改为调用 resolver，但仍走原 `consumeCredits`。
4. 接入 token usage 的完成后差额结算，沿用现有 `sourceRef` 后缀约定。
5. 最后再做后台“模型定价”页面和分组覆盖矩阵。
