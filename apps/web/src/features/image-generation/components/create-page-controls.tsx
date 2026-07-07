"use client";

import { Input } from "@repo/ui/components/input";
import { useEffect, useRef } from "react";

// 创作页基础表单控件:把可复用且无业务状态的控件从主页面拆出。

/**
 * 渲染数字输入 + 鼠标滚轮增减的数量/并发控件。
 *
 * @param props.id 表单控件 id,用于 label 关联。
 * @param props.value 当前数值。
 * @param props.max 当前允许上限。
 * @param props.disabled 禁用时阻止输入和滚轮调整。
 * @param props.onChange 数值变化回调,输出已钳制到 1..max 的整数。
 * @returns 可键盘输入和滚轮调整的数字控件。
 * @sideEffects 用户滚轮或输入时触发 onChange。
 * @failureMode 非数字输入回退为 1。
 */
export function ConcurrencyNumberInput({
  id,
  value,
  max,
  disabled,
  onChange,
}: {
  id: string;
  value: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = wrapperRef.current;
    if (!element || disabled) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 1 : -1;
      onChange(Math.min(max, Math.max(1, Math.floor(value + delta))));
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [value, max, disabled, onChange]);
  return (
    <div ref={wrapperRef} className="w-full">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            Math.min(
              max,
              Math.max(1, Math.floor(Number(event.target.value) || 1))
            )
          )
        }
        className="w-full"
      />
    </div>
  );
}

/**
 * 渲染普通创作张数滑块。
 *
 * @param props.id 表单控件 id,用于 label 关联与可访问性。
 * @param props.label 当前语言下的控件名称。
 * @param props.value 当前张数,调用方负责持久化到运行时状态。
 * @param props.max 当前套餐与页面规则共同允许的最大张数。
 * @param props.disabled 生成中禁用,避免请求参数被中途改写。
 * @param props.onChange 张数变化回调,输出已钳制到 1..max 的整数。
 * @returns 可键盘操作的范围输入控件。
 * @sideEffects 仅在用户拖动时触发 onChange。
 * @failureMode max 异常时兜底为 1,避免产生服务端不接受的 count。
 */
export function ImageCountSlider({
  id,
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const safeMax = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : 1;
  const safeValue = Math.min(safeMax, Math.max(1, Math.floor(value)));
  const fillPercent =
    safeMax <= 1 ? 100 : ((safeValue - 1) / (safeMax - 1)) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-foreground">
          {label}
        </label>
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">
          {safeValue}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={1}
        max={safeMax}
        step={1}
        value={safeValue}
        disabled={disabled}
        aria-valuetext={`${safeValue}`}
        onChange={(event) => {
          const next = Math.floor(Number(event.target.value) || 1);
          onChange(Math.min(safeMax, Math.max(1, next)));
        }}
        className="h-4 w-full cursor-pointer appearance-none rounded-full bg-transparent disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-primary [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-border [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm"
        style={{
          background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${fillPercent}%, var(--border) ${fillPercent}%, var(--border) 100%)`,
        }}
      />
    </div>
  );
}
