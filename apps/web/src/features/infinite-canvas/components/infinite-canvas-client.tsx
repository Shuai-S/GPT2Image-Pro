"use client";

import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/utils";
import {
  Download,
  FileUp,
  Frame,
  Hand,
  Image as ImageIcon,
  Link2,
  Loader2,
  LocateFixed,
  MousePointer2,
  PanelRightOpen,
  Save,
  Sparkles,
  TextCursorInput,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import Image from "next/image";
import { useLocale } from "next-intl";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  addCanvasEdge,
  addCanvasNode,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeKind,
  type CanvasState,
  type CanvasViewport,
  clampCanvasZoom,
  createCanvasNode,
  createEmptyCanvasState,
  fitViewportToNodes,
  getCanvasNodeBounds,
  getInputNodesForNode,
  moveCanvasNode,
  parseCanvasState,
  removeCanvasEdge,
  removeCanvasNodes,
  screenPointToWorld,
  serializeCanvasState,
  updateCanvasNode,
} from "@/features/infinite-canvas/canvas-state";

/**
 * 无限画布主交互组件。
 *
 * 使用方：/dashboard/canvas 页面。
 * 关键依赖：画布纯函数、现有图片生成 API、localStorage 本地持久化。
 */

const STORAGE_KEY = "gpt2image.infinite-canvas.v1";
const DEFAULT_NODE_POSITION = { x: 80, y: 80 };
const GENERATION_RESULT_SCHEMA = z.object({
  error: z.string().optional(),
  imageUrl: z.string().optional(),
  imageBase64: z.string().optional(),
  imageOutputs: z
    .array(
      z.object({
        imageUrl: z.string().optional(),
        imageBase64: z.string().optional(),
      })
    )
    .optional(),
  revisedPrompt: z.string().optional(),
});

type ActiveTool = "select" | "pan" | "connect";

type DragState =
  | {
      type: "pan";
      pointerId: number;
      start: { x: number; y: number };
      viewport: CanvasViewport;
    }
  | {
      type: "node";
      pointerId: number;
      nodeId: string;
      lastWorld: { x: number; y: number };
    };

type GenerationResult = z.infer<typeof GENERATION_RESULT_SCHEMA>;

/**
 * 渲染无限画布并管理其客户端状态。
 *
 * @returns 无限画布编辑器界面。
 * @sideEffects 读写 localStorage、调用图片生成 API、触发文件下载与 toast。
 */
export function InfiniteCanvasClient() {
  const locale = useLocale();
  const isZh = locale.startsWith("zh");
  const boardRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [state, setState] = useState<CanvasState>(() =>
    createEmptyCanvasState(isZh ? "无限画布" : "Infinite Canvas")
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<ActiveTool>("select");
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [isBooted, setBooted] = useState(false);
  const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
  const selectedNode = useMemo(
    () => state.nodes.find((node) => node.id === selectedIds[0]),
    [selectedIds, state.nodes]
  );
  const selectedEdges = useMemo(
    () =>
      state.edges.filter(
        (edge) =>
          selectedIds.includes(edge.from) && selectedIds.includes(edge.to)
      ),
    [selectedIds, state.edges]
  );

  /**
   * 根据当前语言返回短文本。
   *
   * @param en 英文文本。
   * @param zh 简体中文文本。
   * @returns 当前界面语言对应的文本。
   * @sideEffects 无。
   */
  const copy = useCallback(
    (en: string, zh: string) => (isZh ? zh : en),
    [isZh]
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setBooted(true);
        return;
      }
      const parsedJson: unknown = JSON.parse(stored);
      const parsed = parseCanvasState(parsedJson);
      if (parsed.success) {
        setState(parsed.data);
      }
    } catch {
      toast.error(
        copy("Canvas draft could not be restored", "画布草稿恢复失败")
      );
    } finally {
      setBooted(true);
    }
  }, [copy]);

  useEffect(() => {
    if (!isBooted) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, serializeCanvasState(state));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [isBooted, state]);

  /**
   * 以函数式更新画布状态，避免拖拽期间读到旧闭包。
   *
   * @param updater 状态更新函数。
   * @sideEffects 更新 React state。
   */
  const patchState = useCallback(
    (updater: (current: CanvasState) => CanvasState) => {
      setState((current) => updater(current));
    },
    []
  );

  /**
   * 计算画布容器中心对应的世界坐标。
   *
   * @returns 世界坐标；容器不可用时返回默认位置。
   * @sideEffects 读取 DOM 尺寸。
   */
  const getBoardCenterWorld = useCallback(() => {
    const board = boardRef.current;
    if (!board) return DEFAULT_NODE_POSITION;
    const rect = board.getBoundingClientRect();
    return screenPointToWorld(
      { x: rect.width / 2, y: rect.height / 2 },
      state.viewport
    );
  }, [state.viewport]);

  /**
   * 添加指定类型节点。
   *
   * @param kind 节点类型。
   * @param overrides 节点字段覆盖。
   * @returns 新节点 ID。
   * @sideEffects 更新画布状态和选区。
   */
  const addNode = useCallback(
    (
      kind: CanvasNodeKind,
      overrides: Partial<Omit<CanvasNode, "id" | "kind" | "x" | "y">> = {}
    ) => {
      const center = getBoardCenterWorld();
      const node = createCanvasNode(kind, center, overrides);
      patchState((current) => addCanvasNode(current, node));
      setSelectedIds([node.id]);
      return node.id;
    },
    [getBoardCenterWorld, patchState]
  );

  /**
   * 处理工具栏上传图片文件。
   *
   * @param files 用户选择的文件列表。
   * @sideEffects 读取本地文件并创建图片节点。
   */
  const addImageFiles = useCallback(
    async (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((file) =>
        file.type.startsWith("image/")
      );
      if (imageFiles.length === 0) return;
      for (const [index, file] of imageFiles.entries()) {
        const imageUrl = await readFileAsDataUrl(file);
        const center = getBoardCenterWorld();
        const node = createCanvasNode(
          "image",
          { x: center.x + index * 32, y: center.y + index * 32 },
          {
            title: file.name.slice(0, 80) || "Image",
            imageUrl,
          }
        );
        patchState((current) => addCanvasNode(current, node));
        setSelectedIds([node.id]);
      }
    },
    [getBoardCenterWorld, patchState]
  );

  /**
   * 响应画布空白区域按下事件。
   *
   * @param event 指针事件。
   * @sideEffects 开始平移或清空选区。
   */
  const handleBoardPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const shouldPan =
      activeTool === "pan" || event.button === 1 || event.altKey;
    if (!shouldPan && activeTool === "select") {
      setSelectedIds([]);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      type: "pan",
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      viewport: state.viewport,
    };
  };

  /**
   * 响应画布指针移动。
   *
   * @param event 指针事件。
   * @sideEffects 更新视口或节点位置。
   */
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === "pan") {
      patchState((current) => ({
        ...current,
        viewport: {
          ...current.viewport,
          x: drag.viewport.x + event.clientX - drag.start.x,
          y: drag.viewport.y + event.clientY - drag.start.y,
        },
      }));
      return;
    }

    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const nextWorld = screenPointToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      state.viewport
    );
    const delta = {
      x: nextWorld.x - drag.lastWorld.x,
      y: nextWorld.y - drag.lastWorld.y,
    };
    dragRef.current = { ...drag, lastWorld: nextWorld };
    patchState((current) => moveCanvasNode(current, drag.nodeId, delta));
  };

  /**
   * 结束画布拖拽。
   *
   * @sideEffects 清理拖拽状态。
   */
  const handlePointerUp = () => {
    dragRef.current = null;
  };

  /**
   * 处理滚轮缩放，缩放中心保持在鼠标位置。
   *
   * @param event 滚轮事件。
   * @sideEffects 更新视口。
   */
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const before = screenPointToWorld(point, state.viewport);
    const nextZoom = clampCanvasZoom(
      state.viewport.zoom * (event.deltaY > 0 ? 0.9 : 1.1)
    );
    patchState((current) => ({
      ...current,
      viewport: {
        zoom: nextZoom,
        x: point.x - before.x * nextZoom,
        y: point.y - before.y * nextZoom,
      },
    }));
  };

  /**
   * 选择或连接节点。
   *
   * @param nodeId 节点 ID。
   * @param event 指针事件。
   * @sideEffects 更新选区或连线。
   */
  const handleNodePointerDown = (
    nodeId: string,
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    event.stopPropagation();
    if (activeTool === "connect") {
      if (!connectFromId) {
        setConnectFromId(nodeId);
        setSelectedIds([nodeId]);
        return;
      }
      patchState((current) => addCanvasEdge(current, connectFromId, nodeId));
      setConnectFromId(null);
      setActiveTool("select");
      setSelectedIds([nodeId]);
      return;
    }

    setSelectedIds((current) =>
      event.shiftKey
        ? current.includes(nodeId)
          ? current.filter((id) => id !== nodeId)
          : [...current, nodeId]
        : [nodeId]
    );

    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const lastWorld = screenPointToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      state.viewport
    );
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      type: "node",
      pointerId: event.pointerId,
      nodeId,
      lastWorld,
    };
  };

  /**
   * 删除当前选中的节点或连线。
   *
   * @sideEffects 更新画布状态和选区。
   */
  const deleteSelection = useCallback(() => {
    if (selectedIds.length === 0 && selectedEdges.length === 0) return;
    patchState((current) => {
      let next = current;
      if (selectedIds.length > 0) {
        next = removeCanvasNodes(next, selectedIds);
      }
      for (const edge of selectedEdges) {
        next = removeCanvasEdge(next, edge.id);
      }
      return next;
    });
    setSelectedIds([]);
  }, [patchState, selectedEdges, selectedIds]);

  /**
   * 让视图适配所有节点。
   *
   * @sideEffects 读取 DOM 尺寸并更新视口。
   */
  const fitView = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    patchState((current) => ({
      ...current,
      viewport: fitViewportToNodes(current.nodes, {
        width: rect.width,
        height: rect.height,
      }),
    }));
  }, [patchState]);

  /**
   * 导出当前画布 JSON。
   *
   * @sideEffects 创建临时下载链接。
   */
  const exportCanvas = () => {
    const blob = new Blob([serializeCanvasState(state)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.title.replace(/[^\w-]+/g, "-") || "canvas"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * 处理画布 JSON 导入。
   *
   * @param file 用户选择的 JSON 文件。
   * @sideEffects 读取文件、校验 JSON 并覆盖当前画布。
   */
  const importCanvas = async (file: File) => {
    try {
      const text = await file.text();
      const parsedJson: unknown = JSON.parse(text);
      const parsed = parseCanvasState(parsedJson);
      if (!parsed.success) {
        toast.error(copy("Invalid canvas file", "画布文件无效"));
        return;
      }
      setState(parsed.data);
      setSelectedIds([]);
      toast.success(copy("Canvas imported", "画布已导入"));
    } catch {
      toast.error(copy("Import failed", "导入失败"));
    }
  };

  /**
   * 根据已连接输入组装生成提示词。
   *
   * @param node 生成节点。
   * @returns 提示词文本与输入图节点。
   * @sideEffects 无。
   */
  const buildGenerationInput = (node: CanvasNode) => {
    const inputs = getInputNodesForNode(state, node.id);
    const promptTexts = inputs
      .filter((input) => input.kind === "prompt" && input.prompt?.trim())
      .map((input) => input.prompt?.trim() || "");
    const prompt = [node.prompt?.trim(), ...promptTexts]
      .filter(Boolean)
      .join("\n\n");
    const imageNodes = inputs.filter(
      (input) =>
        (input.kind === "image" || input.kind === "output") && input.imageUrl
    );
    return { prompt, imageNodes };
  };

  /**
   * 运行当前选中的生成节点。
   *
   * @sideEffects 调用现有图片生成 API，并向画布追加输出节点。
   */
  const runSelectedGenerator = async () => {
    const node =
      selectedNode?.kind === "generator"
        ? selectedNode
        : state.nodes.find((item) => item.kind === "generator");
    if (!node) {
      toast.error(copy("Select a generator node first", "请先选择生成节点"));
      return;
    }
    const { prompt, imageNodes } = buildGenerationInput(node);
    if (!prompt) {
      toast.error(copy("Prompt is required", "请输入提示词"));
      return;
    }

    setRunningNodeId(node.id);
    patchState((current) =>
      updateCanvasNode(current, node.id, {
        status: "running",
        error: undefined,
      })
    );
    try {
      const result =
        imageNodes.length > 0
          ? await runImageEdit(prompt, node, imageNodes)
          : await runTextToImage(prompt, node);
      if (result.error) throw new Error(result.error);
      const imageUrl = firstImageUrl(result);
      if (!imageUrl) throw new Error(copy("No image returned", "未返回图片"));
      const outputNode = createCanvasNode(
        "output",
        { x: node.x + node.width + 72, y: node.y },
        {
          title: copy("Generated Image", "生成结果"),
          imageUrl,
          prompt: result.revisedPrompt || prompt,
        }
      );
      patchState((current) =>
        addCanvasEdge(
          addCanvasNode(current, outputNode),
          node.id,
          outputNode.id
        )
      );
      setSelectedIds([outputNode.id]);
      toast.success(copy("Image generated", "图片已生成"));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : copy("Generation failed", "生成失败");
      patchState((current) =>
        updateCanvasNode(current, node.id, { status: "failed", error: message })
      );
      toast.error(copy("Generation failed", "生成失败"), {
        description: message,
      });
    } finally {
      setRunningNodeId(null);
      patchState((current) =>
        updateCanvasNode(current, node.id, { status: "idle" })
      );
    }
  };

  /**
   * 重置画布为当前语言的空白状态。
   *
   * @sideEffects 覆盖画布状态并清空选区。
   */
  const resetCanvas = () => {
    setState(createEmptyCanvasState(copy("Infinite Canvas", "无限画布")));
    setSelectedIds([]);
    setConnectFromId(null);
  };

  const minimap = useMemo(
    () => buildMinimap(state.nodes, state.viewport),
    [state.nodes, state.viewport]
  );

  return (
    <section className="flex h-[calc(100vh-116px)] min-h-[620px] min-w-[820px] flex-col overflow-hidden rounded-md border border-border bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <ToolbarButton
            active={activeTool === "select"}
            label={copy("Select", "选择")}
            onClick={() => {
              setActiveTool("select");
              setConnectFromId(null);
            }}
          >
            <MousePointer2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={activeTool === "pan"}
            label={copy("Pan", "平移")}
            onClick={() => {
              setActiveTool("pan");
              setConnectFromId(null);
            }}
          >
            <Hand className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={activeTool === "connect"}
            label={copy("Connect", "连接")}
            onClick={() => {
              setActiveTool("connect");
              setConnectFromId(selectedIds[0] || null);
            }}
          >
            <Link2 className="h-4 w-4" />
          </ToolbarButton>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton
            label={copy("Prompt", "提示词")}
            onClick={() =>
              addNode("prompt", {
                title: copy("Prompt", "提示词"),
                prompt: "",
              })
            }
          >
            <TextCursorInput className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={copy("Image", "图片")}
            onClick={() => uploadInputRef.current?.click()}
          >
            <ImageIcon className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={copy("Generator", "生成")}
            onClick={() =>
              addNode("generator", {
                title: copy("Generator", "生成"),
                prompt: "",
              })
            }
          >
            <Wand2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={copy("Output", "输出")}
            onClick={() =>
              addNode("output", {
                title: copy("Output", "输出"),
              })
            }
          >
            <PanelRightOpen className="h-4 w-4" />
          </ToolbarButton>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={runSelectedGenerator}
            disabled={Boolean(runningNodeId)}
            className="h-9 gap-2"
          >
            {runningNodeId ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {copy("Run", "运行")}
          </Button>
          <ToolbarButton label={copy("Fit", "适配")} onClick={fitView}>
            <LocateFixed className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={copy("Import", "导入")}
            onClick={() => importInputRef.current?.click()}
          >
            <FileUp className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label={copy("Export", "导出")} onClick={exportCanvas}>
            <Download className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={copy("Delete", "删除")}
            onClick={deleteSelection}
          >
            <Trash2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label={copy("Clear", "清空")} onClick={resetCanvas}>
            <X className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </div>

      <div
        ref={boardRef}
        role="application"
        aria-label={copy("Infinite canvas workspace", "无限画布工作区")}
        className={cn(
          "relative flex-1 overflow-hidden bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] bg-[length:24px_24px]",
          activeTool === "pan" ? "cursor-grab" : "cursor-default"
        )}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void addImageFiles(event.dataTransfer.files);
        }}
        onPointerDown={handleBoardPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <g
            transform={`translate(${state.viewport.x} ${state.viewport.y}) scale(${state.viewport.zoom})`}
          >
            {state.edges.map((edge) => (
              <CanvasEdgePath
                key={edge.id}
                edge={edge}
                nodes={state.nodes}
                selected={selectedEdges.some((item) => item.id === edge.id)}
              />
            ))}
          </g>
        </svg>
        <div
          className="absolute left-0 top-0"
          style={{
            transform: `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {state.nodes.map((node) => (
            <CanvasNodeView
              key={node.id}
              node={node}
              selected={selectedIds.includes(node.id)}
              connectSource={connectFromId === node.id}
              onPointerDown={handleNodePointerDown}
              onPatch={(patch) =>
                patchState((current) =>
                  updateCanvasNode(current, node.id, patch)
                )
              }
              onRun={runSelectedGenerator}
              copy={copy}
            />
          ))}
        </div>

        <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-md border border-border bg-background/95 px-2 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
          <Save className="h-3.5 w-3.5" />
          <span>{new Date(state.updatedAt).toLocaleTimeString(locale)}</span>
          <span>{Math.round(state.viewport.zoom * 100)}%</span>
          {activeTool === "connect" && (
            <span className="text-foreground">
              {connectFromId
                ? copy("Pick target", "选择目标")
                : copy("Pick source", "选择起点")}
            </span>
          )}
        </div>

        <div className="absolute bottom-4 right-4 h-32 w-44 overflow-hidden rounded-md border border-border bg-background/95 shadow-sm backdrop-blur">
          <div className="flex h-7 items-center gap-1.5 border-b border-border px-2 text-xs font-medium">
            <Frame className="h-3.5 w-3.5" />
            {copy("Map", "导航图")}
          </div>
          <div className="relative h-[100px]">
            {minimap.nodes.map((node) => (
              <div
                key={node.id}
                className="absolute rounded-sm bg-foreground/70"
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  height: node.height,
                }}
              />
            ))}
            <div
              className="absolute rounded-sm border border-emerald-500 bg-emerald-500/10"
              style={minimap.viewport}
            />
          </div>
        </div>
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.currentTarget.files) {
            void addImageFiles(event.currentTarget.files);
          }
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void importCanvas(file);
          event.currentTarget.value = "";
        }}
      />
    </section>
  );
}

type ToolbarButtonProps = {
  active?: boolean;
  label: string;
  children: React.ReactNode;
  onClick: () => void;
};

/**
 * 渲染工具栏图标按钮。
 *
 * @param props 按钮状态、标签和点击回调。
 * @returns 工具栏按钮。
 * @sideEffects 点击时执行父组件回调。
 */
function ToolbarButton({
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

type CanvasNodeViewProps = {
  node: CanvasNode;
  selected: boolean;
  connectSource: boolean;
  onPointerDown: (
    nodeId: string,
    event: ReactPointerEvent<HTMLDivElement>
  ) => void;
  onPatch: (patch: Partial<Omit<CanvasNode, "id" | "kind">>) => void;
  onRun: () => Promise<void>;
  copy: (en: string, zh: string) => string;
};

/**
 * 渲染单个画布节点。
 *
 * @param props 节点数据、选区状态与回调。
 * @returns 节点 DOM。
 * @sideEffects 输入时更新父组件画布状态。
 */
function CanvasNodeView({
  node,
  selected,
  connectSource,
  onPointerDown,
  onPatch,
  onRun,
  copy,
}: CanvasNodeViewProps) {
  const tone = {
    prompt: "border-amber-300/70",
    image: "border-emerald-300/70",
    generator: "border-violet-300/70",
    output: "border-rose-300/70",
  }[node.kind];

  return (
    <div
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-md border bg-background shadow-sm",
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
        {node.kind === "generator" && (
          <button
            type="button"
            title={copy("Run", "运行")}
            aria-label={copy("Run", "运行")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void onRun()}
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
        {(node.kind === "prompt" || node.kind === "generator") && (
          <textarea
            value={node.prompt || ""}
            aria-label={copy("Prompt", "提示词")}
            placeholder={copy("Prompt", "提示词")}
            className="min-h-24 flex-1 resize-none rounded-md border border-border bg-muted/40 p-2 text-sm outline-none focus:border-foreground"
            onChange={(event) => onPatch({ prompt: event.target.value })}
          />
        )}
        {node.kind === "generator" && (
          <div className="grid grid-cols-2 gap-2">
            <input
              value={node.size || "1024x1024"}
              aria-label={copy("Size", "尺寸")}
              className="h-9 rounded-md border border-border bg-muted/40 px-2 text-sm outline-none focus:border-foreground"
              onChange={(event) => onPatch({ size: event.target.value })}
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
          <div className="relative h-56 w-full overflow-hidden rounded-md border border-border">
            <Image
              src={node.imageUrl}
              alt={node.title}
              fill
              sizes="280px"
              className="object-contain"
              unoptimized
            />
          </div>
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
 * 渲染节点类型图标。
 *
 * @param props 节点类型。
 * @returns 图标元素。
 * @sideEffects 无。
 */
function NodeIcon({ kind }: { kind: CanvasNodeKind }) {
  if (kind === "prompt") return <TextCursorInput className="h-4 w-4" />;
  if (kind === "image") return <ImageIcon className="h-4 w-4" />;
  if (kind === "generator") return <Wand2 className="h-4 w-4" />;
  return <PanelRightOpen className="h-4 w-4" />;
}

/**
 * 渲染一条节点连线。
 *
 * @param props 连线、节点集合和选中状态。
 * @returns SVG path。
 * @sideEffects 无。
 */
function CanvasEdgePath({
  edge,
  nodes,
  selected,
}: {
  edge: CanvasEdge;
  nodes: CanvasNode[];
  selected: boolean;
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
  return (
    <path
      d={path}
      fill="none"
      stroke={
        selected ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"
      }
      strokeWidth={selected ? 3 : 2}
      strokeLinecap="round"
      opacity={selected ? 0.95 : 0.55}
    />
  );
}

/**
 * 把本地文件读取为 data URL。
 *
 * @param file 图片文件。
 * @returns data URL。
 * @sideEffects 读取用户选择的本地文件。
 */
function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("File read failed"));
    reader.onerror = () =>
      reject(reader.error || new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * 运行文生图请求。
 *
 * @param prompt 合成后的提示词。
 * @param node 生成节点配置。
 * @returns 生成接口结果。
 * @sideEffects 发起同源网络请求并消耗用户积分。
 */
async function runTextToImage(prompt: string, node: CanvasNode) {
  const response = await fetch("/api/images/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      size: node.size || "1024x1024",
      model: node.model || undefined,
    }),
  });
  return parseGenerationResponse(response);
}

/**
 * 运行图生图请求。
 *
 * @param prompt 合成后的提示词。
 * @param node 生成节点配置。
 * @param imageNodes 输入图片节点。
 * @returns 生成接口结果。
 * @sideEffects 抓取图片数据、发起同源网络请求并消耗用户积分。
 */
async function runImageEdit(
  prompt: string,
  node: CanvasNode,
  imageNodes: CanvasNode[]
) {
  const formData = new FormData();
  formData.set("prompt", prompt);
  formData.set("size", node.size || "1024x1024");
  if (node.model) formData.set("model", node.model);

  for (const [index, imageNode] of imageNodes.entries()) {
    if (!imageNode.imageUrl) continue;
    const file = await imageUrlToFile(
      imageNode.imageUrl,
      `canvas-${index}.png`
    );
    formData.append("image", file);
  }

  const response = await fetch("/api/images/edit", {
    method: "POST",
    body: formData,
  });
  return parseGenerationResponse(response);
}

/**
 * 将图片 URL 转换为 File。
 *
 * @param imageUrl data URL 或同源图片 URL。
 * @param fallbackName 缺省文件名。
 * @returns 图片文件。
 * @sideEffects 对非 data URL 发起 fetch 请求。
 */
async function imageUrlToFile(imageUrl: string, fallbackName: string) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error("Image fetch failed");
  const blob = await response.blob();
  const type = blob.type || "image/png";
  return new File([blob], fallbackName, { type });
}

/**
 * 解析图片生成响应。
 *
 * @param response fetch 响应。
 * @returns 校验后的响应体。
 * @sideEffects 读取响应体。
 */
async function parseGenerationResponse(
  response: Response
): Promise<GenerationResult> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String(body.error)
        : "Request failed";
    throw new Error(message);
  }
  const parsed = GENERATION_RESULT_SCHEMA.safeParse(body);
  if (!parsed.success) throw new Error("Invalid generation response");
  return parsed.data;
}

/**
 * 从生成响应中取第一张可显示图片。
 *
 * @param result 生成接口结果。
 * @returns 图片 URL 或 data URL。
 * @sideEffects 无。
 */
function firstImageUrl(result: GenerationResult) {
  if (result.imageUrl) return result.imageUrl;
  if (result.imageBase64) return `data:image/png;base64,${result.imageBase64}`;
  const output = result.imageOutputs?.find(
    (item) => item.imageUrl || item.imageBase64
  );
  if (output?.imageUrl) return output.imageUrl;
  if (output?.imageBase64) return `data:image/png;base64,${output.imageBase64}`;
  return undefined;
}

/**
 * 计算迷你地图渲染数据。
 *
 * @param nodes 画布节点。
 * @param viewport 当前视口。
 * @returns 节点和视口在迷你地图中的矩形。
 * @sideEffects 无。
 */
function buildMinimap(nodes: CanvasNode[], viewport: CanvasViewport) {
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
