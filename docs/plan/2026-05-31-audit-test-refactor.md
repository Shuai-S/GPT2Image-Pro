# 2026-05-31 大规模测试 / 审计 / 重构 计划

> 授权来源：用户 2026-05-31 明确指令"workflow 大规模测试与审计，确保单元测试高覆盖率，找出代码中潜藏的风险和后续不易维护需要重构的部分，进行大规模安全审计和安全分析，实际通过浏览器进行UI测试确保无bug"。
> 经 AskUserQuestion 二次确认：
> - 浏览器 UI 测试目标 = **生产库 + 真实 API 全流程（一次性测试账号）**。用户已接受会写真实数据库、消耗真实积分、调用付费上游。
> - 修复范围 = **报告 + 全部修复（含大重构）**。授权对 create-page-client.tsx 等大文件做结构性重构。
> 全部工作在 `dev` 分支。`main` 仅用户明确要求时合并。

## 基线（2026-05-31）

- DB-free 单测全绿：packages/shared 10 文件 / 45 测试；apps/web 20 文件 / 126 测试 = 171 通过。
- 既有审计：docs/security-audit-2026-05.md（高危多数已修）；docs/TODO.md 列出仍存在的代码层问题。
- 远程库：DATABASE_URL 指向 104.248.226.34:8888（生产/暂存）。PLATFORM_API_KEY 为真实付费图像 API。

## 阶段

### 阶段 A：静态审计（进行中）
- Workflow `gpt2image-static-audit`（run wf_b088fe29-961）：12 子系统 x 3 镜头（覆盖率/可维护性/安全）并行取证 + 逐项对抗式复核 + 汇总。
- 产出：docs/plan/2026-05-31-audit-report.md（确认项，带 file:line）。

### 阶段 B：修复与重构
- 按报告 severity 顺序修复确认的安全/Bug 问题。
- 对识别出的大文件/职责混杂处做结构性重构（含 create-page-client.tsx）。
- 每步 typecheck + test 验证，小步 commit。

### 阶段 C：浏览器 UI 测试（独立测试环境，2026-05-31 改向）
- 决策变更：原定"生产库全流程"不可行——远程 DB 104.248.226.34:8888 从本机不可达（防火墙），本机无 Docker。用户改定"重新部署一套独立测试环境到任意可达服务器"。
- 目标宿主 = `api2`（152.42.197.239，可达，有 Docker v5.1.3 / node v24.14.1 / git）。注意 api2 上跑着无关的 cmpc-* 竞赛系统，必须隔离、不可干扰。
- 隔离栈：独立 Postgres 容器(`gpt2image-test-pg`，绑 127.0.0.1:5433) + 主机 `next dev`(绑 127.0.0.1:3100)；工作目录 `/root/gpt2image-test/repo`(clone dev 分支)。
- 超管：SELF_USE_MODE 自动播种 admin@gpt2image.local，凭据写 `/root/gpt2image-test/super-admin-credentials.txt`。
- 访问：本地 `ssh -L 3100:127.0.0.1:3100 api2` 隧道 → 本地 Playwright 打 http://localhost:3100。不公网暴露。
- 真实生图后端走后端池(DB 配置，非 env)，登录后在后台配置指向 mynav.website 再测生成。
- Playwright MCP 驱动：落地页 → 登录 → 瀑布流(#15/#16) → 后台用户管理(#1) → 关键流程，截图记录，发现 bug 即修(git pull + HMR)。

### 阶段 D：单测覆盖率提升
- 针对审计覆盖率缺口为核心逻辑（积分/扣费/订阅/鉴权/幂等/并发）补 DB-free 单测。
- 目标：核心逻辑高覆盖，全部 turbo typecheck/test 绿。

## 阶段 C 浏览器 UI 测试结果（2026-05-31，已完成）

测试栈：api2 隔离栈（Postgres 容器 5433 + 主机 next dev 3100），本地 SSH 隧道 localhost:3100。超管 admin@gpt2image.local。dev HEAD 853f0c5。

- [x] 落地页 /zh：完整渲染（hero/功能/5档定价/FAQ/页脚/Cookie）HTTP 200。
- [x] 登录/登出：Better Auth 凭据登录正常。
- [x] **#16 数字输入+滚轮**：文生图"重复生成"为数字输入(type=number,max=100=Enterprise并发,min=1)；输入 999 失焦钳制为 100；鼠标滚轮下滚 100→99、上滚 99→100。验证通过。
- [x] **#15 瀑布流**：tier 选择器"每批生成张数(并发)"选项 [1,5,10,20] 默认5；质量/尺寸(尺寸：1024x1024)/背景/思考强度控件齐全；首次进入弹"额度消耗提醒"首次警告。验证通过。
- [x] **#1 用户管理**：新增用户(testuser1)→列表出现(总用户2)；编辑资料(改用户名+邮箱)→列表反映;行操作菜单含"编辑资料/重设密码"；**用建号所设密码成功登录新用户→哈希链路端到端可用**。验证通过。
- [x] 全程控制台 0 error / 0 warning。
- 备注（非 Bug）：注册积分(100)由内部任务异步发放，首屏渲染可能短暂显示余额 0，重载即显示 100（DB 实为 100）。轻微 UX 瑕疵，自愈。

测试环境保留运行，可在修复后 git pull + HMR 复测。SSH 隧道命令：ssh -L 3100:127.0.0.1:3100 api2。

## 修复后冒烟 UI 复测（2026-05-31，dev HEAD 114054a）

api2 隔离栈 git pull 到 114054a、清 `.next` 后重启 next dev，本地隧道 localhost:3100 驱动 Playwright。覆盖与结论：

- [x] 落地页 /zh、控制台、创作、账单与用量、外接 API：均 200、控制台 0 error。
- [x] 鉴权门：登出后访问 /zh/dashboard 正确 302 到 /zh/sign-in；超管凭据登录成功（证明 protectedAction 新增 banned 中间件对正常用户放行无误）。
- [x] **#1 用户管理（超管）**：用户表渲染 2 行（testuser1-edited / 超管），统计（总用户2/管理员1/封禁0）、搜索/筛选/分页/新增用户/行操作齐全；getAllUsersAction(adminAction) 数据成功加载——S-H5 改的 action 层运行时正常。
- [x] **S-C1 验证**：admin/settings 超管可见"系统设置"tab（canManageSystemSettings=true）。0 error。
- 普通用户访问 admin 路由返回 404（隐藏式访问控制），符合预期。

### 复测中定位的两项问题（均非本轮修复回归）

1. **（既有 latent bug，记入 create-page-client 重构 backlog）** 创作页首次硬加载时 React hydration 不匹配：客户端从 localStorage `gpt2image_create_active_mode_v1` 恢复上次激活模式（如锁定的 waterfall），与服务端默认 text 冲突。清 localStorage 后 0 error。根因在 defer 的 create-page-client.tsx——持久化模式恢复应后置到 useEffect 或按当前套餐能力校正，避免恢复到锁定/不可用模式。低危（React 自动重渲染，页面可用）。
2. **（测试环境产物，非代码问题）** 跨多提交 git pull 后复用旧 `.next`/turbopack 缓存，导致 admin 全区路由 404（清单与新码不一致）。`rm -rf apps/web/.next` 重启后全部恢复。生产 `next build` 全量编译无此问题。复测操作经验：测试环境跨大量提交 pull 后应清 `.next` 再起 dev。

## 阶段 A 审计：已完成

- Workflow 复核确认 128 条（critical 1 / high 27 / medium 58 / low 39 / info 3；security 27 / maintainability 41 / coverage 60）。
- 报告：`docs/plan/2026-05-31-audit-report.md`（每条带 file:line + WHY + 修复建议 + 对抗复核结论）。
- 注意：报告中 file 路径多省略 `gpt2image-pro/` 前缀。

## 阶段 B 修复：进行中

已修复并提交 dev（每条 typecheck+test 验证；当前 shared 50 + web 129 = 179 单测全绿）：

- [x] **S-C1 (critical)** 系统设置写入收紧为 superAdminAction + UI tab 仅超管可见（堵 admin 改 BETTER_AUTH_SECRET 提权/账号接管）。commit 03cc6bd。
- [x] **S-H5 (high)** 用户管理高敏操作加目标权限护栏 `canActOnTargetRole` + 禁止自助铸币（堵 admin 封超管/自助铸币），附 roles.test.ts。commit edbc0d6。
- [x] **S-H1/S-H2 (high)** 聊天历史下载改 fetchPublicImage 堵 SSRF + 25MB 上限；storage 分支限 generations 桶 + 拒穿越堵 IDOR；模块改 DB-free 可测，附 web-history-references.test.ts。commit f1216df。

剩余安全高危（已由 2026-05-31 修复 workflow 落地，见下节）：

- [x] **S-H3 / S-M2** 异步任务 callback_url SSRF：收敛到 safe-image-fetch，提交期 assertPublicCallbackUrl 强制 https+公网、投递期 fetchPublicCallback 逐跳 redirect:manual 复检（堵 TOCTOU）。commit 0babd1f。
- [x] **S-H4 / S-H7** 管理员封禁对第一方会话不生效：protectedAction 中间件复查 session.user.banned + banUserAction 删目标全部 session 行。commit 0babd1f。
- [x] **S-H6** 注册验证码无每邮箱冷却：sendRegistrationVerificationCode 按上一封 createdAt 计算冷却、期内拒发。commit 7102b12。
- [ ] **S-H2 残留（未修）** 同桶跨用户读需把请求方 userId 透传至 downloadWebHistoryImageReference 做 key 前缀校验（需改 WebImageParams 多层热路径，高回归风险，留待专项）。

## 阶段 B/D 修复 workflow 结果（2026-05-31，已完成）

授权："workflow 修复全部问题"。结构：梳理（按文件连通分量切分、排除已修 4 条 + defer 上帝组件）→ 并行修复（15 单元各改自己文件 + 补 DB-free 测试）→ 验证（typecheck+test，有界 repair）。

- **切分**：可修复单元 15、defer 4。
- **已修确认项 94 条；未修 23 条**（均带理由，详见审计报告与下方 backlog）。
- **终验全绿**（本机独立复跑）：typecheck shared+web 通过；test shared 25 文件/235 + web 33 文件/257 = **492 通过**（修复前 179，净增 +313）。
- **dev 提交（9 个主题组）**：0babd1f 封禁会话+回调SSRF / 80b1d8b 存储越权 / d2a51f4 限流fail-open+可信代理 / d41c5c3 moderate恒定时间 / 7102b12 注册冷却+验证状态机 / 4fdd24a external-api覆盖 / c58f6d2 支付覆盖 / d6b804b 订阅+系统设置覆盖 / 01906e0 生成/任务/会话/上传覆盖。

### 未修 backlog（23 条，需跨文件重构 / DB 迁移 / 改既有支付鉴权行为，超"小修不破坏行为"边界）

- **C-H2** operations.ts 鉴权/数量/上下文门闩抽 validateGenerationRequest：门闩交织在 1100 行 runQueuedImageGenerationForUser，干净抽取需重排序、对计费/授权管线回归风险高。
- **C-M5/C-H3 DB 部分** reserveExternalApiKeyCredits 原子 UPDATE 0 行的 DB-path 集成断言未补（纯函数已测）。
- **S-M11** Creem 不校验实付金额/币种：单位/币种不一致，硬校验会误拒真实支付，需先对齐 Creem 产品价配置（security-audit-2026-05.md A11 已记录团队推迟）。
- **S-L1** consumeCredits 幂等按 userId 归属：需改财务核心查询 + 改偏唯一索引 DB 迁移。
- **S-L7** generations 桶 session/属主鉴权：行为性改动，落地前须 UI 实测以免破坏全站图片渲染/外链/og:image。
- **M-H5 残留** admin/layout.tsx 集中守卫：需新建 layout（载荷部分已由 canActOnTargetRole 实现，本次仅补会话删除）。
- **M-M7/M-M10/M-M15/M-M16/M-M17/M-L8/M-L11/M-L12/M-L16/M-M24/M-M27/M-L25/M-M28/S-M8/S-L2/C-M33/C-L23/C-L38** 等：均为跨 unit DRY 合并、新增共享模块、改公共签名或缓存失效机制，属中等以上重构，按小修原则未做（详见审计报告与 workflow fixSummary.unfixed）。

### Defer（4 个上帝组件，结构性拆分，需人在环专项 + 重新 UI 实测）

- **M-H7** create-page-client.tsx 9233 行（CreatePageClient ~7480 行，含已实测 #15/#16）+ create-runtime-store.tsx / reference-handoff.ts / waterfall-warning-popup.tsx。用户已点名 defer。
- **M-H2** image-backend-pool/service.ts 5310 行（7+ 职责）+ actions.ts / scheduler-selection.test.ts / nested-groups.ts。用户已点名 defer。
- **M-H3** image-backend-pool/admin-panel.tsx 4350 行 client 上帝组件（25+ useState）。
- **M-M23** system-settings-panel.tsx 1825 行巨型 'use client'。

## 阶段 D 补单测：已完成（随修复 workflow 落地）

- [x] 早期：roles.test.ts(5) + web-history-references.test.ts(3)。
- [x] workflow：external-api(quota-math/auth-token/models/resolution/chat-completions-utils)、payment(creem 16/epay 18/epay-fulfillment 6/subscription-upgrade 8)、subscription(user-plan 状态机/upload-limits/plan-capabilities)、system-settings(env-file/index/defaults)、moderation(risk/index/proxy-secret)、auth(roles 矩阵/email-domain/registration-core/role-server)、storage(utils/local/providers/route)、generation(settlement/maintenance/queue/batch-runner/streaming)、session-current-core、scheduled-jobs-response、upload validation、credits/packages 等，合计 shared 235 + web 257 = 492 通过。
- [ ] 残留：runImageGenerationForUser 结算门闩（C-H2 validateGenerationRequest）与 reserveExternalApiKeyCredits 的 DB-path 集成断言（C-M5）未抽/未补，见 backlog。

## 风险与注意

- 浏览器测试写真实数据：测试账号与生成内容会留在生产库；测试后视情况清理。
- Windows 本地 `turbo build` 因文件名含 `:` 报 EINVAL（不影响 Linux CI）；dev 模式可行性待验证。
- create-page-client.tsx 约 9000 行：重构前需充分理解其状态机与 runtime store 依赖，避免破坏既有行为。

## 安全修复 workflow 二轮（遗留项，2026-05-31，已落地 dev）

授权："派发 workflow 解决全部遗留安全问题，仅整合到 dev"。7 单元并行修复 + 逐单元对抗复核 + typecheck/test 验证；终验本机复跑全绿（shared 240 + web 272 = 512）。

保留 5 条（复核 accept / 真正闭合且不破坏行为），dev 提交 4208681..6f48522：

- [x] **S-L2** Creem webhook grant 失败不再吞异常（catch throw→外层 500→Creem 重投；幂等 onConflictDoNothing + credits_batch 唯一索引保证不双发）。commit 4208681。
- [x] **S-M11** grant 前金额/币种比对；comparable=false 一律放行+告警，comparable=true 且金额/币种不匹配默认硬拒，防止低价或跨币种支付套取高价权益。`CREEM_WEBHOOK_ENFORCE_AMOUNT=0/false/no/off` 仅作为临时软门闩。
- [x] **S-L1** consumeCredits 两处幂等查询补 `eq(userId)` + 迁移 0029 偏唯一索引收窄为 per-user `(user_id,type,source_ref)` + schema.ts 同步。commit 7ecd855。
- [x] **S-M8** 系统设置经济/安全数值键 per-key min/max 范围校验 + 5 DB-free 测试。commit b81601b。
- [x] **M-H5** 新增 admin/layout.tsx 集中守卫（canViewImageBackendPool 并集粗门，保 observer_admin 合法访问）。commit b240ce7。需 UI 实测。
- [x] **v1 per-key 限流** authenticateExternalApiRequest 以 apiKey.id 加滑窗。commit 6f48522。

回退 2 条（对抗复核发现真实问题，未落 dev）：

- **U3 / S-L7 generations 桶 cookie 鉴权** —— breaksExistingBehavior=true：v1 默认 `response_format=url` 返回绝对存储 URL，外部消费者无 cookie 拉取会全部 401，破坏 v1 契约。须改短时签名 URL。详见 TODO。
- **U7 / SSRF DNS pin** —— securityClosed=false：Next16 每请求 `patchFetch` 重写 `globalThis.fetch`，致 pin 分支生产永不执行 + 测试走生产不可达路径成假绿灯。既有逐跳 redirect:manual 防护仍在。详见 TODO。
