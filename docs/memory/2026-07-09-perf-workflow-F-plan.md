# 工作流 F 创作页/无限画布性能重构计划（P1/P2 衔接）

> 创建日期：2026-07-09
> 适用范围：GPT2Image-Pro 前端性能优化工作流 F
> 本轮 P0 已完成；本文档记录 P1/P2 阶段的拆分与改造思路，供后续衔接输入。
> 相关文件：
> - 创作页：`apps/web/src/features/image-generation/components/create-page-client.tsx`（5912 行，最大单组件）
> - 无限画布：`apps/web/src/features/infinite-canvas/components/infinite-canvas-client.tsx`（约 2330 行）

## 一、P0 已实施内容（本轮）

### 1. 无限画布高频事件节流（infinite-canvas-client.tsx）
- pointer move（拖动平移/节点移动）回调改为 requestAnimationFrame 节流：多帧事件暂存到 ref，每帧合并执行一次 setState，中间事件丢弃但位移通过 lastWorld/viewport 基准累加保持等价。
- wheel 缩放回改为 requestAnimationFrame 节流：同帧多事件合并为一次写入。注意 wheel 需 `preventDefault`，因此不能使用 passive listener，仅在主线程内做 rAF 合并。
- 指针结束（onPointerUp/onPointerCancel）与组件卸载时统一 cancelAnimationFrame，避免对已卸载组件 setState。
- localStorage 持久化写入保持 debounce（常量 `STORAGE_WRITE_DEBOUNCE_MS = 300`），仅 boot 完成后才写。
- localStorage 读取收敛到挂载时一次性 init（effect 已用 `// biome-ignore useExhaustiveDependencies` 标注仅执行一次），后续不再在 effect 链中反复读本地存储。

### 2. recharts ResizeObserver 节流（image-pricing-chart-card.tsx）
- `useElementWidth` 的 ResizeObserver 回调改为 rAF 合并写宽度。
- setState 升级为函数式更新 + 等值跳过：仅当向下取整后的宽度真正变化时才更新，避免等值更新触发 recharts 重绘。
- 卸载时 cancelAnimationFrame + disconnect。

### 行为等价性核对（未实机验证，记录待验）
- 拖动响应仍跟手：rAF 节流把每像素 setState 降为每帧一次，视觉上仍连续，但极高频场景下可能略掉中间帧（节点位移通过 lastWorld 累加，最终落点等价）。
- 缩放中心：以最近一帧事件位置为锚点，连续滚动最终缩放比例等价；中间帧锚点可能与旧实现略有差异，不影响最终态。
- 滚动 dashboard 时 recharts 重绘次数下降，无图表交互行为变化。

## 二、创作页巨大组件拆分（P1 计划，本轮不实施）

`create-page-client.tsx` 共 5912 行，22 处 useEffect，状态大量经由自定义 hook `useCreateRuntimeState`（基于外部 store 替代 useState，故 grep useState 为 0）。拆分原则：

### 1. 可 lazy 的面板（按模式切分）
创作页按 `activeMode` 分支渲染不同工作区，建议按面板粒度 `React.lazy + Suspense`：
- **文生图/瀑布流面板**（含 batch/line 批量参数）：高频在瀑布流模式下驻留，可独立 chunk。
- **图生图/编辑面板**（含 mask 编辑器）：mask 编辑器依赖较重，仅在编辑模式挂载，应 lazy。
- **Chat/Agent 对话面板**：含流式 SSE 解析与长会话历史，体量最大，可独立 chunk。
- **右侧预览/画廊**：依赖图片懒加载，可延迟挂载。

收益：首屏只加载当前 mode 所需代码，切换模式时按需加载，降低主 chunk 体积。

### 2. effect 级联改造（effect 流向派生 state 的具体位置）
当前 22 处 effect 中多处是「监听某些 state，副作用更新另一些 state」的可派生逻辑，应尽量改为 `useMemo` 派生或 setState 函数式更新，减少额外渲染轮次。已识别的位置：

| 行号 | 当前职责 | 改造建议 |
| --- | --- | --- |
| :604-618 | resetKeys 变化时重置表单 | 保留为 effect（reset 是真正的副作用），但用 ref 跟踪上次 keys 跳过等值。 |
| :620-636 | 套餐并发上限收紧时钳制 batchCount 等多个 state | 改为派生：batchCount 等读时 `Math.min(current, limit)` 即可，或用单一源 masses 派生，避免链式 setState 引发多次渲染。 |
| :639+ | 处理跨页面参考图 URL/权限输入（biome-ignore useExhaustiveDependencies） | 保留 effect，但应把「解析 URL → 派生 mode/ref 数据」抽成纯函数，effect 只负责读入，避免 effect 内嵌大段判断。 |
| :854-874 | 图片预览弹层尺寸测量 | 仅在打开预览时挂载，无需常驻。 |
| :2105-2163 | 切换会话时同步 activeMode/会话激活 | 高复杂度 effect，依赖多个 ref。建议将会话状态抽到独立 store（如 zustand 风格）由订阅驱动，effect 仅做一次性订阅，不在 effect 内做命令式切换。 |
| :2721-2824 | 首次迁移本地历史记录（仅一次，didLoadChatRef 守卫） | 可改为 mount 时一次性 async init 函数，不在 effect 链里跑。 |
| :2827-2888 | 持久化对话到 localStorage | 应 debounce（参考画布 300ms），避免每次 message 变化同步写盘。 |
| :2889-2913 | 测量首图尺寸 | 仅在 previewUrl 变化时挂载，可两段式。 |
| :2915-2923 | maskSourceIndex 钳制 | 改为读取时派生 `Math.min(idx, length-1)`，消除 effect。 |
| :2925+ | mask 源切换清理 | 保留为真实副作用，但清理逻辑可抽纯函数。 |
| :4202+ | 行尾尾部 effect | 需进一步定位后评估。 |

通用改造思路：
1. 「当 A 变化时把 B 设为 f(A)」型 effect，若 f 是纯函数且无副作用，改为 useMemo/useMemo 直接派生 B，或 render 期内联计算。
2. 必须为副作用的（写 localStorage、发起请求、测量 DOM），用 debounce/rAF 收敛高频写，并在卸载时清理。
3. 跨 state 协调尽量收敛到单一数据源，减少多 setState 引发的中间渲染帧。

## 三、无限画布拆分原则（P2，本轮不实施）

`infinite-canvas-client.tsx` 约 2330 行，UI 与持久化与生图 RPC 耦合。P2 建议按三层切分：

### 1. 渲染层（纯展示）
- 节点视图 `CanvasNodeView`、连线 `CanvasEdgePath`、连接点 `CanvasConnectorHandle`、工具栏 `ToolbarButton`、预览弹层 `ImagePreviewDialog`、迷你地图 `buildMinimap`。
- 这些已是纯函数组件，但仍在同一文件。拆到 `components/` 子目录独立文件，便于 memo（由 E 工作流的虚拟化/memo 项承接）。
- 渲染层只接收 props，不持有持久化逻辑。

### 2. 交互层（事件 + 视口状态）
- pointer/wheel 键盘事件处理、拖拽状态机 `DragState`、选区管理。
- 已在本轮 P0 节流。P2 可进一步把视口状态（pan/zoom）与节点状态分离为两个独立 store，避免拖节点时连带视口对象重渲染。
- 交互 hook 命名建议：`useCanvasViewport`、`useCanvasSelection`、`useCanvasDrag`。

### 3. 持久化层
- localStorage 读写（已节流）、导入导出 JSON、序列化 `serializeCanvasState/parseCanvasState`。
- 抽 `useCanvasPersistence` hook，只负责 boot 读取与防抖写回，与 UI 解耦。

### 4. 生图 RPC 层
- `runCanvasGenerationPlan`、`runSingleCanvasGeneration`、`pollGenerationResult`、`runTextToImage/runImageEdit` 等。
- 抽到 `services/canvas-generation.ts`，纯函数化，组件只调用，避免组件文件内堆积 fetch 逻辑。

拆分收益：
- 渲染层可独立 memo 虚拟化（E 工作流对接）。
- 持久化/生图层可独立单测。
- 交互层与渲染层解耦后，拖拽只触发视口 store 变更，节点视图按需订阅，减少全量重渲染。

## 四、衔接说明
- 本轮 P0 修改未做 git commit，由父 Agent 统一提交。
- 本文档作为 P1/P2 阶段衔接输入，后续如实施请同步更新本文件状态。
- 验证建议：P1/P2 实施后跑 `turbo typecheck && turbo lint`，并开 dev 用 Performance 面板对比渲染帧数。