# 图像后端池调度策略

> 后端池(account / api / adobe)在各种分组与偏好下的候选、换号、回退、并发策略全景。
> 代码主体在 `apps/web/src/features/image-backend-pool/service.ts`(选号 `selectPoolMember`、
> 解析 `resolveImageBackendPoolConfig`、上报 `reportImageBackendResult`)与
> `apps/web/src/features/image-generation/service.ts`(重试/换号主循环)。
> 本文为改动后(车道统一 + 满并发短等 + 回退仅 mixed)的现状,行号会漂,以函数名为准。

## 1. 三个基础概念

- **分组 `backendType` ∈ {web, codex(responses), mixed}**;成员三类:
  - **account**:自带 `implementationMode`(web 或 responses),这是它的固有车道。
  - **api / adobe**:无固有类型,车道由其所在**分组**的 backendType 决定。
- **`preferWebFirst` 是一个开关**(`operations.ts` `preferWebFirst`):它**同时**决定
  `accountBackendPreference="web"` 与 `accountBackendPreferenceMode="mixed-only"`,二者同进同退。
- **mixed-only 模式**(`resolveEffectiveAccountBackendPreference`):web/responses 偏好**只对
  mixed 分组生效**;纯 web/codex 分组 `effectivePref` 塌成 `undefined`(组内同质,不做车道过滤)。

## 2. 请求偏好如何推导

| 请求 | preference | mode | fireflyOnly |
|---|---|---|---|
| 普通图像(尺寸等满足 web-first) | `"web"` | `mixed-only` | false |
| firefly-* 模型 / force_firefly | `undefined` | — | **true** |
| responses 请求(requiresResponsesBackend) | `"responses"` | — | false |
| web-first 不满足 | `undefined` | `undefined` | false |

## 3. 分组级 effectivePref 解析

`resolveEffectiveAccountBackendPreference(metadata, preference, mode)`:
- `!preference` → `undefined`
- `mode==="mixed-only"` 且分组非 mixed → `undefined`
- 否则 → `preference`

因 preference="web" 与 mode="mixed-only" 同进同退:

| 分组 | effectivePref(web 请求) |
|---|---|
| mixed | `"web"` |
| 纯 web / 纯 codex | `undefined`(不过滤车道) |

## 4. 候选资格(成员 × 阶段)

- **account**:`(!rowPreference || rowPreference === implementationMode)`。账号车道由自身
  implementationMode 天然决定,故按"该分组生效偏好 == implementationMode"过滤即实现 web/codex
  阶段隔离。**刻意不套 `memberAllowedForPhase`**——否则会把 responses 账号误放进 web 阶段、破坏 web 先行。
- **api / adobe**:`memberAllowedForPhase(分组backendType, effectivePref, fireflyOnly)` +
  按 requestKind 的接口兼容(`imageBackendApiInterfaceAllowsRequest`)。

```
memberAllowedForPhase = fireflyOnly || !effectivePref
                        || 分组backendType === "mixed"
                        || 分组backendType === effectivePref
```

| effectivePref | web 账号 | responses 账号 | web 分组 api/adobe | mixed 分组 api/adobe | codex 分组 api/adobe |
|---|---|---|---|---|---|
| `"web"`(仅 mixed) | 入选 | 排除(延后) | 入选 | 入选 | 排除 |
| `"responses"`(仅 mixed) | 排除 | 入选 | 排除 | 入选 | 入选 |
| `undefined`(纯分组) | 入选 | 入选 | 入选 | 入选 | 入选 |

**responses 端点能力与阶段正交**:codex 阶段不再用"有没有 responses 端点"卡 API——images 端点的
API 只要在 codex/mixed 车道就参与;只有真正的 `responses`/`chat` requestKind 才靠接口判定排除
images-only API。(改动前 `requiresResponsesEndpoint` 把阶段与端点焊死,已拆除。)

## 5. 逐分组调度

### 纯 web 分组(backendType=web)
- web 请求:`effectivePref=undefined` → 组内所有成员参与(web 账号 + 该组 api + 该组 adobe),
  无车道过滤(同质);web API 本来就能打。
- **不回退 codex**(护栏 `groupBackendType !== "mixed"`)→ web 耗尽即止,返回失败。

### 纯 codex 分组(backendType=responses)
- 同理:`effectivePref=undefined` → 组内所有成员参与;无 web 阶段、不回退。

### mixed 分组(重点)— "web 先行 → 轮询完 → 回退 codex"

**阶段 A · web 阶段**(`effectivePref="web"`):
1. 候选 = web 账号 + web/mixed 车道的 api + web/mixed 车道的 adobe;
   responses 账号排除(留阶段 B);responses 车道的 api/adobe 排除。
2. 同池按 `priority` 升序排;adobe 调低优先级 = 天然兜底,api/账号排它前先调度。
3. **满并发短等**:若有"非常驻 web 账号/api 仅因并发占满"暂不可用 → sleep
   (`IMAGE_BACKEND_WEB_CAPACITY_WAIT_*`,默认 3×300ms)后重选;**常驻满并发不触发等待**。
4. **冷却算已尝试**(DB WHERE 滤除,不重试不等待);error(非常驻)同样滤除。
5. web 车道全部尝试完仍无 → `selectPoolMember` 返回 null → 抛 `ImageBackendPoolUnavailableError`。

**回退判定**:`config.backend.groupBackendType === "mixed"` → 触发,`effectivePref` 切 `"responses"`。

**阶段 B · codex 阶段**(`effectivePref="responses"`):
6. 候选 = responses 账号 + codex/mixed 车道的 api(含 images 端点) + codex/mixed 车道的 adobe;
   web 账号此时排除。
7. 同样 priority 排序、adobe 兜底。命中 adobe 失败 = 终止(见下)。

## 6. 横切行为(所有分组通用)

| 机制 | 行为 |
|---|---|
| **冷却**(limited+未到期) | DB WHERE 滤除 → 计入"已尝试",不重试、不等待 |
| **满并发**(inflight≥concurrency) | 滤除;仅 web 阶段的非常驻 web 账号/api 触发短等,其余直接跳过 |
| **常驻**(alwaysActive) | 豁免冷却/error,恒在候选;但不计入"是否短等";详见 §7 |
| **error**(非常驻) | DB WHERE 滤除 |
| **fireflyOnly** | 只剩 adobe + adobe-sourced api,账号与普通 api 全排除 |
| **命中 adobe 失败** | 重试循环 break(pool-adobe 是终点,不再换号) |
| **同池排序** | sticky(previous_response_id / session)> preferred > ordinary;ordinary 按 `[priority↑, healthBucket↑]` 分组,组内 LRU(lastAcquired→lastUsed→created) |

## 7. 常驻(always_active)与换号的正交性 —— 关键

**常驻不影响任何"换号判断",只影响后端的持久化状态。**

| 换号判断 | 依据 | 看常驻? |
|---|---|---|
| 要不要换号 | `switchable = isImageBackendSwitchableError(error)`(`reportImageBackendResult`);循环里又独立判一次 `isImageBackendSwitchableError(result.error)` | 否,纯错误文本 |
| 换到谁 | 失败成员进**本请求 `excluded` 集**,re-resolve 时排除 | 否 |
| 回退 codex | web 耗尽 + `groupBackendType==="mixed"` | 否 |
| 满并发短等 | 常驻排除在"是否短等"外 | 是,但这非换号判断(是"回退前等不等"),且不阻止换号 |

- 重试循环文件(`image-generation/service.ts`)对 `alwaysActive` **零引用**。
- 常驻后端在**本请求内**失败 → 照常判可换号 → 进 `excluded` → 正常切走,**不会被反复选中**
  (excluded 是 per-request,覆盖 DB 里"仍可用"的事实)。
- 常驻的**唯一**作用域:`resolveAlwaysActiveFailure` 让它失败后不写 `status=error`/`cooldown`,
  使其对**后续请求**保持可用(不被自动下线)。这与"当前请求怎么换号"完全正交。
- 边界(与常驻无关):失败的是 **pool-adobe** 才 break;**pool-account / pool-api 不 break**,
  照常换号。故常驻**账号**走正常换号路径。

## 8. 关键代码索引

| 关注点 | 位置 |
|---|---|
| 车道判定 | `memberAllowedForPhase` |
| 满并发短等候选判定 | `isWebCapacityWaitCandidate` |
| 满并发短等递归 | `selectPoolMember` 末尾(`MAX_WEB_CAPACITY_WAIT_RETRIES` 分支) |
| 分组级偏好解析 | `resolveEffectiveAccountBackendPreference` |
| 目标分组 backendType 盖在 config | `toResolvedPoolConfig`(`groupBackendType`) |
| 回退仅 mixed 护栏 | `image-generation/service.ts` `shouldFallbackFromWebPreference` |
| 换号 switchable 计算 | `reportImageBackendResult`(`switchable: ... isImageBackendSwitchableError`) |
| 常驻失败持久化处置 | `resolveAlwaysActiveFailure` |
| adobe 失败 break | `image-generation/service.ts` 重试循环(非 pool-api/account 即 break) |
