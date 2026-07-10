# MEMORY — 实时关键记忆索引

> 项目长期记忆索引。详细记忆见 `docs/memory/`，计划见 `docs/plan/`，待办见 `docs/TODO.md`。
> 这是所有贡献者 Agent 的共享长期记忆，请保持精简，每条一行。

## 安全

- [2026-05 安全审计](security-audit-2026-05.md) — 6 维度并发安全审查；高危经济/入侵口子已在 dev 修复（2beb0e0/b69c10b/14a88d8/07d7a18）
- [2026-05-31 对抗式审计报告](plan/2026-05-31-audit-report.md) — 12子系统x3镜头确认128条(critical1/high27/medium58/low39/info3)
- **2026-05-31 修复 workflow 完成**：先修 S-C1(03cc6bd)/S-H5(edbc0d6)/S-H1+H2(f1216df)；再经 15 单元并行修复 workflow 共修 94 条、未修 23 条、defer 4 个上帝组件；dev 9 主题提交 0babd1f..01906e0(封禁会话/回调SSRF/存储越权/限流fail-open/moderate恒定时间/注册冷却/external-api+支付+订阅+生成覆盖)；终验 typecheck+test 全绿(shared235+web257=492)。未修与 defer backlog 见 [测试重构计划](plan/2026-05-31-audit-test-refactor.md)
- **2026-05-31 安全修复 workflow 二轮（遗留项）**：7 单元对抗复核后保留 5 条(dev 提交 4208681..6f48522)——S-L2 webhook 不吞异常 / S-L1 consumeCredits 按 userId 归属+迁移0029 / S-M8 设置范围校验 / M-H5 admin 集中守卫 / v1 per-key 限流；S-M11 仅 detect-only 软门闩(默认不拒)。**回退 2 条**：U3 S-L7 generations 桶 cookie 鉴权(破坏 v1 API 默认 url 返回的无 cookie 拉取，须改签名 URL)；U7 SSRF pin(Next16 patchFetch 致生产不走 pin+假绿灯)。详见 [测试重构计划](plan/2026-05-31-audit-test-refactor.md)
- **#1/#15/#16 浏览器实测通过**（api2 隔离测试栈 2026-05-31，未发现真实 Bug；积分首屏短暂0为异步发放假象自愈）
- **2026-05-31 安全修复三轮（全部遗留项）**：4 条并行修复+对抗复核，dev 提交 cfb3861..06e4709——S-L7 签名 URL 替代 cookie 鉴权 / S-M11 Creem 纯函数抽离+369 行单测 / SSRF 无条件 DNS pin(node:http/https 不经 Next patch) / COST quality+thinking 积分倍率。288 web + shared 全绿。后续裸 fetch 已在 2026-07-10 统一 HTTP 资源边界改造中收敛，见性能审计实施记录。
- [待办清单](TODO.md) — 仍存在的代码层问题 + 部署前必做

## 架构

- [项目架构与交接手册](PROJECT-ARCHITECTURE-HANDBOOK.md) / [项目模型目录](PROJECT-MODEL-CATALOG.md) / [交接改造技术方案](plan/2026-07-10-project-handover-refactor.md) — 2026-07-10 基于 `2aa2536e7d6c` 的当前实现快照：技术栈、工程边界、功能依赖、Mermaid、44 表、AI/状态/权限/定价模型及 UOL 渐进收敛路线；严格区分 As-Is 与 To-Be
- [Agent 集成架构](plan/2026-05-31-agent-integration-architecture.md) — 统一接口层(UOL)优先；MCP 适配器默认关闭+管理秘钥；内置 agent 直连接口层；配套盘点表 plan/2026-05-31-feature-interface-inventory.md。**开发新功能前必读**（CLAUDE.md 已立约束）
- **UOL 当前仍在迁移**（2026-07-10 快照）：Registry/Principal/invoke 网关已落地，172 个 Operation 中 83 个定义内直接实现、12 个由 Web 延迟绑定、77 个仍未接线；会话用户的 capability 尚未由网关统一校验，迁移 Session 入口前须补齐 plan 解析与 Principal 对拍测试。

- [图像后端池调度策略](image-backend-pool-scheduling.md) — 车道模型(web/codex/mixed × mixed-only)、候选资格(account 靠 implementationMode、api/adobe 靠分组车道)、mixed 分组 web 先行→回退 codex、满并发短等、冷却=已尝试;**常驻 alwaysActive 与换号判断正交**(只动持久化状态,不影响要不要换/换到谁/回退)

## 功能

- [纯中转 API Key](plan/2026-05-30-relay-only-api-key.md) — relay_only key：不记录/不存储/仍扣费仍审核；附带修复 consumeCredits 幂等（dev: 7c6da21→e957f48）
- **Issue #1/#15/#16 修复**（dev: a2dd4dc/10d0bc8/c8e9118，详见 [TODO.md](TODO.md)）— #1 管理员建号/改密改邮箱(superAdminAction+better-auth hashPassword)；#15 瀑布流 tier/参数/3警告对齐原项目；#16 数量控件改数字输入+滚轮、上限与服务端 count 校验统一挂 `imageGenerationConcurrency`（**语义变化**：单次张数上限不再用 maxBatchCount）。待 UI 实测。

## 工程 / CI

- [CI/CD 流水线](CI-CD.md) — ci.yml 6 门禁（docs-mirror/lint/typecheck/test/build/docker-build）+ docker-release(tag) + dependabot
- lint 门禁**仅 PR、仅改动文件**用 `biome lint --changed`（非 `biome ci`——全仓历史未 biome 格式化；对齐团队 `turbo lint` 约定）；typecheck/test/build 全仓 push+PR 双跑
- typecheck job 必须先 `pnpm --filter @repo/web exec fumadocs-mdx` 生成 `.source`（gitignore 忽略、独立 tsc 不自生成），否则连锁 any 报错
- CLAUDE.md ≡ AGENTS.md 为镜像文件，CI `docs-mirror` job 强制逐字一致；改一个必须同步另一个
- **分支保护已启用**（dev+main，5 required checks，strict）；远端仓库已迁移至 `MeowFree/GPT2Image-Pro`（旧 `MoYeRanqianzhi/...` 会重定向）
- 第三方 GitHub Action 全部钉 40 位 SHA（dependabot 维护）；第三方 action major 升级是单独人工决策
- Dependabot 已忽略 semver-major（npm + actions）；major 升级人工评估
- **kysely 被 pnpm override 钉在 0.28.17**（根 package.json）：better-auth 1.6 放宽 peer 让 kysely 浮到 0.29，而 0.29 把迁移导出迁到 `kysely/migration` 子路径、随 better-auth 打包的 kysely-adapter 仍从根导入 → next build 编译炸。待上游修复后移除（见 docs/TODO.md）
- [2026-07-06 工程化风险后续专项](plan/2026-07-06-engineering-risk-followups.md) — 本轮 lint 接入四包并清理低风险告警后，剩余创作页 hook 依赖、积分首次创建并发、UOL capability、MCP schema、SSRF 网段覆盖作为独立专项推进。

## 性能

- [2026-07-10 next-themes React 19 兼容补丁](memory/2026-07-10-next-themes-react19-compat.md) — 官方稳定版 `0.4.6` 在 React 19/Next 16.2 客户端重渲染内联脚本；当前用 pnpm 补丁应用上游 PR #386 的 SSR-only 修复，并以客户端/SSR 双测试锁定。待官方稳定版包含等价修复后删除补丁并升级。
- [2026-07-10 系统工程与性能审计](plan/2026-07-10-system-performance-audit.md) / [实施记录](memory/2026-07-10-system-performance-audit-implementation.md) — P0/P1 已落地：短事务可恢复租约、持久异步任务与集群 semaphore、积分过期分页聚合、订阅用户唯一、候选限流指标、统一 fetch、原子 Docker release descriptor、真实迁移 CI；P2 已接 Sentry/Web Vitals/LHCI/资源体积预算、直传与 2 MiB 控制面、retention/Idempotency-Key、视频 semaphore、storage 输出边界，并完成后端池 error-classification/cooldown 的 DB-free 首块提取（`78f8e5fd`）。残余仅为 esbuild 低/中风险、真实环境 CI 首次留档和其余巨型文件按职责渐进拆分。
- [2026-07-09 性能优化总计划](plan/2026-07-09-performance-and-concurrency.md) — 响应慢/卡顿 6 工作流(A–F)总计划，14 项任务。
- **2026-07-09 perf-wave3 剩余批次落地**（6 commits 877f8185..1ee6b363，详见 [memory](memory/2026-07-09-perf-wave3-batch-implementation.md)）：C-P0-3 system-settings 升级 unstable_cache+`SYSTEM_SETTINGS_CACHE_TAG`(updateTag 转发失效)+lastGoodMap 兜底；F-P2-1 无限画布可视区 AABB 裁剪(computeVisibleNodes+ResizeObserver+边裁剪+首帧回退)；F-P1-1 创作页 video+waterfall dynamic(videoMounted 惰性挂载保留草稿)；F-P2-2 admin-panel register+import dynamic；C-P0-1 SLA 失效接入生成完成(用 `revalidateTag` max profile 而非 updateTag 因 operations 被 route handler 直调)+try/catch 降级；B-P1-2 AnimatedPrice 动态化移出 framer-motion 首屏 chunk。后置：3c UserDetailSheet 剥离(高耦合)、4b admin 聚合缓存(权限审计面大)、4c history 虚拟化(每页20条已合理)。
- **2026-07-09 perf-wave4 收尾**（5 commits 775c59ce..39d2284a，详见 [memory](memory/2026-07-09-perf-wave3-batch-implementation.md) 追加）：logger flush 等在途 gzip 归档(修复 flaky 测试 + 生产停机丢归档风险)；3c UserDetailSheet 剥离为独立 chunk(detailMounted 惰性挂载,2371→1746+592+180 三文件,admin-users-shared 解依赖环)；4b admin/payments 聚合统计走 unstable_cache+`admin-payments-aggregate` tag(type/provider 低基数键,q/日期穿透),epay 三写入点接 revalidateTag max+降级;admin-panel groups/apis/adobe/accounts 4 Tab 全剥离为 dynamic chunk(5331→3728 行,apis20/adobe34/groups11 props)。4c history 虚拟化确认不做(每页20条已合理)。

## 关键架构事实

- 5 个 v1 handler 最终汇入 `apps/web/src/features/image-generation/operations.ts` 同一管线（`runImageGenerationForUser`）
- 财务真相在 `credits_transaction`（双重记账），不在 `generation` 行；`generation` 仅历史/画廊展示
- 扣费幂等键：`consumeCredits(sourceRef)` + `credits_transaction (type, source_ref)` 偏唯一索引（opt-in，不传则行为不变）
- [模型定价规则一阶段](plan/2026-07-04-model-pricing-rules.md)：采纳 New API 倍率结构但继续以 credits 为财务单位；新增 DB-free `@repo/shared/model-pricing` resolver，仅算价和快照，不接入扣费。
- 发放/退款幂等键：`credits_batch (source_type, source_ref)` 偏唯一索引
