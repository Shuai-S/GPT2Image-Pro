/**
 * 客户端日期范围时间戳字段
 *
 * 职责：把浏览器本地日期输入转换为毫秒时间戳，通过隐藏字段提交给服务端查询。
 * 使用方：服务端渲染的筛选表单。
 * 关键依赖：浏览器 Date 本地时区解析。
 */
"use client";

import { useMemo, useState } from "react";

type DateRangeTimestampFieldsProps = {
  fromName: string;
  toName: string;
  fromInputId: string;
  toInputId: string;
  fromLabel: string;
  toLabel: string;
  fromValue?: string;
  toValue?: string;
  className?: string;
  inputClassName?: string;
  labelClassName?: string;
};

/**
 * 把毫秒时间戳转换为浏览器本地日期输入值。
 *
 * @param value query 中的毫秒时间戳。
 * @returns YYYY-MM-DD；非法值返回空字符串。
 * @sideEffects 无。
 * @failureMode 非法时间戳不抛错，清空输入即可。
 */
function timestampToDateInput(value?: string) {
  if (!value) return "";
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 把浏览器本地日期输入转换为当天边界的毫秒时间戳。
 *
 * @param value YYYY-MM-DD 日期输入。
 * @param endOfDay 是否取当天末尾。
 * @returns 毫秒时间戳字符串；非法输入返回空字符串。
 * @sideEffects 无。
 * @failureMode 非法日期返回空字符串，服务端不会应用该边界。
 */
function dateInputToTimestamp(value: string, endOfDay: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  );
  return Number.isNaN(date.getTime()) ? "" : String(date.getTime());
}

/**
 * 渲染本地日期输入和对应的时间戳隐藏字段。
 *
 * @param props 表单字段名、标签、初始时间戳和样式。
 * @returns 两个可见日期输入与两个隐藏时间戳字段。
 * @sideEffects 用户修改日期后更新隐藏字段。
 * @failureMode 禁用 JS 时隐藏字段保留服务端传入的时间戳，表单仍可提交既有筛选。
 */
export function DateRangeTimestampFields({
  fromName,
  toName,
  fromInputId,
  toInputId,
  fromLabel,
  toLabel,
  fromValue,
  toValue,
  className = "space-y-1.5",
  inputClassName = "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
  labelClassName,
}: DateRangeTimestampFieldsProps) {
  const [fromDate, setFromDate] = useState(() =>
    timestampToDateInput(fromValue)
  );
  const [toDate, setToDate] = useState(() => timestampToDateInput(toValue));
  const fromTimestamp = useMemo(
    () => dateInputToTimestamp(fromDate, false),
    [fromDate]
  );
  const toTimestamp = useMemo(
    () => dateInputToTimestamp(toDate, true),
    [toDate]
  );

  return (
    <>
      <input type="hidden" name={fromName} value={fromTimestamp} />
      <input type="hidden" name={toName} value={toTimestamp} />
      <div className={className}>
        <label className={labelClassName} htmlFor={fromInputId}>
          {fromLabel}
        </label>
        <input
          id={fromInputId}
          type="date"
          value={fromDate}
          className={inputClassName}
          onChange={(event) => setFromDate(event.target.value)}
        />
      </div>
      <div className={className}>
        <label className={labelClassName} htmlFor={toInputId}>
          {toLabel}
        </label>
        <input
          id={toInputId}
          type="date"
          value={toDate}
          className={inputClassName}
          onChange={(event) => setToDate(event.target.value)}
        />
      </div>
    </>
  );
}
