"use client";

// 创作原型共享的高级参数字段。基础创作与无限画布通过样式映射复用同一组选项。

import { useState } from "react";

const qualityOptions = [
  { value: "auto", label: "自动" },
  { value: "high", label: "高质量" },
  { value: "medium", label: "均衡" },
] as const;

const channelOptions = [
  { value: "primary", label: "主通道" },
  { value: "backup", label: "备用通道" },
] as const;

const formatOptions = [
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
  { value: "jpeg", label: "JPEG" },
] as const;

const backgroundOptions = [
  { value: "auto", label: "自动" },
  { value: "opaque", label: "不透明" },
  { value: "transparent", label: "透明" },
] as const;

const enhancementOptions = [
  { value: "upscale", label: "高清修复" },
  { value: "generative", label: "生成式修复" },
] as const;

type AdvancedParameterClassNames = {
  container?: string;
  field?: string;
  fieldLegend?: string;
  segmentGroup?: string;
  segmentButton?: string;
};

/**
 * 渲染基础创作和无限画布共用的高级参数字段。
 *
 * @param props.idPrefix 页面或节点唯一前缀，避免多个面板的 label 关联冲突。
 * @param props.classNames 宿主界面的 CSS Module 类名映射。
 * @returns 质量、通道、格式、背景和增强选项。
 * @sideEffects 仅在本地维护增强选项的原型选中状态。
 */
export function PreviewAdvancedParameterFields({
  idPrefix,
  classNames,
}: {
  idPrefix: string;
  classNames: AdvancedParameterClassNames;
}) {
  const [enhancements, setEnhancements] = useState<string[]>([]);

  /** 切换一个可组合的增强能力。 */
  const toggleEnhancement = (enhancement: string) => {
    setEnhancements((current) =>
      current.includes(enhancement)
        ? current.filter((value) => value !== enhancement)
        : [...current, enhancement]
    );
  };

  return (
    <div className={classNames.container}>
      <AdvancedSelectField
        id={`${idPrefix}-quality`}
        label="生成 · 质量档位"
        defaultValue="high"
        options={qualityOptions}
        className={classNames.field}
      />
      <AdvancedSelectField
        id={`${idPrefix}-channel`}
        label="生成 · 生成通道"
        defaultValue="primary"
        options={channelOptions}
        className={classNames.field}
      />
      <AdvancedSelectField
        id={`${idPrefix}-format`}
        label="输出 · 格式"
        defaultValue="png"
        options={formatOptions}
        className={classNames.field}
      />
      <AdvancedSelectField
        id={`${idPrefix}-background`}
        label="输出 · 背景"
        defaultValue="auto"
        options={backgroundOptions}
        className={classNames.field}
      />
      <div className={classNames.field}>
        <span className={classNames.fieldLegend}>增强</span>
        <div className={classNames.segmentGroup}>
          {enhancementOptions.map((option) => (
            <button
              type="button"
              className={classNames.segmentButton}
              data-active={enhancements.includes(option.value)}
              key={option.value}
              onClick={() => toggleEnhancement(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 渲染一个带标签的共享高级参数选择框。
 *
 * @param props.id 可用于 label 关联的唯一控件 ID。
 * @param props.label 用户可见字段名。
 * @param props.defaultValue 原型默认值。
 * @param props.options 可选值与中文标签。
 * @param props.className 宿主字段容器样式。
 * @returns 一个原生 select 字段。
 */
function AdvancedSelectField({
  id,
  label,
  defaultValue,
  options,
  className,
}: {
  id: string;
  label: string;
  defaultValue: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id}>{label}</label>
      <select id={id} defaultValue={defaultValue}>
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
