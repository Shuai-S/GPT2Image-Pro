"use client";

// 基础创作原型。模拟匿名草稿、统一生成输入器、结果聚焦、最近批次与局部重绘。

import {
  ArrowRight,
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
import { type CSSProperties, useMemo, useState } from "react";
import {
  ArtworkFocus,
  type ArtworkFocusRect,
  getArtworkFocusOrigin,
} from "./artwork-focus";
import {
  createSamples,
  getArtwork,
  historyBatches,
  modelOptions,
} from "./mock-data";
import styles from "./design-preview.module.css";

type ComposerPanel = "model" | "ratio" | "advanced" | null;

const historyWheelPoints = [
  { x: 120, y: "20.33%" },
  { x: 78, y: "35.25%" },
  { x: 62, y: "50%" },
  { x: 78, y: "64.75%" },
  { x: 120, y: "79.67%" },
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
  onShowResults,
  onOpenGallery,
}: {
  showResults: boolean;
  onShowResults: () => void;
  onOpenGallery: () => void;
}) {
  const [prompt, setPrompt] = useState(
    showResults ? "一座漂浮在雾海上方的古老观测站，电影感宽幅构图" : ""
  );
  const [activePanel, setActivePanel] = useState<ComposerPanel>(null);
  const [selectedModelId, setSelectedModelId] = useState("gpt-image-2");
  const [count, setCount] = useState(showResults ? 4 : 1);
  const [ratio, setRatio] = useState("16:9");
  const [focusedArtwork, setFocusedArtwork] = useState<{
    artworkId: string;
    originRect: ArtworkFocusRect;
  } | null>(null);
  const [activeBatchId, setActiveBatchId] = useState("batch-01");
  const [inpaintMode, setInpaintMode] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(showResults);

  const selectedModel =
    modelOptions.find((model) => model.id === selectedModelId) ??
    modelOptions[0];
  const activeBatch =
    historyBatches.find((batch) => batch.id === activeBatchId) ??
    historyBatches[0];
  const visibleArtworkIds = showResults
    ? (activeBatch?.imageIds.slice(0, count) ?? [])
    : [];
  const selectedArtwork = focusedArtwork
    ? getArtwork(focusedArtwork.artworkId)
    : getArtwork(visibleArtworkIds[0] ?? "art-04");

  /**
   * 模拟受保护生成：未登录时保留草稿并打开登录层，已登录时直接显示结果。
   */
  const requestGeneration = () => {
    if (!authenticated) {
      setAuthOpen(true);
      return;
    }
    onShowResults();
  };

  /**
   * 模拟登录成功并恢复原生成动作。
   */
  const completeMockLogin = () => {
    setAuthenticated(true);
    setAuthOpen(false);
    onShowResults();
  };

  return (
    <main className={styles.canvasSurface}>
      <section className={styles.workbench}>
        <header className={styles.workbenchHeader}>
          <div>
            <div className={styles.sectionEyebrow}>Create</div>
            <h1>{inpaintMode ? "局部重绘" : "创作"}</h1>
            <p>
              {inpaintMode
                ? "在当前图片上绘制蒙版，原图不会被覆盖。"
                : "没有参考图时进行文生图，添加参考图后自然进入图生图。"}
            </p>
          </div>
          {showResults && !inpaintMode && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                setFocusedArtwork(null);
                setPrompt("");
              }}
            >
              新建创作
            </button>
          )}
        </header>

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
                onGenerate={requestGeneration}
                docked={false}
              />
              {!prompt && (
                <div className={styles.sampleList}>
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
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {!inpaintMode && (
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
          onGenerate={requestGeneration}
          docked={showResults}
          hidden={!showResults}
          concealed={Boolean(focusedArtwork)}
        />
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
          activeBatchId={activeBatchId}
          onBatchChange={(batchId) => {
            setActiveBatchId(batchId);
            setFocusedArtwork(null);
            if (!showResults) onShowResults();
          }}
        />
      )}

      {authOpen && (
        <AuthOverlay
          prompt={prompt}
          modelName={selectedModel?.name ?? "GPT Image 2"}
          cost={(selectedModel?.cost ?? 3) * count}
          onCancel={() => setAuthOpen(false)}
          onContinue={completeMockLogin}
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
  onGenerate,
  docked,
  hidden = false,
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
  ratio: string;
  onRatioChange: (value: string) => void;
  onGenerate: () => void;
  docked: boolean;
  hidden?: boolean;
  concealed?: boolean;
}) {
  const selectedModel =
    modelOptions.find((model) => model.id === selectedModelId) ??
    modelOptions[0];
  const totalCost = (selectedModel?.cost ?? 3) * count;

  if (hidden) return null;

  return (
    <div
      className={styles.composer}
      data-docked={docked}
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
            {ratio}
          </button>
          {activePanel === "ratio" && (
            <RatioPanel
              ratio={ratio}
              count={count}
              onRatioChange={onRatioChange}
              onCountChange={onCountChange}
            />
          )}
        </div>
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
        <div className={styles.controlSpacer} />
        <span className={styles.costLabel}>预计 {totalCost} 积分</span>
        <button
          type="button"
          className={styles.generateButton}
          onClick={onGenerate}
          disabled={!prompt.trim()}
        >
          <Sparkles size={13} aria-hidden="true" />
          生成 {count} 张
        </button>
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
 * 渲染现有比例能力的原型面板和 1 至 4 张分段选择器。
 */
function RatioPanel({
  ratio,
  count,
  onRatioChange,
  onCountChange,
}: {
  ratio: string;
  count: number;
  onRatioChange: (value: string) => void;
  onCountChange: (value: number) => void;
}) {
  return (
    <div className={styles.floatingPanel}>
      <h3>画面比例</h3>
      <div className={styles.segmentGroup}>
        {["1:1", "4:3", "3:4", "16:9"].map((value) => (
          <button
            type="button"
            className={styles.segmentButton}
            data-active={value === ratio}
            key={value}
            onClick={() => onRatioChange(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className={styles.field} style={{ marginTop: 14 }}>
        <span className={styles.fieldLegend}>生成数量</span>
        <div className={styles.segmentGroup}>
          {[1, 2, 3, 4].map((value) => (
            <button
              type="button"
              className={styles.segmentButton}
              data-active={value === count}
              key={value}
              onClick={() => onCountChange(value)}
            >
              {value}
            </button>
          ))}
        </div>
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
 * @param props.activeBatchId 当前在中央画布展示的批次。
 * @param props.onBatchChange 选择弧线作品时切换批次。
 * @returns 默认虚隐、悬停或聚焦后完整浮现的五批历史记录。
 */
function HistoryWheel({
  activeBatchId,
  onBatchChange,
}: {
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
      {historyBatches.map((batch, index) => {
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

/**
 * 渲染保留当前草稿的模拟登录浮层。
 */
function AuthOverlay({
  prompt,
  modelName,
  cost,
  onCancel,
  onContinue,
}: {
  prompt: string;
  modelName: string;
  cost: number;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const promptSummary = useMemo(
    () => (prompt.length > 44 ? `${prompt.slice(0, 44)}...` : prompt),
    [prompt]
  );

  return (
    <div className={styles.authOverlay} role="dialog" aria-modal="true">
      <div className={styles.authDialog}>
        <div className={styles.sectionEyebrow}>Continue creation</div>
        <h2>登录后继续生成</h2>
        <p>提示词、模型、比例和参考图会完整保留，登录成功后继续当前操作。</p>
        <div className={styles.authSummary}>
          <span>{promptSummary}</span>
          <strong>{modelName}</strong>
          <span>预计消耗</span>
          <strong>{cost} 积分</strong>
        </div>
        <div className={styles.authActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onCancel}
          >
            暂不登录
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onContinue}
          >
            模拟登录并继续
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
