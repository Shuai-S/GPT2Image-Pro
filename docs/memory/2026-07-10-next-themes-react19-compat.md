# 2026-07-10 next-themes React 19 兼容补丁

## 问题

Next.js 16.2.9、React 19.2.7 与 `next-themes@0.4.6` 组合下，首页开发环境报告：

```text
Encountered a script tag while rendering React component.
Scripts inside React components are never executed when rendering on the client.
```

根因是 `next-themes` 的 `ThemeScript` 在 SSR 和客户端重渲染时都返回内联
`<script>`。SSR 脚本用于在水合前恢复本地主题，必须保留；客户端再次返回脚本既不会
执行，也会触发 React 19 告警。

上游证据：

- 问题：<https://github.com/pacocoursey/next-themes/issues/387>
- 待合并修复：<https://github.com/pacocoursey/next-themes/pull/386>

## 当前处理

- 官方最新稳定版仍为 `0.4.6`，没有可直接升级的正式修复版。
- `1.0.0-beta.0` 是预发布版，已发布产物仍会在客户端返回脚本，不作为修复来源。
- `pnpm-workspace.yaml` 通过 `patchedDependencies` 固定
  `patches/next-themes@0.4.6.patch`。
- 补丁与上游 PR #386 同义：浏览器端 `ThemeScript` 返回 `null`；SSR 继续输出原主题
  初始化脚本和 nonce。
- 不切换第三方 fork，避免为一处兼容告警扩大依赖来源、主题存储和水合行为的审计面。

回归测试：

- `packages/shared/src/components/providers.test.tsx`：客户端渲染不得产生 `<script>`。
- `packages/shared/src/components/providers-ssr.test.tsx`：服务端必须保留主题初始化脚本。

## 切换官方稳定版

只有当 `next-themes` 新的官方稳定版本包含 PR #386 或等价修复时才移除补丁：

1. 核对已发布 CJS/ESM 产物，确认客户端不再返回 `ThemeScript`。
2. 从 `pnpm-workspace.yaml` 删除 `patchedDependencies` 条目，并删除补丁文件。
3. 升级 `apps/web` 与 `packages/shared` 的 `next-themes`，更新 frozen lockfile。
4. 运行 Provider 两项回归、全仓 lint/typecheck/test/build。
5. 在开发模式硬刷新首页，验证控制台无脚本告警，light/dark/system 切换及刷新无闪烁。
