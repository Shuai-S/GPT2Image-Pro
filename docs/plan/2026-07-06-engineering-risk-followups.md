# 2026-07-06 工程化风险后续专项

## 背景

本轮工程化巡检已将 `pnpm lint` 接入 `@repo/database`、`@repo/shared`、`@repo/ui`、`@repo/web` 四个包，并修复低风险 lint error、输入边界和配置缓存声明问题。以下事项涉及核心交互、财务、UOL 网关或安全策略，不在同一批工程化清理中直接改业务路径。

## 后续专项

1. 创作页 hook 依赖专项
   - 范围：`apps/web/src/features/image-generation/components/create-page-client.tsx`
   - 现状：Biome `useExhaustiveDependencies` warning 已集中到该文件。
   - 原则：按功能块拆分验证，不使用批量自动修复；每个功能块需要覆盖聊天续写、批量生成、瀑布流、附件引用与余额刷新。

2. 积分账户首次创建并发专项
   - 范围：`packages/shared/src/credits/core.ts`
   - 风险：首次创建余额行时先查后插，极端并发下可能触发唯一约束错误。
   - 原则：只改变账户初始化的并发安全性，不改变双重记账、幂等键或扣费/发放语义。

3. UOL capability 网关专项
   - 范围：`packages/shared/src/uol/`
   - 风险：operation 声明的 capability 需要在 `invokeOperation` 单点强制执行。
   - 原则：先补访问测试，再接能力矩阵；能力来源必须复用 `plan-capabilities.ts`。

4. MCP JSON Schema 专项
   - 范围：`packages/shared/src/mcp/*tool-factory.ts`
   - 风险：Zod v4 schema 转换退化会影响 Agent 参数提示。
   - 原则：抽共享转换器并补 `string/number/boolean/enum/array/object/optional/default` 测试。

5. SSRF IP 保留网段专项
   - 范围：`packages/shared/src/security/ip-validation.ts`
   - 风险：私有/保留地址覆盖需要表驱动测试兜底。
   - 原则：纯函数测试先行，再扩展 IPv4、IPv6 与 IPv4-mapped IPv6 覆盖。
