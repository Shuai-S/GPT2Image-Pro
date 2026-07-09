import type { AspectRatioSizeDialogValue } from "@/features/image-generation/components/aspect-ratio-size-dialog";
import { InlineImageSizeControl } from "@/features/image-generation/components/aspect-ratio-size-dialog";
import {
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeKind,
  type CanvasViewport,
  getCanvasNodeBounds,
} from "@/features/infinite-canvas/canvas-state";
import { CachedImage as Image } from "@/features/shared/components/cached-image";
import {
  Download,
  Image as ImageIcon,
  Loader2,
  PanelRightOpen,
  Repeat2,
  Sparkles,
  TextCursorInput,
  Wand2,
  X,
} from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  type ConnectorSide,
  type ImagePreviewState,
  MIN_CANVAS_LOOP_COUNT,
  MAX_CANVAS_LOOP_COUNT,
  getCanvasNodeSizeFromValue,
  getCanvasNodeSizeValue,
  normalizeCanvasLoopCount,
} from "@/features/infinite-canvas/components/canvas-helpers";
import { cn } from "@repo/ui/utils";

/**
 * 画布子组件集合。
 *
 * 使用方：infinite-canvas-client.tsx。
 * 关键约束：子组件不直接访问主组件闭包，所有依赖通过 props 注入。
 */

type ToolbarButtonProps = {
  active?: boolean;
  label: string;
  children: React.ReactNode;
  onClick: () => void;
};

type CanvasNodeViewProps = {
  node: CanvasNode;
  selected: boolean;
  connectMode: boolean;
  connectSource: boolean;
  onPointerDown: (
    nodeId: string,
    event: ReactPointerEvent<HTMLDivElement>
  ) => void;
  onConnectorPointerDown: (
    nodeId: string,
    side: ConnectorSide,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void;
  onPatch: (patch: Partial<Omit<CanvasNode, "id" | "kind">>) => void;
  onPreviewImage: (preview: ImagePreviewState) => void;
  onRun: (nodeId?: string) => Promise<void>;
  copy: (en: string, zh: string) => string;
};

/**
 * 渲染画布图片的大图预览层。
 *
 * @param props 预览图片、文案函数、关闭与下载回调。
 * @returns 带下载入口的图片预览弹层。
 * @sideEffects 点击遮罩关闭，点击下载触发父组件下载逻辑。
 */
export function ImagePreviewDialog({
  preview,
  copy,
  onClose,
  onDownload,
}: {
  preview: ImagePreviewState;
  copy: (en: string, zh: string) => string;
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label={preview.title}
    >
      <button
        type="button"
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        aria-label={copy("Close preview", "关闭预览")}
        onClick={onClose}
      />
      <div className="relative flex h-full max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-md border border-border bg-background shadow-xl">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <div className="min-w-0 text-sm font-medium">
            <span className="block truncate">{preview.title}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onDownload}
            >
              <Download className="h-4 w-4" />
              {copy("Download", "下载")}
            </button>
            <button
              type="button"
              title={copy("Close", "关闭")}
              aria-label={copy("Close", "关闭")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 bg-black/80">
          <Image
            src={preview.imageUrl}
            alt={preview.title}
            fill
            sizes="90vw"
            className="object-contain"
            unoptimized
          />
        </div>
      </div>
    </div>
  );
}

/**
 * 渲染工具栏图标按钮。
 *
 * @param props 按钮状态、标签和点击回调。
 * @returns 工具栏按钮。
 * @sideEffects 点击时执行父组件回调。
 */
export function ToolbarButton({
  active,
  label,
  children,
  onClick,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 min-w-9 items-center justify-center gap-2 rounded-md border border-border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        active &&
          "border-foreground bg-foreground text-background hover:bg-foreground hover:text-background"
      )}
    >
      {children}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

/**
 * 渲染单个画布节点。
 *
 * @param props 节点数据、选区状态与回调。
 * @returns 节点 DOM。
 * @sideEffects 输入时更新父组件画布状态。
 */
export function CanvasNodeView({
  node,
  selected,
  connectMode,
  connectSource,
  onPointerDown,
  onConnectorPointerDown,
  onPatch,
  onPreviewImage,
  onRun,
  copy,
}: CanvasNodeViewProps) {
  const tone = {
    prompt: "border-amber-300/70",
    image: "border-emerald-300/70",
    generator: "border-violet-300/70",
    loop: "border-sky-300/70",
    output: "border-rose-300/70",
  }[node.kind];
  const runnable =
    node.kind === "prompt" || node.kind === "generator" || node.kind === "loop";

  return (
    <div
      className={cn(
        "group absolute flex flex-col overflow-visible rounded-md border bg-background shadow-sm",
        tone,
        selected && "outline outline-2 outline-foreground",
        connectSource && "ring-2 ring-emerald-500"
      )}
      style={{
        transform: `translate(${node.x}px, ${node.y}px)`,
        width: node.width,
        minHeight: node.height,
      }}
      onPointerDown={(event) => onPointerDown(node.id, event)}
    >
      <CanvasConnectorHandle
        side="input"
        visible={connectMode || selected || connectSource}
        label={copy("Input connector", "输入连接点")}
        onPointerDown={(event) =>
          onConnectorPointerDown(node.id, "input", event)
        }
      />
      <CanvasConnectorHandle
        side="output"
        visible={connectMode || selected || connectSource}
        label={copy("Output connector", "输出连接点")}
        onPointerDown={(event) =>
          onConnectorPointerDown(node.id, "output", event)
        }
      />
      {connectMode && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-10 cursor-crosshair"
        />
      )}
      <div className="flex h-10 shrink-0 cursor-move items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <NodeIcon kind={node.kind} />
          <input
            value={node.title}
            aria-label={copy("Node title", "节点标题")}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => onPatch({ title: event.target.value })}
          />
        </div>
        {runnable && (
          <button
            type="button"
            title={copy("Run", "运行")}
            aria-label={copy("Run", "运行")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void onRun(node.id)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {node.status === "running" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
      <div
        className="flex flex-1 flex-col gap-2 p-3"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {runnable && (
          <textarea
            value={node.prompt || ""}
            aria-label={copy("Prompt", "提示词")}
            placeholder={copy("Prompt", "提示词")}
            className="min-h-24 flex-1 resize-none rounded-md border border-border bg-muted/40 p-2 text-sm outline-none focus:border-foreground"
            onChange={(event) => onPatch({ prompt: event.target.value })}
          />
        )}
        {node.kind === "loop" && (
          <div className="space-y-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              <span>{copy("Count", "数量")}</span>
              <input
                type="number"
                min={MIN_CANVAS_LOOP_COUNT}
                max={MAX_CANVAS_LOOP_COUNT}
                step={1}
                value={node.loopCount || 4}
                aria-label={copy("Loop count", "循环数量")}
                className="h-9 rounded-md border border-border bg-muted/40 px-2 text-sm text-foreground outline-none focus:border-foreground"
                onChange={(event) =>
                  onPatch({
                    loopCount: normalizeCanvasLoopCount(event.target.value),
                  })
                }
              />
            </label>
            <textarea
              value={node.loopItems || ""}
              aria-label={copy("Loop items", "循环变量")}
              placeholder={copy("Loop items", "循环变量")}
              className="min-h-20 resize-none rounded-md border border-border bg-muted/40 p-2 text-sm outline-none focus:border-foreground"
              onChange={(event) => onPatch({ loopItems: event.target.value })}
            />
          </div>
        )}
        {(node.kind === "generator" || node.kind === "loop") && (
          <div className="space-y-2">
            <InlineImageSizeControl
              id={`canvas-node-size-${node.id}`}
              value={getCanvasNodeSizeValue(node.size)}
              copy={copy}
              onChange={(next) =>
                onPatch({ size: getCanvasNodeSizeFromValue(next) })
              }
            />
            <input
              value={node.model || ""}
              aria-label={copy("Model", "模型")}
              placeholder={copy("Auto model", "自动模型")}
              className="h-9 rounded-md border border-border bg-muted/40 px-2 text-sm outline-none focus:border-foreground"
              onChange={(event) => onPatch({ model: event.target.value })}
            />
          </div>
        )}
        {(node.kind === "image" || node.kind === "output") && node.imageUrl && (
          <button
            type="button"
            title={copy("Preview image", "预览图片")}
            aria-label={copy("Preview image", "预览图片")}
            className="relative h-56 w-full overflow-hidden rounded-md border border-border bg-muted/20"
            onClick={() =>
              node.imageUrl
                ? onPreviewImage({
                    imageUrl: node.imageUrl,
                    title: node.title,
                  })
                : undefined
            }
          >
            <Image
              src={node.imageUrl}
              alt={node.title}
              fill
              sizes="280px"
              className="object-contain"
              unoptimized
            />
          </button>
        )}
        {node.kind === "output" && !node.imageUrl && (
          <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
            {copy("Output", "输出")}
          </div>
        )}
        {node.error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {node.error}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 渲染节点输入或输出连接点。
 *
 * @param props 连接点方向、可见状态、可访问标签和点击回调。
 * @returns 可点击的小圆形连接点。
 * @sideEffects 点击时把节点作为连接起点或终点。
 */
export function CanvasConnectorHandle({
  side,
  visible,
  label,
  onPointerDown,
}: {
  side: ConnectorSide;
  visible: boolean;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onPointerDown={onPointerDown}
      className={cn(
        "absolute top-1/2 z-20 h-4 w-4 -translate-y-1/2 rounded-full",
        "border border-emerald-300 bg-background transition-opacity",
        "shadow-[0_0_0_3px_rgba(16,185,129,0.16)] hover:bg-emerald-400",
        "focus-visible:opacity-100 focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-emerald-400",
        side === "input"
          ? "left-0 -translate-x-1/2"
          : "right-0 translate-x-1/2",
        visible ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )}
    >
      <span
        className={cn(
          "absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full",
          "-translate-x-1/2 -translate-y-1/2 bg-emerald-400"
        )}
      />
    </button>
  );
}

/**
 * 渲染节点类型图标。
 *
 * @param props 节点类型。
 * @returns 图标元素。
 * @sideEffects 无。
 */
export function NodeIcon({ kind }: { kind: CanvasNodeKind }) {
  if (kind === "prompt") return <TextCursorInput className="h-4 w-4" />;
  if (kind === "image") return <ImageIcon className="h-4 w-4" />;
  if (kind === "generator") return <Wand2 className="h-4 w-4" />;
  if (kind === "loop") return <Repeat2 className="h-4 w-4" />;
  return <PanelRightOpen className="h-4 w-4" />;
}

/**
 * 渲染一条节点连线。
 *
 * @param props 连线、节点集合和选中状态。
 * @returns SVG path。
 * @sideEffects 无。
 */
export function CanvasEdgePath({
  edge,
  nodes,
  selected,
  onSelect,
}: {
  edge: CanvasEdge;
  nodes: CanvasNode[];
  selected: boolean;
  onSelect: (edgeId: string) => void;
}) {
  const from = nodes.find((node) => node.id === edge.from);
  const to = nodes.find((node) => node.id === edge.to);
  if (!from || !to) return null;
  const start = { x: from.x + from.width, y: from.y + from.height / 2 };
  const end = { x: to.x, y: to.y + to.height / 2 };
  const curve = Math.max(60, Math.abs(end.x - start.x) / 2);
  const path = `M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${
    end.x - curve
  } ${end.y}, ${end.x} ${end.y}`;
  const stroke = selected ? "rgb(255 255 255)" : "rgb(52 211 153)";
  return (
    <g className="pointer-events-auto">
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        strokeLinecap="round"
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect(edge.id);
        }}
      />
      <path
        d={path}
        fill="none"
        markerEnd="url(#canvas-edge-arrow)"
        stroke={stroke}
        strokeWidth={selected ? 4 : 3}
        strokeLinecap="round"
        opacity={selected ? 0.98 : 0.9}
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect(edge.id);
        }}
      />
      <circle
        cx={start.x}
        cy={start.y}
        r={6}
        fill="rgb(52 211 153)"
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect(edge.id);
        }}
      />
      <circle
        cx={end.x}
        cy={end.y}
        r={6}
        fill={selected ? "rgb(255 255 255)" : "rgb(52 211 153)"}
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect(edge.id);
        }}
      />
    </g>
  );
}

/**
 * 计算迷你地图渲染数据。
 *
 * @param nodes 画布节点。
 * @param viewport 当前视口。
 * @returns 节点和视口在迷你地图中的矩形。
 * @sideEffects 无。
 */
export function buildMinimap(nodes: CanvasNode[], viewport: CanvasViewport) {
  const width = 176;
  const height = 100;
  const bounds = getCanvasNodeBounds(nodes);
  if (!bounds) {
    return {
      nodes: [],
      viewport: { left: 4, top: 4, width: 28, height: 18 },
    };
  }
  const scale = Math.min(
    (width - 16) / Math.max(bounds.width, 1),
    (height - 16) / Math.max(bounds.height, 1)
  );
  const toMini = (x: number, y: number) => ({
    x: 8 + (x - bounds.minX) * scale,
    y: 8 + (y - bounds.minY) * scale,
  });
  const viewportWorld = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: width / viewport.zoom,
    height: height / viewport.zoom,
  };
  const viewportStart = toMini(viewportWorld.x, viewportWorld.y);
  return {
    nodes: nodes.map((node) => {
      const point = toMini(node.x, node.y);
      return {
        id: node.id,
        x: point.x,
        y: point.y,
        width: Math.max(3, node.width * scale),
        height: Math.max(3, node.height * scale),
      };
    }),
    viewport: {
      left: viewportStart.x,
      top: viewportStart.y,
      width: Math.max(12, viewportWorld.width * scale),
      height: Math.max(10, viewportWorld.height * scale),
    },
  };
}

// 重新导出供外部继续使用尺寸值类型，避免循环依赖。
export type { AspectRatioSizeDialogValue };
