"use client";

// 无限画布原型的添加、图库、提示词与图片编辑浮层。

import {
  Check,
  Crop,
  FileDown,
  FileUp,
  FlipHorizontal2,
  FlipVertical2,
  Image as ImageIcon,
  Images,
  Paintbrush,
  Plus,
  RotateCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./canvas-preview.module.css";
import type { ImageNode } from "./canvas-preview-types";
import { artworks, getArtwork } from "./mock-data";

/**
 * 渲染底部添加按钮上方的创作动作菜单。
 */
export function CanvasAddPanel({
  onAddCreator,
  onMockUpload,
  onOpenGallery,
}: {
  onAddCreator: () => void;
  onMockUpload: () => void;
  onOpenGallery: () => void;
}) {
  const options = [
    {
      label: "新建创作",
      detail: "输入提示词并选择模型",
      icon: Sparkles,
      action: onAddCreator,
    },
    {
      label: "上传图片",
      detail: "加入私人素材",
      icon: Upload,
      action: onMockUpload,
    },
    {
      label: "从图库添加",
      detail: "浏览作品与素材",
      icon: Images,
      action: onOpenGallery,
    },
  ];
  return (
    <div className={styles.dockPanel}>
      <div className={styles.panelCaption}>添加到画布</div>
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button type="button" key={option.label} onClick={option.action}>
            <Icon size={14} aria-hidden="true" />
            <span>
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 渲染导入、导出与清空画布的更多菜单。
 */
export function CanvasMorePanel({ onClear }: { onClear: () => void }) {
  return (
    <div className={styles.dockPanel}>
      <div className={styles.panelCaption}>画布命令</div>
      <button type="button">
        <FileUp size={14} aria-hidden="true" />
        <span>
          <strong>导入画布</strong>
          <small>读取现有画布文件</small>
        </span>
      </button>
      <button type="button">
        <FileDown size={14} aria-hidden="true" />
        <span>
          <strong>导出画布</strong>
          <small>保存当前节点关系</small>
        </span>
      </button>
      <button type="button" onClick={onClear}>
        <Trash2 size={14} aria-hidden="true" />
        <span>
          <strong>清空画布</strong>
          <small>作品与素材仍会保留</small>
        </span>
      </button>
    </div>
  );
}

/**
 * 渲染覆盖画布右侧的作品与素材选择面板。
 */
export function CanvasGalleryPanel({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (artworkIds: string[], source: ImageNode["source"]) => void;
}) {
  const [tab, setTab] = useState<"works" | "materials">("works");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const visibleArtworks = useMemo(() => {
    const source = tab === "works" ? artworks.slice(0, 8) : artworks.slice(8);
    const normalized = query.trim().toLowerCase();
    if (!normalized) return source;
    return source.filter((artwork) =>
      `${artwork.title} ${artwork.category}`.toLowerCase().includes(normalized)
    );
  }, [query, tab]);

  /** 切换当前图片的多选状态。 */
  const toggleSelection = (artworkId: string) => {
    setSelected((current) =>
      current.includes(artworkId)
        ? current.filter((item) => item !== artworkId)
        : [...current, artworkId]
    );
  };

  return (
    <aside className={styles.galleryPanel} aria-label="画布图库">
      <header>
        <div>
          <span>Private library</span>
          <h2>选择画布图片</h2>
        </div>
        <button
          type="button"
          aria-label="关闭图库"
          title="关闭"
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.galleryTabs}>
        <button
          type="button"
          data-active={tab === "works"}
          onClick={() => {
            setTab("works");
            setSelected([]);
          }}
        >
          作品
        </button>
        <button
          type="button"
          data-active={tab === "materials"}
          onClick={() => {
            setTab("materials");
            setSelected([]);
          }}
        >
          素材
        </button>
      </div>
      <label className={styles.gallerySearch}>
        <Search size={13} aria-hidden="true" />
        <input
          value={query}
          placeholder="搜索名称或类型"
          aria-label="搜索画布图片"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className={styles.galleryGrid}>
        {visibleArtworks.map((artwork) => {
          const active = selected.includes(artwork.id);
          return (
            <button
              type="button"
              key={artwork.id}
              data-selected={active}
              onClick={() => toggleSelection(artwork.id)}
            >
              <span className={styles.galleryImage}>
                <Image
                  src={artwork.src}
                  alt={artwork.alt}
                  width={artwork.width}
                  height={artwork.height}
                  unoptimized
                />
                {active && (
                  <span>
                    <Check size={13} aria-hidden="true" />
                  </span>
                )}
              </span>
              <strong>{artwork.title}</strong>
              <small>{artwork.category}</small>
            </button>
          );
        })}
      </div>
      <footer>
        <span>
          {selected.length > 0
            ? `已选择 ${selected.length} 张`
            : "选择图片加入画布"}
        </span>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => {
            onAdd(selected, tab === "works" ? "gallery" : "uploaded");
            setSelected([]);
          }}
        >
          <Plus size={13} aria-hidden="true" />
          加入画布
        </button>
      </footer>
    </aside>
  );
}

/**
 * 渲染不改变节点尺寸的大型提示词编辑器。
 */
export function ExpandedPromptPanel({
  title,
  prompt,
  onChange,
  onClose,
}: {
  title: string;
  prompt: string;
  onChange: (prompt: string) => void;
  onClose: () => void;
}) {
  return (
    <section className={styles.promptOverlay} role="dialog" aria-modal="true">
      <button
        type="button"
        className={styles.overlayBackdrop}
        aria-label="关闭提示词编辑器"
        onClick={onClose}
      />
      <div className={styles.promptDialog}>
        <header>
          <div>
            <span>Prompt editor</span>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        <textarea
          value={prompt}
          aria-label="完整创作提示词"
          placeholder="描述你想创作的画面，可使用 @ 引用画布图片"
          onChange={(event) => onChange(event.target.value)}
        />
        <footer>
          <span>支持 @ 引用已连接或附近图片</span>
          <button type="button" onClick={onClose}>
            完成
          </button>
        </footer>
      </div>
    </section>
  );
}

type EditorTool = "crop" | "rotate" | "flip-x" | "flip-y" | "mask" | "erase";

/**
 * 渲染从聚焦状态进入的中央图片编辑器。
 */
export function CanvasImageEditor({
  imageNode,
  onCancel,
  onComplete,
}: {
  imageNode: ImageNode;
  onCancel: () => void;
  onComplete: (result: { hasMask: boolean; maskDataUrl?: string }) => void;
}) {
  const [tool, setTool] = useState<EditorTool>(
    imageNode.hasMask ? "mask" : "crop"
  );
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [hasMask, setHasMask] = useState(imageNode.hasMask);
  const [brushSize, setBrushSize] = useState(42);
  const [dirty, setDirty] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const artwork = getArtwork(imageNode.artworkId);

  useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !imageNode.maskDataUrl) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const maskImage = new window.Image();
    maskImage.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
    };
    maskImage.src = imageNode.maskDataUrl;
  }, [imageNode.maskDataUrl]);

  /** 选择编辑工具并应用离散变换命令。 */
  const chooseTool = (nextTool: EditorTool) => {
    setTool(nextTool);
    if (nextTool === "rotate") setRotation((current) => current + 90);
    if (nextTool === "flip-x") setFlipX((current) => !current);
    if (nextTool === "flip-y") setFlipY((current) => !current);
    if (nextTool === "mask") setHasMask(true);
    setDirty(true);
  };

  /** 在没有未保存修改时直接退出，否则显示放弃确认。 */
  const requestCancel = () => {
    if (dirty) {
      setConfirmAbandon(true);
      return;
    }
    onCancel();
  };

  /** 把屏幕指针位置换算为蒙版位图坐标。 */
  const getMaskPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
      scale: canvas.width / bounds.width,
    };
  };

  /** 按当前画笔模式绘制一段连续蒙版轨迹。 */
  const drawMaskStroke = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    startStroke: boolean
  ) => {
    if (tool !== "mask" && tool !== "erase") return;
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;
    const point = getMaskPoint(event);
    const previous = startStroke ? point : (lastPointRef.current ?? point);
    context.save();
    context.globalCompositeOperation =
      tool === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = "rgba(255, 255, 255, 0.72)";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = brushSize * point.scale;
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    context.restore();
    lastPointRef.current = point;
    if (tool === "mask") setHasMask(true);
    setDirty(true);
  };

  /** 结束当前笔刷轨迹并释放指针捕获。 */
  const finishMaskStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const tools: Array<{ id: EditorTool; label: string; icon: typeof Crop }> = [
    { id: "crop", label: "裁切", icon: Crop },
    { id: "rotate", label: "旋转 90°", icon: RotateCw },
    { id: "flip-x", label: "水平翻转", icon: FlipHorizontal2 },
    { id: "flip-y", label: "垂直翻转", icon: FlipVertical2 },
    { id: "mask", label: "蒙版画笔", icon: Paintbrush },
    { id: "erase", label: "蒙版橡皮擦", icon: Trash2 },
  ];

  return (
    <section className={styles.imageEditor} role="dialog" aria-modal="true">
      <div className={styles.editorTopbar}>
        <span>{imageNode.title}</span>
        <div>
          <button type="button" onClick={requestCancel}>
            取消
          </button>
          <button
            type="button"
            data-primary="true"
            onClick={() => {
              const maskDataUrl = hasMask
                ? maskCanvasRef.current?.toDataURL("image/png")
                : undefined;
              onComplete({ hasMask, maskDataUrl });
            }}
          >
            完成
          </button>
        </div>
      </div>
      <div className={styles.editorStage}>
        <div
          className={styles.editorImageFrame}
          data-mask={hasMask && (tool === "mask" || tool === "erase")}
        >
          <Image
            src={artwork.src}
            alt={artwork.alt}
            width={artwork.width}
            height={artwork.height}
            style={{
              transform: `rotate(${rotation}deg) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`,
            }}
            unoptimized
          />
          <canvas
            ref={maskCanvasRef}
            className={styles.editorMaskCanvas}
            data-active={tool === "mask" || tool === "erase"}
            width={artwork.width}
            height={artwork.height}
            aria-label="蒙版绘制区域"
            onPointerDown={(event) => {
              if (tool !== "mask" && tool !== "erase") return;
              drawingRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              drawMaskStroke(event, true);
            }}
            onPointerMove={(event) => {
              if (drawingRef.current) drawMaskStroke(event, false);
            }}
            onPointerUp={finishMaskStroke}
            onPointerCancel={finishMaskStroke}
          />
          {tool === "crop" && <span className={styles.cropFrame} />}
        </div>
      </div>
      <div className={styles.editorDock}>
        {tools.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              data-active={tool === item.id}
              aria-label={item.label}
              title={item.label}
              onClick={() => chooseTool(item.id)}
            >
              <Icon size={15} aria-hidden="true" />
            </button>
          );
        })}
        {(tool === "mask" || tool === "erase") && (
          <div className={styles.brushPanel}>
            <label>
              <span>笔刷大小</span>
              <input
                type="range"
                min="12"
                max="96"
                value={brushSize}
                onChange={(event) => {
                  setBrushSize(Number(event.target.value));
                  setDirty(true);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const canvas = maskCanvasRef.current;
                canvas
                  ?.getContext("2d")
                  ?.clearRect(0, 0, canvas.width, canvas.height);
                setHasMask(false);
                setDirty(true);
              }}
            >
              清空蒙版
            </button>
          </div>
        )}
      </div>
      {confirmAbandon && (
        <div className={styles.abandonDialog}>
          <ImageIcon size={18} aria-hidden="true" />
          <strong>放弃本次修改？</strong>
          <span>图片节点会保持进入编辑前的状态。</span>
          <div>
            <button type="button" onClick={() => setConfirmAbandon(false)}>
              继续编辑
            </button>
            <button type="button" data-primary="true" onClick={onCancel}>
              放弃修改
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * 渲染清空唯一画布前的确认层。
 */
export function ClearCanvasDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className={styles.clearOverlay} role="dialog" aria-modal="true">
      <button
        type="button"
        className={styles.overlayBackdrop}
        aria-label="取消清空"
        onClick={onCancel}
      />
      <div className={styles.clearDialog}>
        <Trash2 size={19} aria-hidden="true" />
        <h2>清空无限画布？</h2>
        <p>所有节点和连接会被移出画布，私人作品和素材仍会保留。</p>
        <div>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" data-primary="true" onClick={onConfirm}>
            清空画布
          </button>
        </div>
      </div>
    </section>
  );
}
