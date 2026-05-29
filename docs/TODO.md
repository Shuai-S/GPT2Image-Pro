# TODO

> 来源：2026-05-29 多 Agent 安全审计（`docs/security-audit-2026-05.md`）。
> 高危的经济损失 / 入侵口子已在 `dev` 修复（提交 2beb0e0 / b69c10b / 14a88d8 / 07d7a18）。
> 本清单只记录**仍真实存在的代码层问题**。

## 仍存在的代码层问题（待办）

- [ ] **成本放大（中危·经济）**：`quality`、`thinking/reasoning.effort` 等高成本参数不计入积分定价（`resolution.ts`）；`/v1/chat/completions` 纯文本按固定 1 积分/轮。上游成本可能数倍于收费，长期亏损。需做定价决策后实现。
- [ ] **v1 无 per-key / per-user 频率限流（中危）**：单个 key 可高频刷请求拖垮上游成本。需在各 v1 handler 顶部加滑窗限流（独立于中间件的 per-IP）。
- [ ] **generations 存储对象无鉴权（中低危）**：仅靠 `userId/nanoid(32)` 不可猜 URL 保护。建议 generations 桶走 session+属主校验或短时签名 URL（avatars 保持公开）。**改动前需 UI 实测**，避免破坏全站图片渲染 / 外链分享 / og:image。
- [ ] **SSRF DNS 重绑定残留（低危）**：已堵静态内网 + 重定向跳内网；"校验后连接时重解析到内网"需在连接层 pin 已校验 IP 才能根除。

## 部署前必做

- [ ] 应用 `packages/database/drizzle/0025_credits_batch_idempotency.sql` 前，先排查 `credits_batch` 是否已有重复 `(source_type, source_ref)`（历史双发遗留），否则唯一索引创建会失败。排查 SQL 见迁移文件头注释。

---

运维层补救（轮换密钥 / 配置 Upstash 等）见 `docs/security-audit-2026-05.md` C 节，本清单不展开。
