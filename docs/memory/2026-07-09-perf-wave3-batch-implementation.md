# 2026-07-09 性能优化剩余批次实施记录

> 创建日期：2026-07-09
> 适用范围：响应慢/页面卡顿剩余优化（工作流 A–F 中的 C-P0-3、F-P2-1、F-P1-1/F-P2-2、C-P0-1、B-P1-2 等）
> 前置：`docs/plan/2026-07-09-performance-and-concurrency.md`（6 工作流总计划）与本目录 `2026-07-09-perf-workflow-F-plan.md`（F 工作流 P1/P2）

## 一、本轮已落地批次

### 批次 1：C-P0-3 system-settings 缓存升级（覆盖面最广）
- `packages/shared/src/system-settings/index.ts`：原进程内 10s ESM 缓存 → `unstable_cache`（60s TTL + tag `system-settings`）。
  - 新增导出 `SYSTEM_SETTINGS_CACHE_TAG`、纯函数 `querySystemSettingsMap`、`loadSystemSettingsMap` 带 try/catch + `lastGoodMap` 兜底（保留原 DB 异常回退旧值容错）。
  - `clearSystemSettingsCache()` 内部转发 `updateTag(SYSTEM_SETTINGS_CACHE_TAG)` + 清 `lastGoodMap`，所有 mutation 触点（`setSystemSettings`/`import / migrate` + `image-backend-pool/service.ts:setSub2ApiAutoSyncTasks` 野生写入点）经此自动失效。
  - 保留构建期 `GPT2IMAGE_SKIP_RUNTIME_SETTINGS_DB=1` 跳过 DB 分支与 `branding.ts` 动态 import 形态。
- 单测：`index.test.ts`/`defaults.test.ts` 加 `vi.mock("next/cache")`（unstable_cache 直通 + `updateTagSpy`），补 mutation 触发 updateTag 断言。50 测试全绿。

### 批次 2：F-P2-1 无限画布可视区节点 AABB 裁剪
- `canvas-state.ts`：新增 `computeVisibleWorldRect`/`isNodeVisibleInRect`/`computeVisibleNodes` 纯函数 + `BoardSize` 类型 + `VIEWPORT_CULL_MARGIN=200` 常量。
- `infinite-canvas-client.tsx`：加 `boardSize` ResizeObserver（useLayoutEffect）、`visibleNodes`/`visibleNodeIds`/`visibleEdges` useMemo。节点 map 与边 map 改用裁剪结果。
  - 兜底：`boardSize=0`（首帧）回退全量渲染避免空白。边按"任一端可见"判定避免裁剪切断屏内连接。minimap 仍用全量 nodes 保持鸟瞰完整。
- 单测：`canvas-state.test.ts` 新增视口裁剪 describe（正常/边界/缩放/平移/首帧回退），15 测试全绿。

### 批次 3a：F-P1-1 创作页 video+waterfall dynamic
- `create-page-client.tsx`：`VideoCreatePanel`、`CreatePageWaterfallGrid` 改 `next/dynamic({ssr:false})`。
  - waterfall 本已按 batch/waterfall mode 条件渲染，dynamic 天然按需；video tabpanel 原 hidden 始终挂载会首屏拉 chunk，加 `videoMounted` 惰性挂载标志（首次切到 video 置 true 并永不复位，保留草稿态）。
  - 高耦合且始终渲染的 Text/Image/Settings/VisualOutput/Recent 面板保留静态 import。

### 批次 3b：F-P2-2 admin-panel register+import dynamic
- `admin-panel.tsx`：`ChatgptRegisterTab`(691 行)与 `Sub2ApiImportSection`(1316 行)改 `next/dynamic`。两者均为非默认 active 大子树，从 5318 行单文件首屏 bundle 移出为独立 chunk。
  - `Sub2ApiImportSection` 的命名导入改 `import type`（仅留类型），组件本体走 dynamic。
  - groups/accounts/apis/adobe 四个内联 TabsContent 的剥离因多 form 状态交叉风险大，后置。

### 批次 4a：C-P0-1 SLA revalidateTag 接入生成完成
- `sla.ts`：新增 `invalidateSlaStatsCache()`（封装 `revalidateTag(SLA_STATS_CACHE_TAG)` + try/catch 降级）。
- `operations.ts`：`runImageGenerationForUser` 的 completed/failed 两个收口调 `invalidateSlaStatsCache()`。
  - **用 `revalidateTag` 而非项目惯用的 `updateTag`**：operations.ts 被 route handler 直接调用，`revalidateTag` 在 route handler / server action 均可用；`updateTag` 仅限 Server Action 上下文。散落异常路径的零散 generation 写入不接入，靠 60s TTL 兜底。
- 单测：新增 `sla-invalidation.test.ts`（mock next/cache 验证 revalidateTag 调用与抛错降级不外泄），2 测试全绿。

### 批次 4d：B-P1-2 animated-price framer-motion 懒加载
- `pricing-section.tsx`：`AnimatedPrice` 改 `next/dynamic({ssr:false})`，把 framer-motion 从营销 pricing 首屏 critical chunk 移出。

## 二、本轮有意不做 / 后置项

- **批次 3c**（admin-users-management UserDetailSheet 剥离+lazy）：UserDetailSheet 高耦合父 state，剥离需注入 30-50 个 props/callbacks，回归风险大且收益相对低 → 后置单独立项。
- **批次 4c**（history-client 虚拟化）：history 每页固定 20 条（page.tsx `PAGE_SIZE=20`），原 `HistoryRow` 注释明确判定"虚拟化收益有限、列宽与表头对齐风险偏高"，仅 memo+prefetch 是有意工程取舍 → 经与维护者确认不做。
- **批次 4b**（admin/payments+users 聚合 unstable_cache+tag）：`admin/payments/page.tsx` 1370 行单文件需逐 query 权限审计（不缓存 private 明细），审计面大；`admin/users` 聚合在 client API 不在 page，不属于 server page 缓存范畴 → 后置，权限审计面值得独立专项做。

## 三、验收

- `turbo test` 局部路径全绿（system-settings 50、canvas-state 15、image-generation 268、image-backend-pool 115、sla-invalidation 2）。
- Biome lint 改动文件全绿（无新增 error/warning）。
- 6 个 commit：`877f8185` / `d680e599` / `5a135abd` / `370b4385` / `ad47ceb9` / `1ee6b363`。

## 四、剩余性能优化 backlog（衔接后续）

参见前置计划 `docs/plan/2026-07-09-performance-and-concurrency.md` 中未完成/部分完成项：
- A-P0-4（受保护页仍 20 处 `getServerSession(`，cache 已使重复无害但调用点未收敛）
- A-P1-1（`getUserPlan` 未 cache，改用 `service.ts` plan 透传替代）
- C-P1-1（dashboard 子页 ISR，高风险需逐页验证权限边界）
- C-P1-2（gallery 游标分页与 legacy `page*PAGE_SIZE` 回退并存）
- C-P1-3（admin 聚合缓存，本轮后置）
- D-P1-1/D-P1-2（barrel 具名重导出 / turbo inputs-outputs，部分完成）
- E-P1-2（cached-image 批量预热，部分完成）
- F-P1-2（create-page-client effect 级联改 reducer/flushSync，部分完成）
- F-P2-1（infinite-canvas 可视区节点虚拟化，本轮完成 AABB 裁剪；react-virtual grid 未做）
- F-P2-2（admin-panel groups/accounts/apis/adobe Tab 剥离，本轮后置）

## 五、perf-wave4 收尾批次（commit 775c59ce..39d2284a）

### logger flush 等待在途 gzip 归档（775c59ce）
- 根因：`rotateCurrentFile` `void` 启动 gzip 后立即返回，`flush()`/`resolveIdle` 不等待在途归档，导致 `await flush()` 后读取 `.gz` 读到截断流（`unexpected end of file`，测试 flaky）；同一缺陷在生产中让轮转后立即退出的进程留下损坏归档。
- 修复：新增 `pendingArchives` 集合，`startArchive` 登记在途 Promise（catch 里移除自身）；`scheduleDrain.finally` 队列排空后 `awaitPendingArchives` 再 `resolveIdle`；`flush()` 早退路径也 await pendingArchives。pipeline 写法不变。
- 效果：测试 5/5 稳定通过；生产优雅停机可靠；`flush()` 契名副实。

### 3c UserDetailSheet 剥离 + dynamic（commit）
- 把 AdminUsersManagement 的用户详情 Sheet（1399-1815，5 Tab + 超管操作栏）抽到 `admin-user-detail-sheet.tsx`（592 行），经 `next/dynamic({ssr:false})` 懒加载 + `detailMounted` 门控（首次打开置 true 永不复位，保留 Sheet 关闭动画）。
- 新增 `admin-users-shared.tsx`（180 行）：把 `UserRow`/`UserDetail`/`PlanFilter` 类型与 `formatDateTime`/`planBadge` 共享工具前置，父子均从它 import，避免子组件反向 import 父模块成依赖环。
- 详情专用 `Panel/InfoBlock/Metric/EmptyText/generationStatusBadge` 随 Sheet 迁移；`detailBalance/detailGenerationRate` 派生下沉为子组件 useMemo；9 个 Dialog 留父组件不动（被主列表与详情共享触发）。
- 父文件 2371→1746 行。

### 4b admin/payments 聚合 unstable_cache + tag（6d14ebd4）
- 改造点不是 `admin/payments/page.tsx`（它不直接查 DB），而是 UOL 操作 `admin-payments.ts` 的 `loadLocalOrders`。
- 把 A1（`count()` 总数）+A2（`groupBy(status)` 状态分组 count+sum）抽为 `getCachedLocalOrderStatusRows`，`unstable_cache` 包装，key 只含 `type`/`provider` 两个低基数枚举（避开 `q` 自由文本与 `from/to` 精确时间戳的键爆炸）；300s TTL + `admin-payments-aggregate` tag。
- 总数从状态分组派生（status=all 求和，否则取对应分组），不再单独 count。明细分页（orders/ledger/subscriptions，含 userEmail）始终实时不缓存。
- 失效触点：`payment/epay.ts` 三处（saveEpayOrder/updateEpayOrderStatus/claimEpayOrderForFulfillment）补 `invalidateAdminPaymentsCache`（`revalidateTag` with `max` profile + try/catch 降级，webhook 上下文可用）；claim 未命中时不失效。
- 权限：`assertPaymentAdmin` 保持在 `execute` 入口（unstable_cache 外），缓存命中不跳过鉴权。
- 新增 `payment/admin-payments-cache.ts` 单点 tag 定义与失效函数；epay.test.ts 补 next/cache mock 与"领取成功失效/未领取不失效"断言。
- 顺带把 `sla.ts` 的 `revalidateTag` 补上 Next 16 要求的 `max` profile（消除弃用告警）。

### admin-panel groups/apis/adobe Tab 剥离为 dynamic（2 commits）
- 沿 ChatgptRegisterTab/Sub2ApiImportSection 范式，把 `<TabsContent value=apis>`（708 行）/`value=adobe`（692 行）/`value=groups`（372 行）三段抽到 `admin-apis-tab.tsx`(840)/`admin-adobe-tab.tsx`(846)/`admin-groups-tab.tsx`(463)，各经 `next/dynamic({ssr:false})` 懒加载；TabsContent 外壳留父文件保持 Radix Tabs 上下文不跨 chunk。
- 父文件 5331→3728 行（净减 1603 行）；三个新组件零 hook（纯 props 注入），props 量级 apis 20 / adobe 34 / groups 11。
- 模块级常量/纯函数/类型（OPTIONS 数组/label 函数/Group/Api/Adobe/ApiFormState/AdobeFormState/GroupFormState 等）从父文件 export 由子文件 import，不复制实现。
- 关键约束：adobe 倍率草稿回填 `loadModelMultipliers` useEffect 留父组件，子组件 lazy mount 后草稿已就绪不会清零倍率。
- accounts 因多 form 交叉（bulkAccountForm/accountForm/selectedAccountIds 三层 + 6 selected 派生 + 与 import section 跨段 state 契约）保留内联。
- groups 是非 readOnly 默认 active Tab，dynamic 后首帧 null 占位换主 bundle 变小，取舍可接受。