/**
 * 客户端本地时间展示组件
 *
 * 职责：接收服务端传来的时间戳，在浏览器中按用户本机时区格式化展示。
 * 使用方：仍由 Server Component 渲染的系统页面。
 * 关键依赖：Intl.DateTimeFormat、next-intl locale。
 */
"use client";

import { useLocale } from "next-intl";
import { useEffect, useMemo, useState } from "react";

type LocalDateTimeProps = {
  value: Date | string | number | null | undefined;
  options: Intl.DateTimeFormatOptions;
  fallback?: string;
  className?: string;
};

/**
 * 把任意时间输入归一为 ISO 时间戳。
 *
 * @param value 服务端传来的时间点。
 * @returns ISO 字符串；空值或非法日期返回空字符串。
 * @sideEffects 无。
 * @failureMode 非法日期不抛错，交由组件展示 fallback。
 */
function toIsoTimestamp(value: LocalDateTimeProps["value"]) {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/**
 * 把应用语言转换为 Intl 日期时间 locale。
 *
 * @param locale 应用语言代码。
 * @returns Intl 可识别的 locale。
 * @sideEffects 无。
 */
function getDateTimeLocale(locale: string) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

/**
 * 在浏览器本机时区展示时间点。
 *
 * @param props.value 服务端传来的时间点。
 * @param props.options Intl 格式化选项。
 * @param props.fallback 无值或非法日期时的文本。
 * @param props.className time 元素样式。
 * @returns time 元素。
 * @sideEffects hydration 后读取浏览器本机时区并更新展示文本。
 * @failureMode Intl 不可用或日期非法时展示 fallback/原始时间戳，页面不崩溃。
 */
export function LocalDateTime({
  value,
  options,
  fallback = "",
  className,
}: LocalDateTimeProps) {
  const locale = useLocale();
  const timestamp = toIsoTimestamp(value);
  const formatOptions = useMemo(() => options, [options]);
  const [text, setText] = useState(timestamp || fallback);

  useEffect(() => {
    if (!timestamp) {
      setText(fallback);
      return;
    }
    try {
      setText(
        new Intl.DateTimeFormat(
          getDateTimeLocale(locale),
          formatOptions
        ).format(new Date(timestamp))
      );
    } catch {
      setText(timestamp);
    }
  }, [fallback, locale, formatOptions, timestamp]);

  if (!timestamp && !fallback) return null;

  return (
    <time className={className} dateTime={timestamp} suppressHydrationWarning>
      {text}
    </time>
  );
}
