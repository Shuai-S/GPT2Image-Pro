"use client";

// 无限画布原型的创作节点与统一图片节点视图。

import {
  AtSign,
  Check,
  ChevronRight,
  CircleAlert,
  Crop,
  Download,
  Expand,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import Image from "next/image";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "./canvas-preview.module.css";
import type {
  CreatorNode,
  CreatorPanel,
  ImageNode,
} from "./canvas-preview-types";
import { getArtwork, modelOptions } from "./mock-data";
import {
  getPreviewImageSize,
  isPreviewCustomResolutionValid,
  normalizePreviewCustomResolution,
  previewImageRatioPresets,
  previewImageSizeTiers,
} from "./ratio-presets";

type CreatorNodeViewProps = {
  node: CreatorNode;
  selected: boolean;
  connecting: boolean;
  inputImages: ImageNode[];
  mentionSuggestions: ImageNode[];
  activePanel: CreatorPanel;
  issues: string[];
  onPatch: (patch: Partial<CreatorNode>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onConnectionFinish: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPanelChange: (panel: CreatorPanel) => void;
  onMentionImage: (imageId: string) => void;
  onLocateImage: (imageId: string) => void;
  onExpandPrompt: () => void;
  onRun: (count: number) => void;
};

type ImageNodeViewProps = {
  node: ImageNode;
  selected: boolean;
  connecting: boolean;
  onPatch: (patch: Partial<ImageNode>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onConnectionStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onFocus: (element: HTMLElement) => void;
  onContinue: () => void;
  onEdit: () => void;
  onRestore: () => void;
  onRetry: () => void;
};

/**
 * 渲染融合提示词、参数与运行状态的创作节点。
 *
 * @param props 节点数据、输入图片、当前面板和画布回调。
 * @returns 固定尺寸的可编辑创作节点。
 * @sideEffects 输入、运行和连接操作通过父级回调更新原型状态。
 */
export function CreatorNodeView({
  node,
  selected,
  connecting,
  inputImages,
  mentionSuggestions,
  activePanel,
  issues,
  onPatch,
  onPointerDown,
  onConnectionFinish,
  onPanelChange,
  onMentionImage,
  onLocateImage,
  onExpandPrompt,
  onRun,
}: CreatorNodeViewProps) {
  const [mentionOpen, setMentionOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const runMenuCloseTimerRef = useRef<number | null>(null);
  const hasMask = inputImages.some((image) => image.hasMask);
  const mode = hasMask
    ? "局部重绘"
    : inputImages.length > 0
      ? "图生图"
      : "文生图";
  const running = Boolean(node.runningBatchId);
  const valid = node.prompt.trim().length > 0 && issues.length === 0;
  const connectedIds = new Set(inputImages.map((image) => image.id));
  const invalidReferences = node.references.filter(
    (referenceId) => !connectedIds.has(referenceId)
  );

  useEffect(
    () => () => {
      if (runMenuCloseTimerRef.current !== null) {
        window.clearTimeout(runMenuCloseTimerRef.current);
      }
    },
    []
  );

  /**
   * 更新提示词，并在用户输入末尾 @ 时打开图片选择器。
   */
  const updatePrompt = (value: string) => {
    onPatch({ prompt: value });
    setMentionOpen(value.endsWith("@"));
  };

  /**
   * 选择图片引用并把可读别名追加到提示词草稿。
   */
  const selectMention = (imageNode: ImageNode) => {
    const promptWithoutTrigger = node.prompt.endsWith("@")
      ? node.prompt.slice(0, -1)
      : node.prompt;
    onPatch({ prompt: `${promptWithoutTrigger}@${imageNode.title} ` });
    onMentionImage(imageNode.id);
    setMentionOpen(false);
  };

  /** 打开数量菜单，并取消尚未执行的延迟关闭。 */
  const openRunMenu = () => {
    if (runMenuCloseTimerRef.current !== null) {
      window.clearTimeout(runMenuCloseTimerRef.current);
      runMenuCloseTimerRef.current = null;
    }
    setRunMenuOpen(true);
  };

  /** 给指针跨越按钮与菜单边缘保留短暂的可点击时间。 */
  const scheduleRunMenuClose = () => {
    runMenuCloseTimerRef.current = window.setTimeout(() => {
      setRunMenuOpen(false);
      runMenuCloseTimerRef.current = null;
    }, 180);
  };

  return (
    <article
      className={styles.creatorNode}
      data-canvas-node="true"
      data-selected={selected}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
      }}
      onPointerDown={(event) => {
        if (event.shiftKey) onPointerDown(event);
      }}
    >
      {(selected || connecting) && (
        <button
          type="button"
          className={styles.nodePort}
          data-side="input"
          aria-label={`${node.title}输入端口`}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={onConnectionFinish}
        />
      )}
      <span className={styles.nodePortAnchor} data-side="output" />

      <header className={styles.creatorHeader} onPointerDown={onPointerDown}>
        <div className={styles.creatorIdentity}>
          <WandSparkles size={13} aria-hidden="true" />
          <input
            value={node.title}
            aria-label="创作节点标题"
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => onPatch({ title: event.target.value })}
          />
          <span>{mode}</span>
        </div>
        <div className={styles.creatorCommands}>
          {issues.length > 0 && (
            <div className={styles.issueGroup}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="查看节点问题"
                title="查看节点问题"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <CircleAlert size={13} aria-hidden="true" />
              </button>
              <div className={styles.issuePanel}>
                {issues.map((issue) => (
                  <span key={issue}>{issue}</span>
                ))}
              </div>
            </div>
          )}
          <div
            className={styles.runGroup}
            onPointerEnter={openRunMenu}
            onPointerLeave={scheduleRunMenuClose}
            onFocusCapture={openRunMenu}
            onBlurCapture={scheduleRunMenuClose}
          >
            <button
              type="button"
              className={styles.runButton}
              aria-label={running ? "正在生成" : "运行创作节点"}
              aria-disabled={!valid || running}
              title={
                running ? `已完成 ${node.completedCount}/${node.count}` : "生成"
              }
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                if (valid && !running) onRun(node.count);
              }}
            >
              {running ? (
                <Loader2 size={13} aria-hidden="true" />
              ) : (
                <Sparkles size={13} aria-hidden="true" />
              )}
            </button>
            {!running && (
              <div className={styles.runMenu} data-open={runMenuOpen}>
                {[1, 2, 3, 4].map((count) => (
                  <button
                    type="button"
                    key={count}
                    disabled={!valid}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => {
                      setRunMenuOpen(false);
                      onRun(count);
                    }}
                  >
                    <span>{count} 张</span>
                    <span>{count * 3} 积分</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className={styles.creatorBody}>
        <div className={styles.inputStrip}>
          {inputImages.slice(0, 3).map((imageNode) => {
            const artwork = getArtwork(imageNode.artworkId);
            return (
              <button
                type="button"
                key={imageNode.id}
                className={styles.inputThumb}
                title={imageNode.title}
                onClick={() => onLocateImage(imageNode.id)}
              >
                <Image
                  src={artwork.src}
                  alt=""
                  width={28}
                  height={28}
                  unoptimized
                />
                {imageNode.hasMask && <span>M</span>}
              </button>
            );
          })}
          {inputImages.length > 3 && (
            <span className={styles.inputOverflow}>
              +{inputImages.length - 3}
            </span>
          )}
          {inputImages.length === 0 && (
            <span className={styles.inputEmpty}>无参考图片</span>
          )}
          <button
            type="button"
            className={styles.mentionButton}
            aria-label="引用画布图片"
            title="引用图片"
            onClick={() => setMentionOpen((current) => !current)}
          >
            <AtSign size={12} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.promptFrame}>
          <textarea
            value={node.prompt}
            aria-label="创作提示词"
            placeholder="描述你想创作的画面"
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => updatePrompt(event.target.value)}
          />
          <button
            type="button"
            className={styles.expandPromptButton}
            aria-label="展开提示词编辑器"
            title="展开提示词"
            onClick={onExpandPrompt}
          >
            <Expand size={12} aria-hidden="true" />
          </button>
          {invalidReferences.length > 0 && (
            <span className={styles.invalidReference}>
              {invalidReferences.length} 张引用图片未连接
            </span>
          )}
        </div>

        {mentionOpen && (
          <div className={styles.mentionPanel}>
            <div className={styles.panelCaption}>选择图片引用</div>
            {mentionSuggestions.length > 0 ? (
              mentionSuggestions.slice(0, 6).map((imageNode) => {
                const artwork = getArtwork(imageNode.artworkId);
                return (
                  <button
                    type="button"
                    key={imageNode.id}
                    onClick={() => selectMention(imageNode)}
                  >
                    <Image
                      src={artwork.src}
                      alt=""
                      width={28}
                      height={28}
                      unoptimized
                    />
                    <span>
                      <strong>{imageNode.title}</strong>
                      <small>
                        {connectedIds.has(imageNode.id) ? "已连接" : "画布图片"}
                      </small>
                    </span>
                    <ChevronRight size={12} aria-hidden="true" />
                  </button>
                );
              })
            ) : (
              <span className={styles.panelEmpty}>暂无可引用图片</span>
            )}
          </div>
        )}
      </div>

      <footer className={styles.creatorFooter}>
        <CreatorControl
          active={activePanel === "model"}
          label={node.modelName}
          onClick={() =>
            onPanelChange(activePanel === "model" ? null : "model")
          }
        />
        <CreatorControl
          active={activePanel === "ratio"}
          label={node.resolution}
          onClick={() =>
            onPanelChange(activePanel === "ratio" ? null : "ratio")
          }
        />
        <CreatorControl
          active={false}
          label={`${node.count} 张`}
          onClick={() =>
            onPatch({ count: node.count === 4 ? 1 : node.count + 1 })
          }
        />
        <button
          type="button"
          className={styles.advancedButton}
          data-active={activePanel === "advanced"}
          aria-label="高级参数"
          title="高级参数"
          onClick={() =>
            onPanelChange(activePanel === "advanced" ? null : "advanced")
          }
        >
          <SlidersHorizontal size={12} aria-hidden="true" />
        </button>
        {activePanel && (
          <CreatorParameterPanel
            panel={activePanel}
            node={node}
            onPatch={onPatch}
          />
        )}
      </footer>
    </article>
  );
}

/**
 * 渲染统一图片节点、生成状态和选中操作栏。
 *
 * @param props 图片节点、选区状态与画布命令。
 * @returns 保留完整图片和可编辑标题的图片节点。
 * @sideEffects 点击命令由父级打开聚焦、编辑或建立分支。
 */
export function ImageNodeView({
  node,
  selected,
  connecting,
  onPatch,
  onPointerDown,
  onConnectionStart,
  onFocus,
  onContinue,
  onEdit,
  onRestore,
  onRetry,
}: ImageNodeViewProps) {
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [maskPreview, setMaskPreview] = useState(false);
  const artwork = getArtwork(node.artworkId);
  const ready = node.status === "ready";

  return (
    <article
      className={styles.imageNode}
      data-canvas-node="true"
      data-selected={selected}
      data-status={node.status}
      data-mask-preview={maskPreview}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
      }}
      onPointerDown={onPointerDown}
    >
      <span className={styles.nodePortAnchor} data-side="input" />
      {ready && (selected || connecting) && (
        <button
          type="button"
          className={styles.nodePort}
          data-side="output"
          aria-label={`${node.title}输出端口`}
          onPointerDown={onConnectionStart}
        />
      )}

      <header className={styles.imageHeader}>
        <ImageIcon size={12} aria-hidden="true" />
        <input
          value={node.title}
          aria-label="图片节点标题"
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => onPatch({ title: event.target.value })}
        />
        {node.status === "uploading" && <span>上传中</span>}
        {node.status === "generating" && <span>生成中</span>}
        {node.status === "queued" && <span>等待中</span>}
        {node.status === "failed" && <span>失败</span>}
        {node.edited && (
          <div className={styles.editedGroup}>
            <button
              type="button"
              className={styles.editedBadge}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseEnter={() => setMaskPreview(node.hasMask)}
              onMouseLeave={() => setMaskPreview(false)}
              onClick={() => setEditMenuOpen((current) => !current)}
            >
              已编辑
            </button>
            {editMenuOpen && (
              <div
                className={styles.editedMenu}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    setEditMenuOpen(false);
                    onEdit();
                  }}
                >
                  <Crop size={12} aria-hidden="true" />
                  继续编辑
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditMenuOpen(false);
                    onRestore();
                  }}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  还原原图
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      <button
        type="button"
        className={styles.imageContent}
        data-image-content="true"
        aria-label={ready ? `查看${node.title}` : node.title}
        onPointerDown={(event) => {
          if (event.detail > 1) event.stopPropagation();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (ready) onFocus(event.currentTarget);
        }}
      >
        {ready ? (
          <Image
            src={artwork.src}
            alt={artwork.alt}
            width={artwork.width}
            height={artwork.height}
            unoptimized
          />
        ) : node.status === "failed" ? (
          <span className={styles.failedState}>
            <CircleAlert size={18} aria-hidden="true" />
            <strong>生成失败</strong>
            <small>{node.error ?? "服务暂时不可用"}</small>
          </span>
        ) : (
          <span className={styles.loadingState}>
            <Loader2 size={18} aria-hidden="true" />
            <small>
              {node.status === "uploading" ? "正在上传素材" : "正在生成作品"}
            </small>
          </span>
        )}
        {node.hasMask && <span className={styles.nodeMaskPreview} />}
      </button>

      {selected && (
        <div className={styles.imageActions}>
          {ready ? (
            <>
              <button
                type="button"
                title="聚焦查看"
                aria-label="聚焦查看"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  const imageContent = event.currentTarget
                    .closest("article")
                    ?.querySelector<HTMLElement>("[data-image-content='true']");
                  onFocus(imageContent ?? event.currentTarget);
                }}
              >
                <Maximize2 size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.continueButton}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={onContinue}
              >
                <WandSparkles size={13} aria-hidden="true" />
                继续创作
              </button>
              <button
                type="button"
                title="图片编辑"
                aria-label="图片编辑"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={onEdit}
              >
                <Crop size={13} aria-hidden="true" />
              </button>
              <a
                href={artwork.src}
                download={`${node.title}.jpg`}
                title="下载"
                aria-label="下载"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Download size={13} aria-hidden="true" />
              </a>
            </>
          ) : node.status === "failed" ? (
            <button
              type="button"
              className={styles.continueButton}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onRetry}
            >
              <RotateCcw size={13} aria-hidden="true" />
              重试
            </button>
          ) : (
            <span className={styles.actionStatus}>处理中</span>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * 渲染创作节点底部的单个参数控制。
 */
function CreatorControl({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.creatorControl}
      data-active={active}
      title={label}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/**
 * 渲染模型、分辨率或高级参数的单一悬浮面板。
 */
function CreatorParameterPanel({
  panel,
  node,
  onPatch,
}: {
  panel: Exclude<CreatorPanel, null>;
  node: CreatorNode;
  onPatch: (patch: Partial<CreatorNode>) => void;
}) {
  const [customWidthDraft, setCustomWidthDraft] = useState(
    String(node.customResolution.width)
  );
  const [customHeightDraft, setCustomHeightDraft] = useState(
    String(node.customResolution.height)
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

  if (panel === "model") {
    return (
      <div className={styles.parameterPanel} data-panel="model">
        <div className={styles.panelCaption}>选择模型</div>
        {modelOptions.map((model) => (
          <button
            type="button"
            key={model.id}
            data-active={node.modelId === model.id}
            onClick={() =>
              onPatch({ modelId: model.id, modelName: model.name })
            }
          >
            <span>
              <strong>{model.name}</strong>
              <small>{model.detail} · 最多 4 张参考图</small>
            </span>
            <span>{model.cost} 积分</span>
            {node.modelId === model.id && (
              <Check size={12} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
    );
  }

  if (panel === "ratio") {
    return (
      <div className={styles.parameterPanel} data-panel="ratio">
        <div className={styles.ratioPanelHeader}>
          <div className={styles.panelCaption}>画面比例</div>
          <span>{node.resolution}</span>
        </div>
        <fieldset className={styles.ratioTierGroup} aria-label="分辨率档位">
          {previewImageSizeTiers.map((tier) => (
            <button
              type="button"
              key={tier.value}
              data-active={node.sizeTier === tier.value}
              onClick={() => {
                const preset = previewImageRatioPresets.find(
                  (item) => item.value === node.ratio
                );
                const resolution = preset
                  ? getPreviewImageSize(preset.value, tier.value)
                  : null;
                onPatch({
                  sizeTier: tier.value,
                  ...(resolution
                    ? { resolution: `${resolution[0]} × ${resolution[1]}` }
                    : {}),
                });
              }}
            >
              {tier.label}
            </button>
          ))}
        </fieldset>
        <div className={styles.ratioGrid}>
          {previewImageRatioPresets.map((preset) => (
            <button
              type="button"
              key={preset.value}
              data-active={node.ratio === preset.value}
              onClick={() => {
                const resolution = getPreviewImageSize(
                  preset.value,
                  node.sizeTier
                );
                onPatch({
                  ratio: preset.value,
                  resolution: `${resolution[0]} × ${resolution[1]}`,
                });
              }}
            >
              <span
                style={{
                  aspectRatio: `${preset.width}/${preset.height}`,
                }}
              />
              <strong>{preset.value}</strong>
              <small>{preset.label}</small>
            </button>
          ))}
          <button
            type="button"
            data-active={node.ratio === "auto"}
            onClick={() => onPatch({ ratio: "auto", resolution: "自动" })}
          >
            <span className={styles.autoRatioShape}>A</span>
            <strong>自动</strong>
            <small>模型决定</small>
          </button>
        </div>
        <div
          className={styles.customResolutionEditor}
          data-active={node.ratio === "custom"}
        >
          <span>自定义</span>
          <input
            type="number"
            min={256}
            max={3840}
            step={16}
            aria-label="自定义分辨率宽度"
            value={customWidthDraft}
            onChange={(event) => setCustomWidthDraft(event.target.value)}
          />
          <span>×</span>
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
            disabled={!normalizedCustomResolution}
            title={
              normalizedCustomResolution
                ? "应用自定义分辨率"
                : "尺寸范围为 256–3840px，宽高比不超过 3:1"
            }
            onClick={() => {
              if (!normalizedCustomResolution) return;
              const [width, height] = normalizedCustomResolution;
              onPatch({
                ratio: "custom",
                resolution: `${width} × ${height}`,
                customResolution: { width, height },
              });
            }}
          >
            应用
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.parameterPanel} data-panel="advanced">
      <div className={styles.panelCaption}>高级参数</div>
      <label className={styles.parameterRow}>
        <span>
          <strong>创意强度</strong>
          <small>保持构图与探索变化之间的平衡</small>
        </span>
        <input type="range" min="0" max="100" defaultValue="62" />
      </label>
      <label className={styles.parameterRow}>
        <span>
          <strong>输出质量</strong>
          <small>高质量会使用更多积分</small>
        </span>
        <select defaultValue="standard">
          <option value="standard">标准</option>
          <option value="high">高</option>
        </select>
      </label>
    </div>
  );
}

/**
 * 返回引用候选的稳定排序，已连接图片优先，其余按节点距离排序。
 */
export function sortMentionSuggestions(
  creator: CreatorNode,
  images: ImageNode[],
  connectedIds: Set<string>
) {
  const referenced = new Set(creator.references);
  return images
    .filter((image) => image.status === "ready" && !referenced.has(image.id))
    .sort((left, right) => {
      const connectionOrder =
        Number(connectedIds.has(right.id)) - Number(connectedIds.has(left.id));
      if (connectionOrder !== 0) return connectionOrder;
      const leftDistance = Math.hypot(left.x - creator.x, left.y - creator.y);
      const rightDistance = Math.hypot(
        right.x - creator.x,
        right.y - creator.y
      );
      return leftDistance - rightDistance;
    });
}

/**
 * 返回创作节点当前不可运行原因。
 */
export function getCreatorIssues(
  creator: CreatorNode,
  inputImages: ImageNode[]
) {
  const issues: string[] = [];
  const connectedIds = new Set(inputImages.map((image) => image.id));
  const invalidReferences = creator.references.filter(
    (referenceId) => !connectedIds.has(referenceId)
  );
  if (!creator.prompt.trim()) issues.push("请输入创作提示词");
  if (invalidReferences.length > 0) {
    issues.push(`${invalidReferences.length} 张引用图片未连接`);
  }
  if (inputImages.length > 4) issues.push("当前模型最多支持 4 张参考图");
  if (inputImages.filter((image) => image.hasMask).length > 1) {
    issues.push("局部重绘只能使用一张蒙版图片");
  }
  if (inputImages.some((image) => image.status !== "ready")) {
    issues.push("请等待所有参考图片处理完成");
  }
  return issues;
}
