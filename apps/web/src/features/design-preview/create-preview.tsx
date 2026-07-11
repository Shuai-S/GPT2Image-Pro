"use client";

// 基础创作原型。模拟匿名草稿、统一生成输入器、结果聚焦、最近批次与局部重绘。

import {
  Brush,
  Check,
  ChevronDown,
  ImagePlus,
  Maximize2,
  Settings2,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import Image from "next/image";
import { type CSSProperties, useState } from "react";
import {
  ArtworkFocus,
  type ArtworkFocusRect,
  getArtworkFocusOrigin,
} from "./artwork-focus";
import type { AuthRequestContext } from "./auth-overlay-preview";
import styles from "./design-preview.module.css";
import {
  createSamples,
  getArtwork,
  type HistoryBatch,
  historyBatches,
  modelOptions,
} from "./mock-data";
import {
  getPreviewImageSize,
  isPreviewCustomResolutionValid,
  normalizePreviewCustomResolution,
  type PreviewImageSizeTier,
  type PreviewRatioValue,
  previewImageRatioPresets,
  previewImageSizeTiers,
} from "./ratio-presets";

type ComposerPanel = "model" | "ratio" | "advanced" | null;

const historyWheelPoints = [
  { x: 120, y: "20.33%" },
  { x: 78, y: "35.25%" },
  { x: 62, y: "50%" },
  { x: 78, y: "64.75%" },
  { x: 120, y: "79.67%" },
] as const;

const continuedGenerationImageSets = [
  ["art-06", "art-10", "art-05", "art-08"],
  ["art-12", "art-08", "art-04", "art-05"],
  ["art-10", "art-06", "art-12", "art-04"],
] as const;

/**
 * 渲染基础创作空态或结果态。
 *
 * @param props.showResults 是否展示模拟生成结果。
 * @param props.onShowResults 登录完成或直接预览后切换到结果态。
 * @param props.onOpenGallery 打开私人图库视图。
 * @returns 完整基础创作工作台。
 */
export function CreatePreview({
  showResults,
  authenticated,
  onShowResults,
  onOpenGallery,
  onRequireAuthentication,
}: {
  showResults: boolean;
  authenticated: boolean;
  onShowResults: () => void;
  onOpenGallery: () => void;
  onRequireAuthentication: (
    onAuthenticated: () => void,
    context: AuthRequestContext
  ) => void;
}) {
  const [prompt, setPrompt] = useState(
    showResults ? "一座漂浮在雾海上方的古老观测站，电影感宽幅构图" : ""
  );
  const [activePanel, setActivePanel] = useState<ComposerPanel>(null);
  const [selectedModelId, setSelectedModelId] = useState("gpt-image-2");
  const [count, setCount] = useState(showResults ? 4 : 1);
  const [ratio, setRatio] = useState<PreviewRatioValue>("16:9");
  const [sizeTier, setSizeTier] = useState<PreviewImageSizeTier>("2k");
  const [customResolution, setCustomResolution] = useState({
    width: 2048,
    height: 1152,
  });
  const [focusedArtwork, setFocusedArtwork] = useState<{
    artworkId: string;
    originRect: ArtworkFocusRect;
  } | null>(null);
  const [recentBatches, setRecentBatches] =
    useState<HistoryBatch[]>(historyBatches);
  const [generationSequence, setGenerationSequence] = useState(0);
  const [activeBatchId, setActiveBatchId] = useState("batch-01");
  const [inpaintMode, setInpaintMode] = useState(false);

  const selectedModel =
    modelOptions.find((model) => model.id === selectedModelId) ??
    modelOptions[0];
  const activeBatch =
    recentBatches.find((batch) => batch.id === activeBatchId) ??
    recentBatches[0];
  const visibleArtworkIds = showResults
    ? (activeBatch?.imageIds.slice(0, count) ?? [])
    : [];
  const selectedArtwork = focusedArtwork
    ? getArtwork(focusedArtwork.artworkId)
    : getArtwork(visibleArtworkIds[0] ?? "art-04");

  /**
   * 完成一次继续生成，把新批次留在中央并将旧批次收进右侧时间轮。
   */
  const completeGeneration = (generationCount: number) => {
    const imageIds =
      continuedGenerationImageSets[
        generationSequence % continuedGenerationImageSets.length
      ] ?? continuedGenerationImageSets[0];
    const batchId = `preview-batch-${Date.now()}`;
    const nextBatch: HistoryBatch = {
      id: batchId,
      time: "刚刚",
      prompt: prompt.trim() || "未命名创作",
      status: "完成",
      imageIds: [...imageIds].slice(0, generationCount),
    };
    setRecentBatches((current) => [
      nextBatch,
      ...current
        .map((batch, index) =>
          index === 0 && batch.time === "刚刚"
            ? { ...batch, time: "片刻前" }
            : batch
        )
        .slice(0, 4),
    ]);
    setGenerationSequence((current) => current + 1);
    setCount(generationCount);
    setActiveBatchId(batchId);
    setFocusedArtwork(null);
    onShowResults();
  };

  /**
   * 模拟受保护生成：未登录时保留草稿并打开登录层，已登录时直接继续生成。
   */
  const requestGeneration = (generationCount: number) => {
    setCount(generationCount);
    if (!authenticated) {
      onRequireAuthentication(() => completeGeneration(generationCount), {
        prompt,
        modelName: selectedModel?.name ?? "GPT Image 2",
        cost: (selectedModel?.cost ?? 3) * generationCount,
      });
      return;
    }
    completeGeneration(generationCount);
  };

  return (
    <main className={styles.canvasSurface}>
      <section className={styles.workbench}>
        <div className={styles.canvasStage}>
          {inpaintMode ? (
            <InpaintStage artworkId={selectedArtwork.id} />
          ) : focusedArtwork ? (
            <ArtworkFocus
              artworkId={focusedArtwork.artworkId}
              originRect={focusedArtwork.originRect}
              prompt={activeBatch?.prompt ?? prompt}
              generatedAt={activeBatch?.time ?? "刚刚"}
              modelName={selectedModel?.name ?? "GPT Image 2"}
              onClose={() => setFocusedArtwork(null)}
              onUseAsReference={() => setFocusedArtwork(null)}
              onInpaint={() => setInpaintMode(true)}
              onOpenGallery={onOpenGallery}
            />
          ) : showResults ? (
            <ResultGrid
              artworkIds={visibleArtworkIds}
              onSelect={(artworkId, originRect) =>
                setFocusedArtwork({ artworkId, originRect })
              }
            />
          ) : (
            <div className={styles.emptyStage}>
              <h2>从一个想法开始</h2>
              <p>描述你想创作的画面，也可以添加一张参考图。</p>
            </div>
          )}
        </div>
      </section>

      {!inpaintMode && (
        <>
          {!showResults && !prompt && activePanel === null && (
            <nav className={styles.dockedSampleList} aria-label="示例提示词">
              {createSamples.map((sample) => (
                <button
                  type="button"
                  className={styles.sampleButton}
                  key={sample}
                  onClick={() => setPrompt(sample)}
                >
                  {sample}
                </button>
              ))}
            </nav>
          )}
          <Composer
            prompt={prompt}
            onPromptChange={setPrompt}
            activePanel={activePanel}
            onPanelChange={setActivePanel}
            selectedModelId={selectedModelId}
            onModelChange={setSelectedModelId}
            count={count}
            onCountChange={setCount}
            ratio={ratio}
            onRatioChange={setRatio}
            sizeTier={sizeTier}
            onSizeTierChange={setSizeTier}
            customResolution={customResolution}
            onCustomResolutionChange={setCustomResolution}
            onGenerate={requestGeneration}
            concealed={Boolean(focusedArtwork)}
          />
        </>
      )}

      {inpaintMode && (
        <InpaintControls
          onClose={() => setInpaintMode(false)}
          onGenerate={() => {
            setInpaintMode(false);
            onShowResults();
          }}
        />
      )}

      {!inpaintMode && !focusedArtwork && (
        <HistoryWheel
          batches={recentBatches}
          activeBatchId={activeBatchId}
          onBatchChange={(batchId) => {
            setActiveBatchId(batchId);
            setFocusedArtwork(null);
            if (!showResults) onShowResults();
          }}
        />
      )}
    </main>
  );
}

/**
 * 渲染唯一生成输入器及其模型、比例和高级参数面板。
 */
function Composer({
  prompt,
  onPromptChange,
  activePanel,
  onPanelChange,
  selectedModelId,
  onModelChange,
  count,
  onCountChange,
  ratio,
  onRatioChange,
  sizeTier,
  onSizeTierChange,
  customResolution,
  onCustomResolutionChange,
  onGenerate,
  concealed = false,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  activePanel: ComposerPanel;
  onPanelChange: (value: ComposerPanel) => void;
  selectedModelId: string;
  onModelChange: (value: string) => void;
  count: number;
  onCountChange: (value: number) => void;
  ratio: PreviewRatioValue;
  onRatioChange: (value: PreviewRatioValue) => void;
  sizeTier: PreviewImageSizeTier;
  onSizeTierChange: (value: PreviewImageSizeTier) => void;
  customResolution: { width: number; height: number };
  onCustomResolutionChange: (value: { width: number; height: number }) => void;
  onGenerate: (generationCount: number) => void;
  concealed?: boolean;
}) {
  const selectedModel =
    modelOptions.find((model) => model.id === selectedModelId) ??
    modelOptions[0];
  const totalCost = (selectedModel?.cost ?? 3) * count;

  return (
    <div
      className={styles.composer}
      data-docked="true"
      data-concealed={concealed}
    >
      <div className={styles.composerTop}>
        <textarea
          className={styles.promptInput}
          aria-label="创作提示词"
          placeholder="描述你想创作的画面"
          rows={1}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
        />
        <button
          type="button"
          className={styles.tinyButton}
          aria-label="添加参考图"
          title="添加参考图"
        >
          <ImagePlus size={17} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.composerControls}>
        <div className={styles.controlGroup}>
          <button
            type="button"
            className={styles.controlButton}
            data-active={activePanel === "model"}
            onClick={() =>
              onPanelChange(activePanel === "model" ? null : "model")
            }
          >
            <WandSparkles size={13} aria-hidden="true" />
            {selectedModel?.name}
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          {activePanel === "model" && (
            <ModelPanel
              selectedModelId={selectedModelId}
              onSelect={(modelId) => {
                onModelChange(modelId);
                onPanelChange(null);
              }}
            />
          )}
        </div>
        <div className={styles.controlGroup}>
          <button
            type="button"
            className={styles.controlButton}
            data-active={activePanel === "ratio"}
            onClick={() =>
              onPanelChange(activePanel === "ratio" ? null : "ratio")
            }
          >
            <Maximize2 size={13} aria-hidden="true" />
            {ratio === "auto"
              ? "自动"
              : ratio === "custom"
                ? `${customResolution.width} × ${customResolution.height}`
                : `${ratio} · ${sizeTier.toUpperCase()}`}
          </button>
          {activePanel === "ratio" && (
            <RatioPanel
              ratio={ratio}
              sizeTier={sizeTier}
              customResolution={customResolution}
              onRatioChange={(value) => {
                onRatioChange(value);
                onPanelChange(null);
              }}
              onSizeTierChange={onSizeTierChange}
              onCustomResolutionChange={onCustomResolutionChange}
            />
          )}
        </div>
        <div className={styles.controlGroup}>
          <button
            type="button"
            className={styles.controlButton}
            data-active={activePanel === "advanced"}
            onClick={() =>
              onPanelChange(activePanel === "advanced" ? null : "advanced")
            }
          >
            <Settings2 size={13} aria-hidden="true" />
            高级
          </button>
          {activePanel === "advanced" && <AdvancedPanel />}
        </div>
        <div className={styles.controlSpacer} />
        <span className={styles.costLabel}>预计 {totalCost} 积分</span>
        <div className={styles.generationControl}>
          <button
            type="button"
            className={styles.generateButton}
            onClick={() => onGenerate(count)}
            disabled={!prompt.trim()}
          >
            <Sparkles size={13} aria-hidden="true" />
            生成 {count} 张
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          <fieldset
            className={styles.generationCountMenu}
            aria-label="生成数量"
          >
            {[1, 2, 3, 4]
              .filter((value) => value !== count)
              .map((value) => (
                <button
                  type="button"
                  key={value}
                  disabled={!prompt.trim()}
                  onClick={() => {
                    onCountChange(value);
                    onGenerate(value);
                  }}
                >
                  生成 {value} 张
                </button>
              ))}
          </fieldset>
        </div>
      </div>
    </div>
  );
}

/**
 * 渲染含定位、单张价格和选中状态的模型列表。
 */
function ModelPanel({
  selectedModelId,
  onSelect,
}: {
  selectedModelId: string;
  onSelect: (modelId: string) => void;
}) {
  return (
    <div className={styles.floatingPanel}>
      <div className={styles.panelHeader}>
        <h3>选择模型</h3>
        <span>价格随尺寸变化</span>
      </div>
      <div className={styles.modelList}>
        {modelOptions.map((model) => (
          <button
            type="button"
            key={model.id}
            className={styles.modelOption}
            data-active={model.id === selectedModelId}
            onClick={() => onSelect(model.id)}
          >
            <span>
              <span className={styles.modelName}>{model.name}</span>
              <span className={styles.modelDetail}>{model.detail}</span>
            </span>
            <span className={styles.modelCost}>
              {model.cost} 积分/张
              {model.id === selectedModelId && <Check size={12} />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 生成比例卡片里的简化形状尺寸。
 *
 * @param ratio 生产环境支持的比例定义。
 * @returns 可直接传给样式属性的稳定宽高。
 */
function getRatioShapeStyle(ratio: { width: number; height: number }) {
  const max = 25;
  const min = 10;
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
 * 渲染与生产系统相同的比例、分辨率档位和 1 至 4 张数量选择器。
 *
 * @param props.ratio 当前比例或自动模式。
 * @param props.sizeTier 当前 1K、2K 或 4K 档位。
 * @param props.onRatioChange 选择比例后应用合法预设尺寸并关闭面板。
 * @param props.onSizeTierChange 切换分辨率档位，面板保持打开。
 * @param props.customResolution 当前已应用的自定义像素分辨率。
 * @param props.onCustomResolutionChange 应用通过系统边界校验的自定义分辨率。
 * @returns 比例形状、预设档位和自定义分辨率输入组成的紧凑面板。
 */
function RatioPanel({
  ratio,
  sizeTier,
  customResolution,
  onRatioChange,
  onSizeTierChange,
  onCustomResolutionChange,
}: {
  ratio: PreviewRatioValue;
  sizeTier: PreviewImageSizeTier;
  customResolution: { width: number; height: number };
  onRatioChange: (value: PreviewRatioValue) => void;
  onSizeTierChange: (value: PreviewImageSizeTier) => void;
  onCustomResolutionChange: (value: { width: number; height: number }) => void;
}) {
  const [customWidthDraft, setCustomWidthDraft] = useState(
    String(customResolution.width)
  );
  const [customHeightDraft, setCustomHeightDraft] = useState(
    String(customResolution.height)
  );
  const customWidth = Number(customWidthDraft);
  const customHeight = Number(customHeightDraft);
  const customResolutionValid = isPreviewCustomResolutionValid(
    customWidth,
    customHeight
  );
  const normalizedCustomResolution = customResolutionValid
    ? normalizePreviewCustomResolution(customWidth, customHeight)
    : null;
  const selectedSize =
    ratio === "auto"
      ? null
      : ratio === "custom"
        ? ([customResolution.width, customResolution.height] as const)
        : getPreviewImageSize(ratio, sizeTier);

  return (
    <div className={`${styles.floatingPanel} ${styles.ratioPanel}`}>
      <div className={styles.panelHeader}>
        <h3>画面比例</h3>
        <span>
          {selectedSize
            ? `${selectedSize[0]} × ${selectedSize[1]}`
            : "模型自行决定"}
        </span>
      </div>
      <fieldset className={styles.ratioTierGroup} aria-label="分辨率档位">
        {previewImageSizeTiers.map((tier) => (
          <button
            type="button"
            data-active={tier.value === sizeTier}
            key={tier.value}
            onClick={() => onSizeTierChange(tier.value)}
          >
            {tier.label}
          </button>
        ))}
      </fieldset>
      <div className={styles.ratioPresetGrid}>
        {previewImageRatioPresets.map((preset) => {
          const size = getPreviewImageSize(preset.value, sizeTier);
          return (
            <button
              type="button"
              className={styles.ratioPreset}
              data-active={preset.value === ratio}
              key={preset.value}
              onClick={() => onRatioChange(preset.value)}
            >
              <span
                className={styles.ratioShape}
                style={getRatioShapeStyle(preset)}
              />
              <span className={styles.ratioPresetCopy}>
                <strong>
                  {preset.value} · {preset.label}
                </strong>
                <span>
                  {size[0]} × {size[1]}
                </span>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className={styles.ratioPreset}
          data-active={ratio === "auto"}
          onClick={() => onRatioChange("auto")}
        >
          <span className={styles.ratioAutoShape}>A</span>
          <span className={styles.ratioPresetCopy}>
            <strong>自动</strong>
            <span>模型自行决定</span>
          </span>
        </button>
      </div>
      <div
        className={styles.customResolutionEditor}
        data-active={ratio === "custom"}
      >
        <span className={styles.fieldLegend}>自定义分辨率</span>
        <input
          type="number"
          min={256}
          max={3840}
          step={16}
          aria-label="自定义分辨率宽度"
          value={customWidthDraft}
          onChange={(event) => setCustomWidthDraft(event.target.value)}
        />
        <span className={styles.customResolutionDivider}>×</span>
        <input
          type="number"
          min={256}
          max={3840}
          step={16}
          aria-label="自定义分辨率高度"
          value={customHeightDraft}
          onChange={(event) => setCustomHeightDraft(event.target.value)}
        />
        <button
          type="button"
          disabled={!customResolutionValid}
          title={
            customResolutionValid
              ? "应用自定义分辨率"
              : "尺寸范围为 256–3840px，宽高比不超过 3:1"
          }
          onClick={() => {
            if (!normalizedCustomResolution) return;
            onCustomResolutionChange({
              width: normalizedCustomResolution[0],
              height: normalizedCustomResolution[1],
            });
            onRatioChange("custom");
          }}
        >
          {normalizedCustomResolution
            ? `应用 · ${normalizedCustomResolution[0]} × ${normalizedCustomResolution[1]}`
            : "尺寸无效"}
        </button>
      </div>
    </div>
  );
}

/**
 * 渲染生成、输出和增强三个高级参数分组。
 */
function AdvancedPanel() {
  return (
    <div className={styles.floatingPanel}>
      <div className={styles.panelHeader}>
        <h3>高级参数</h3>
        <span>只展示当前模型可用项</span>
      </div>
      <div className={styles.advancedPanel}>
        <div className={styles.field}>
          <label htmlFor="preview-quality">生成 · 质量档位</label>
          <select id="preview-quality" defaultValue="high">
            <option value="auto">自动</option>
            <option value="high">高质量</option>
            <option value="medium">均衡</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="preview-channel">生成 · 生成通道</label>
          <select id="preview-channel" defaultValue="primary">
            <option value="primary">主通道</option>
            <option value="backup">备用通道</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="preview-format">输出 · 格式</label>
          <select id="preview-format" defaultValue="png">
            <option value="png">PNG</option>
            <option value="webp">WebP</option>
            <option value="jpeg">JPEG</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="preview-background">输出 · 背景</label>
          <select id="preview-background" defaultValue="auto">
            <option value="auto">自动</option>
            <option value="opaque">不透明</option>
            <option value="transparent">透明</option>
          </select>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLegend}>增强</span>
          <div className={styles.segmentGroup}>
            <button type="button" className={styles.segmentButton}>
              高清修复
            </button>
            <button type="button" className={styles.segmentButton}>
              生成式修复
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 渲染当前批次的完整作品网格。
 *
 * @param props.artworkIds 当前批次作品 ID。
 * @param props.onSelect 返回作品 ID 与真实可见图片区域，进入共享聚焦查看器。
 * @returns 不裁切作品内容的两列结果画布。
 */
function ResultGrid({
  artworkIds,
  onSelect,
}: {
  artworkIds: string[];
  onSelect: (artworkId: string, originRect: ArtworkFocusRect) => void;
}) {
  return (
    <div className={styles.resultsStage}>
      {artworkIds.map((artworkId, index) => {
        const artwork = getArtwork(artworkId);
        return (
          <button
            type="button"
            className={styles.resultFrame}
            key={artwork.id}
            onClick={(event) =>
              onSelect(
                artwork.id,
                getArtworkFocusOrigin(
                  event.currentTarget,
                  artwork.width,
                  artwork.height
                )
              )
            }
          >
            <Image
              src={artwork.src}
              alt={artwork.alt}
              width={artwork.width}
              height={artwork.height}
              unoptimized
            />
            <span className={styles.resultLabel}>
              <span>结果 {index + 1}</span>
              <span>{artwork.width > artwork.height ? "横版" : "竖版"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 渲染空态与结果态共用的右侧时间轮。
 *
 * @param props.batches 最近五个生成批次，新批次位于首位。
 * @param props.activeBatchId 当前在中央画布展示的批次。
 * @param props.onBatchChange 选择弧线作品时切换批次。
 * @returns 默认虚隐、悬停或聚焦后完整浮现的五批历史记录。
 */
function HistoryWheel({
  batches,
  activeBatchId,
  onBatchChange,
}: {
  batches: HistoryBatch[];
  activeBatchId: string;
  onBatchChange: (batchId: string) => void;
}) {
  return (
    <aside className={styles.historyWheel} aria-label="最近生成时间轮">
      <div className={styles.historyWheelHeader}>
        <span>Recent generations</span>
        <h2>最近生成</h2>
      </div>
      <svg
        className={styles.historyArc}
        viewBox="0 0 348 610"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M 120 124 Q 78 170, 78 215 Q 62 260, 62 305 Q 62 350, 78 395 Q 78 440, 120 486" />
        <circle cx="62" cy="305" r="4" />
      </svg>
      {batches.map((batch, index) => {
        const artwork = getArtwork(batch.imageIds[0] ?? "art-04");
        const point = historyWheelPoints[index] ?? historyWheelPoints[0];
        const wheelStyle = {
          "--wheel-x": `${point.x - 36}px`,
          "--wheel-y": point.y,
        } as CSSProperties;
        return (
          <button
            type="button"
            className={styles.historyWheelItem}
            data-active={batch.id === activeBatchId}
            key={batch.id}
            style={wheelStyle}
            onClick={() => onBatchChange(batch.id)}
          >
            <span className={styles.historyWheelThumb}>
              <Image
                src={artwork.src}
                alt=""
                width={72}
                height={72}
                unoptimized
              />
              <span>{batch.imageIds.length}</span>
            </span>
            <span className={styles.historyWheelMeta}>
              <strong>{batch.prompt}</strong>
              <span>
                {batch.time} · {batch.imageIds.length} 张
              </span>
            </span>
          </button>
        );
      })}
    </aside>
  );
}

/**
 * 渲染局部重绘聚焦图片和中性蒙版示意。
 */
function InpaintStage({ artworkId }: { artworkId: string }) {
  const artwork = getArtwork(artworkId);
  return (
    <div className={styles.inpaintStage}>
      <Image
        src={artwork.src}
        alt={artwork.alt}
        width={artwork.width}
        height={artwork.height}
        unoptimized
      />
      <div className={styles.maskOverlay} />
      <div className={styles.maskHint}>蒙版草稿已保留</div>
    </div>
  );
}

/**
 * 渲染局部重绘底部控制器。
 */
function InpaintControls({
  onClose,
  onGenerate,
}: {
  onClose: () => void;
  onGenerate: () => void;
}) {
  return (
    <div className={styles.inpaintControls}>
      <button type="button" className={styles.controlButton}>
        <Brush size={13} aria-hidden="true" />
        画笔 48
      </button>
      <input
        aria-label="局部重绘提示词"
        defaultValue="重绘选中区域，保持原有光线与材质"
      />
      <button type="button" className={styles.controlButton} onClick={onClose}>
        退出
      </button>
      <button
        type="button"
        className={styles.generateButton}
        onClick={onGenerate}
      >
        <Sparkles size={13} aria-hidden="true" />
        重绘 · 3 积分
      </button>
    </div>
  );
}
