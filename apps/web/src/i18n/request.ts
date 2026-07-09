import { getRequestConfig } from "next-intl/server";

import { loadMessageGroups, MESSAGE_GROUP_IDS } from "./message-loader";
import { routing } from "./routing";

/**
 * 请求级别的国际化配置
 *
 * 根据请求的语言加载对应的翻译消息。
 *
 * B-P1-1：messages 已按命名空间分组拆分到 messages/<locale>/<group>.json
 * （common/marketing/auth/dashboard/docs/admin）。服务端 `getTranslations` 仍依赖
 * request.ts 提供的全量消息，因此这里继续合并全部分组；客户端 Provider 会在各
 * route group layout 中按需下发更小的消息子集，减少 hydration payload。
 */
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as "en" | "zh")) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: await loadMessageGroups(locale, MESSAGE_GROUP_IDS),
  };
});
