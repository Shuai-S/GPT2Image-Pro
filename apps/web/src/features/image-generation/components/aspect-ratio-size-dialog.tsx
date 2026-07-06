"use client";

// 可复用的图像尺寸控件。使用方包括文生图、图生图、瀑布流/对话生图等需要把画面比例
// 映射为合法输出尺寸的入口；依赖 resolution 工具保证最终尺寸可被服务端接受。
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  AUTO_IMAGE_SIZE,
  normalizeImageSize,
  normalizeValidImageSize,
  parseImageSize,
} from "../resolution";

export type AspectRatioSizeDialogValue = {
  auto: boolean;
  width: number;
  height: number;
  mixWebFirst: boolean;
};

type ImageSizeBase = "1k" | "2k" | "4k";
type ImageAspectRatio =
  | "1:1"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "4:5"
  | "5:4"
  | "16:9"
  | "9:16"
  | "21:9";

type CopyFn = (en: string, zh: string) => string;

const AUTO_RATIO_LABEL = "自动(auto)";

const IMAGE_SIZE_BASES: Array<{
  value: ImageSizeBase;
  label: string;
  edge: number;
}> = [
  { value: "1k", label: "1K", edge: 1024 },
  { value: "2k", label: "2K", edge: 2048 },
  { value: "4k", label: "4K", edge: 3840 },
];

const IMAGE_SIZE_MATRIX = {
  "1:1": {
    "1k": [1024, 1024],
    "2k": [2048, 2048],
    "4k": [2880, 2880],
  },
  "2:3": {
    "1k": [688, 1024],
    "2k": [1360, 2048],
    "4k": [2336, 3520],
  },
  "3:2": {
    "1k": [1024, 688],
    "2k": [2048, 1360],
    "4k": [3520, 2336],
  },
  "3:4": {
    "1k": [768, 1024],
    "2k": [1536, 2048],
    "4k": [2480, 3312],
  },
  "4:3": {
    "1k": [1024, 768],
    "2k": [2048, 1536],
    "4k": [3312, 2480],
  },
  "4:5": {
    "1k": [816, 1024],
    "2k": [1632, 2048],
    "4k": [2560, 3216],
  },
  "5:4": {
    "1k": [1024, 816],
    "2k": [2048, 1632],
    "4k": [3216, 2560],
  },
  "9:16": {
    "1k": [576, 1024],
    "2k": [1152, 2048],
    "4k": [2160, 3840],
  },
  "16:9": {
    "1k": [1024, 576],
    "2k": [2048, 1152],
    "4k": [3840, 2160],
  },
  "21:9": {
    "1k": [1024, 432],
    "2k": [2048, 864],
    "4k": [3840, 1632],
  },
} satisfies Record<ImageAspectRatio, Record<ImageSizeBase, [number, number]>>;

const IMAGE_ASPECT_RATIOS: Array<{
  value: ImageAspectRatio;
  width: number;
  height: number;
  labelEn: string;
  labelZh: string;
}> = [
  { value: "1:1", width: 1, height: 1, labelEn: "Square", labelZh: "正方形" },
  { value: "2:3", width: 2, height: 3, labelEn: "Portrait", labelZh: "竖版" },
  { value: "3:2", width: 3, height: 2, labelEn: "Landscape", labelZh: "横版" },
  { value: "3:4", width: 3, height: 4, labelEn: "Portrait", labelZh: "竖版" },
  { value: "4:3", width: 4, height: 3, labelEn: "Landscape", labelZh: "横版" },
  { value: "4:5", width: 4, height: 5, labelEn: "Portrait", labelZh: "竖版" },
  { value: "5:4", width: 5, height: 4, labelEn: "Landscape", labelZh: "横版" },
  { value: "9:16", width: 9, height: 16, labelEn: "Mobile", labelZh: "竖版" },
  { value: "16:9", width: 16, height: 9, labelEn: "Wide", labelZh: "横版" },
  { value: "21:9", width: 21, height: 9, labelEn: "Cinema", labelZh: "影院" },
];

/**
 * 根据比例与当前基准档位生成服务端合法尺寸。
 *
 * @param base 隐式沿用的 1K/2K/4K 档位。
 * @param ratio 预设或用户输入的比例。
 * @returns 规整后的 WIDTHxHEIGHT 字符串。
 */
function getNearestSupportedSizeForRatio(
  base: ImageSizeBase,
  ratio: { value?: ImageAspectRatio; width: number; height: number }
) {
  const matrixSize = ratio.value
    ? IMAGE_SIZE_MATRIX[ratio.value]?.[base]
    : null;
  if (matrixSize) {
    return normalizeValidImageSize({
      width: matrixSize[0],
      height: matrixSize[1],
    });
  }

  const fallbackBaseSpec = IMAGE_SIZE_BASES[0];
  if (!fallbackBaseSpec) {
    throw new Error("Image size bases are not configured");
  }
  const baseSpec =
    IMAGE_SIZE_BASES.find((item) => item.value === base) || fallbackBaseSpec;
  const longEdge = baseSpec.edge;
  const landscape = ratio.width >= ratio.height;
  const rawWidth = landscape
    ? longEdge
    : (longEdge * ratio.width) / ratio.height;
  const rawHeight = landscape
    ? (longEdge * ratio.height) / ratio.width
    : longEdge;
  return normalizeValidImageSize({ width: rawWidth, height: rawHeight });
}

/**
 * 管理悬浮预设面板的延迟关闭,避免鼠标从按钮移动到面板时闪退。
 *
 * @returns 面板开关状态与鼠标事件处理器。
 */
function useHoverPresetPanel() {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    },
    []
  );

  const clearCloseTimer = () => {
    if (!closeTimerRef.current) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const openPanel = () => {
    clearCloseTimer();
    setOpen(true);
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 120);
  };

  return { open, setOpen, openPanel, scheduleClose };
}

type ImageSizePresetPanelProps = {
  value: AspectRatioSizeDialogValue;
  tier: ImageSizeBase;
  setTier: (tier: ImageSizeBase) => void;
  applySize: (size: string) => void;
  closePanel: () => void;
  copy: CopyFn;
};

/**
 * 悬浮预设面板内容。文生图/图生图行内控件与工具条尺寸按钮共享同一套比例 UI。
 *
 * @param props.value 当前尺寸值。
 * @param props.tier 当前 1K/2K/4K 档位。
 * @param props.setTier 设置档位。
 * @param props.applySize 应用最终尺寸。
 * @param props.closePanel 选择后关闭面板。
 * @param props.copy 中英文文案选择函数。
 */
function ImageSizePresetPanel({
  value,
  tier,
  setTier,
  applySize,
  closePanel,
  copy,
}: ImageSizePresetPanelProps) {
  const { auto, height, width } = value;
  const previewSize = auto
    ? AUTO_IMAGE_SIZE
    : getNearestSupportedSizeForRatio(tier, {
        width: 1,
        height: 1,
        value: "1:1",
      });
  const selectPreset = (ratio: (typeof IMAGE_ASPECT_RATIOS)[number]) => {
    applySize(getNearestSupportedSizeForRatio(tier, ratio));
    closePanel();
  };

  return (
    <div className="space-y-2.5">
      <div>
        <p className="text-xs font-semibold text-foreground">
          {copy("Canvas ratio", "画面比例")}
          <span className="ml-2 font-normal text-muted-foreground">
            {copy(
              "Final resolution depends on provider policy and model.",
              "最终分辨率受官方政策和模型影响，不做保证。"
            )}
          </span>
        </p>
      </div>
      <div className="grid grid-cols-3 rounded-xl border border-border bg-muted/30 p-1">
        {IMAGE_SIZE_BASES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setTier(item.value)}
            className={`h-8 rounded-lg text-xs font-semibold transition ${
              tier === item.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {IMAGE_ASPECT_RATIOS.map((item) => {
          const itemSize = getNearestSupportedSizeForRatio(tier, item);
          const active =
            !auto && itemSize === normalizeImageSize(width, height);
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => selectPreset(item)}
              className={`flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-lg border px-2 text-center text-xs transition ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background hover:border-primary hover:bg-primary/5 hover:text-primary"
              }`}
            >
              <span
                className={`rounded-[3px] border-2 ${
                  active ? "border-current" : "border-muted-foreground/35"
                }`}
                style={getRatioShapeStyle(item)}
              />
              <span>
                {item.value} {copy(item.labelEn, item.labelZh)}
              </span>
            </button>
          );
        })}
        <div className="flex min-h-14 flex-col justify-center rounded-lg border border-sky-200 bg-sky-50 px-2 text-center text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200">
          <span className="text-[11px] font-medium">
            {copy("Final resolution", "最终分辨率")}
          </span>
          <strong className="mt-0.5 text-base">
            {formatImageSizeForDisplay(
              auto ? previewSize : normalizeImageSize(width, height)
            )}
          </strong>
          <span className="mt-0.5 text-[11px]">
            {auto
              ? copy("Backend decides", "模型自行决定")
              : copy("Current output", "当前输出")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            applySize(AUTO_IMAGE_SIZE);
            closePanel();
          }}
          className={`flex min-h-14 flex-col items-center justify-center rounded-lg border px-2 text-center text-xs font-semibold transition ${
            auto
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-background hover:border-primary hover:bg-primary/5 hover:text-primary"
          }`}
        >
          {copy("Auto", "自动")}
        </button>
      </div>
    </div>
  );
}

/**
 * 把当前尺寸反推为弹窗初始比例与隐式分辨率档位。
 *
 * @param value 当前尺寸值。
 * @returns 输入框初始值与基准分辨率。
 */
function inferAspectRatioState(value: AspectRatioSizeDialogValue): {
  base: ImageSizeBase;
  input: string;
} {
  if (value.auto) {
    return { base: "1k", input: AUTO_RATIO_LABEL };
  }

  const normalized = normalizeImageSize(value.width, value.height);
  for (const base of IMAGE_SIZE_BASES) {
    for (const ratio of IMAGE_ASPECT_RATIOS) {
      if (getNearestSupportedSizeForRatio(base.value, ratio) === normalized) {
        return { base: base.value, input: ratio.value };
      }
    }
  }

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(value.width, value.height) || 1;
  return {
    base: "1k",
    input: `${Math.round(value.width / divisor)}:${Math.round(
      value.height / divisor
    )}`,
  };
}

/**
 * 把尺寸展示成用户更容易扫读的格式。
 *
 * @param size WIDTHxHEIGHT 或 auto。
 * @returns 展示文本。
 */
function formatImageSizeForDisplay(size: string) {
  return size === AUTO_IMAGE_SIZE ? AUTO_RATIO_LABEL : size.replace("x", "×");
}

/**
 * 解析直接输入的分辨率，兼容 1024x1024 与 1024×1024。
 *
 * @param value 输入框内容。
 * @returns 自动标记或规整后的尺寸；无法解析时返回 null。
 */
function parseResolutionInput(value: string) {
  const normalized = value.trim().toLowerCase().replace("×", "x");
  if (
    normalized === "" ||
    normalized === AUTO_IMAGE_SIZE ||
    normalized === "自动"
  ) {
    return { auto: true, size: AUTO_IMAGE_SIZE } as const;
  }
  const dimensions = parseImageSize(normalized);
  if (!dimensions) return null;
  return {
    auto: false,
    size: normalizeValidImageSize(dimensions),
  } as const;
}

/**
 * 生成比例卡片里的简化形状尺寸。
 *
 * @param ratio 比例定义。
 * @returns 可直接传给 style 的宽高。
 */
function getRatioShapeStyle(ratio: { width: number; height: number }) {
  const max = 26;
  const min = 11;
  const landscape = ratio.width >= ratio.height;
  const width = landscape
    ? max
    : Math.max(min, Math.round((max * ratio.width) / ratio.height));
  const height = landscape
    ? Math.max(min, Math.round((max * ratio.height) / ratio.width))
    : max;
  return { width, height };
}

/**
 * 行内分辨率控件。直接展示最终分辨率输入框,并通过悬浮预设面板快速套用常见比例。
 *
 * @param props.id 输入框 id。
 * @param props.value 当前尺寸值。
 * @param props.onChange 尺寸变化回调。
 * @param props.disabled 禁用状态。
 * @param props.copy 中英文文案选择函数。
 */
export function InlineImageSizeControl({
  id,
  value,
  onChange,
  disabled,
  copy,
}: {
  id: string;
  value: AspectRatioSizeDialogValue;
  onChange: (value: AspectRatioSizeDialogValue) => void;
  disabled?: boolean;
  copy: CopyFn;
}) {
  const { auto, height, mixWebFirst, width } = value;
  const initial = inferAspectRatioState({ auto, height, mixWebFirst, width });
  const [tier, setTier] = useState<ImageSizeBase>(initial.base);
  const [draft, setDraft] = useState(
    auto ? AUTO_IMAGE_SIZE : normalizeImageSize(width, height)
  );
  const presetPanel = useHoverPresetPanel();
  const parsedDraft = parseResolutionInput(draft);
  const draftInvalid = Boolean(draft.trim()) && !parsedDraft;

  useEffect(() => {
    const next = inferAspectRatioState({ auto, height, mixWebFirst, width });
    setTier(next.base);
    setDraft(auto ? AUTO_IMAGE_SIZE : normalizeImageSize(width, height));
  }, [auto, height, mixWebFirst, width]);

  const applySize = (size: string) => {
    if (size === AUTO_IMAGE_SIZE) {
      setDraft(AUTO_IMAGE_SIZE);
      onChange({
        auto: true,
        width,
        height,
        mixWebFirst: false,
      });
      return;
    }

    const dimensions = parseImageSize(size);
    if (!dimensions) return;
    setDraft(size);
    onChange({
      auto: false,
      width: dimensions.width,
      height: dimensions.height,
      mixWebFirst: false,
    });
  };

  const commitDraft = () => {
    const parsed = parseResolutionInput(draft);
    if (!parsed) return;
    applySize(parsed.size);
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            }
          }}
          disabled={disabled}
          placeholder="1024x1024"
          className="h-11 rounded-xl"
        />
        <Popover open={presetPanel.open} onOpenChange={presetPanel.setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="h-11 gap-2 rounded-xl px-4"
              onMouseEnter={presetPanel.openPanel}
              onMouseLeave={presetPanel.scheduleClose}
            >
              {copy("Presets", "预设比例")}
              <ChevronDown className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="max-h-[70vh] w-[min(86vw,21rem)] overflow-y-auto p-2"
            onMouseEnter={presetPanel.openPanel}
            onMouseLeave={presetPanel.scheduleClose}
          >
            <ImageSizePresetPanel
              value={value}
              tier={tier}
              setTier={setTier}
              applySize={applySize}
              closePanel={() => presetPanel.setOpen(false)}
              copy={copy}
            />
          </PopoverContent>
        </Popover>
      </div>
      {draftInvalid && (
        <p className="text-xs text-destructive">
          {copy(
            "Use WIDTHxHEIGHT, for example 1024x1024.",
            "请使用 WIDTHxHEIGHT 格式，例如 1024x1024。"
          )}
        </p>
      )}
    </div>
  );
}

/**
 * 工具条尺寸按钮。复用行内分辨率控件的悬浮预设面板,用于对话与瀑布流入口。
 *
 * @param props.label 按钮文本。
 * @param props.value 当前尺寸值。
 * @param props.onChange 尺寸变化回调。
 * @param props.disabled 禁用状态。
 * @param props.className 按钮样式。
 * @param props.title 按钮提示。
 * @param props.copy 中英文文案选择函数。
 */
export function ImageSizePresetButton({
  label,
  value,
  onChange,
  disabled,
  className,
  title,
  copy,
}: {
  label: string;
  value: AspectRatioSizeDialogValue;
  onChange: (value: AspectRatioSizeDialogValue) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  copy: CopyFn;
}) {
  const { auto, height, mixWebFirst, width } = value;
  const initial = inferAspectRatioState(value);
  const [base, setBase] = useState<ImageSizeBase>(initial.base);
  const presetPanel = useHoverPresetPanel();

  useEffect(() => {
    const next = inferAspectRatioState({
      auto,
      height,
      mixWebFirst,
      width,
    });
    setBase(next.base);
  }, [auto, height, mixWebFirst, width]);

  const applySize = (size: string) => {
    if (size === AUTO_IMAGE_SIZE) {
      onChange({
        auto: true,
        width,
        height,
        mixWebFirst: false,
      });
      return;
    }

    const dimensions = parseImageSize(size);
    if (!dimensions) return;
    onChange({
      auto: false,
      width: dimensions.width,
      height: dimensions.height,
      mixWebFirst: false,
    });
  };

  return (
    <Popover open={presetPanel.open} onOpenChange={presetPanel.setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={className}
          title={title}
          onMouseEnter={presetPanel.openPanel}
          onMouseLeave={presetPanel.scheduleClose}
        >
          {label}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-[70vh] w-[min(86vw,21rem)] overflow-y-auto p-2"
        onMouseEnter={presetPanel.openPanel}
        onMouseLeave={presetPanel.scheduleClose}
      >
        <ImageSizePresetPanel
          value={value}
          tier={base}
          setTier={setBase}
          applySize={applySize}
          closePanel={() => presetPanel.setOpen(false)}
          copy={copy}
        />
      </PopoverContent>
    </Popover>
  );
}
