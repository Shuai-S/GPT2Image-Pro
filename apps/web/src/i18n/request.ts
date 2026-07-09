import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

/**
 * 请求级别的国际化配置
 *
 * 根据请求的语言加载对应的翻译消息。
 *
 * B-P1-1：messages 已按命名空间分组拆分到 messages/<locale>/<group>.json
 * （common/marketing/auth/dashboard/docs/admin）。此处仍合并为全量 messages
 * 下发，语义与拆分前一致，避免漏 key 导致运行时缺失翻译。
 *
 * 后续可选项（路由裁剪，B-P1-1 第二阶段）：在 [locale]/layout.tsx 仅传 common
 * 命名空间，各 page 按需 await 加载对应分组；该改造需逐页校验 useTranslations
 * 的 namespace 覆盖，工作量与风险较大，本次只完成拆分与加载入口切换。
 */
const messageGroupIds = [
  "common",
  "marketing",
  "auth",
  "dashboard",
  "docs",
  "admin",
] as const;

type Messages = Record<string, unknown>;

/**
 * 合并所有命名空间分组为单个 messages 对象。
 *
 * @param locale 当前请求语言。
 * @returns 合并后的全量 messages（key 为顶层命名空间）。
 */
async function loadAllMessages(locale: string): Promise<Messages> {
  const messages: Messages = {};
  for (const groupId of messageGroupIds) {
    const mod = (await import(`../../messages/${locale}/${groupId}.json`)) as {
      default: Messages;
    };
    Object.assign(messages, mod.default);
  }
  return messages;
}

export default getRequestConfig(async ({ requestLocale }) => {
  // 获取请求的语言
  let locale = await requestLocale;

  // 验证语言是否有效，无效则使用默认语言
  if (!locale || !routing.locales.includes(locale as "en" | "zh")) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    // 按命名空间分组加载并合并为全量 messages
    messages: await loadAllMessages(locale),
  };
});