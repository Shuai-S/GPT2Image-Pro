# 2026-07-06 工程化风险后续专项

## 背景

本轮工程化巡检已将 `pnpm lint` 接入 `@repo/database`、`@repo/shared`、`@repo/ui`、`@repo/web` 四个包，并修复低风险 lint error、输入边界和配置缓存声明问题。以下事项涉及核心交互、财务、UOL 网关或安全策略，不在同一批工程化清理中直接改业务路径。

## 后续专项

1. 创作页 hook 依赖专项（已完成）
   - 范围：`apps/web/src/features/image-generation/components/create-page-client.tsx`
   - 现状：Biome `useExhaustiveDependencies` warning 已清零。
   - 原则：按功能块拆分验证，不使用批量自动修复；每个功能块需要覆盖聊天续写、批量生成、瀑布流、附件引用与余额刷新。

2. 积分账户首次创建并发专项（已完成）
   - 范围：`packages/shared/src/credits/core.ts`
   - 现状：首次创建余额行改为 `onConflictDoNothing` 后重读，极端并发下不再把唯一约束竞争暴露为业务失败。
   - 原则：只改变账户初始化的并发安全性，不改变双重记账、幂等键或扣费/发放语义。

3. UOL capability 网关专项（已完成）
   - 范围：`packages/shared/src/uol/`
   - 现状：`invokeOperation` 已在单点校验 API key Principal 的 operation capability，并复用 `plan-capabilities.ts` 能力矩阵。
   - 原则：先补访问测试，再接能力矩阵；能力来源必须复用 `plan-capabilities.ts`。

4. MCP JSON Schema 专项（已完成）
   - 范围：`packages/shared/src/mcp/*tool-factory.ts`
   - 现状：已抽共享 Zod 转 JSON Schema 转换器，admin/user MCP 工具共用，覆盖基础类型、枚举、数组、对象、optional/default。
   - 原则：抽共享转换器并补 `string/number/boolean/enum/array/object/optional/default` 测试。

5. SSRF IP 保留网段专项（已完成）
   - 范围：`packages/shared/src/security/ip-validation.ts`
   - 现状：已补 IPv4、IPv6、IPv4-mapped IPv6 表驱动测试，并扩展文档网段、IPv6 组播/文档/隧道地址等保留段覆盖。
   - 原则：纯函数测试先行，再扩展 IPv4、IPv6 与 IPv4-mapped IPv6 覆盖。
