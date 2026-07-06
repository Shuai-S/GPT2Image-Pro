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
  InlineImageSizeControl,
  type AspectRatioSizeDialogValue,
} from "@/features/image-generation/components/aspect-ratio-size-dialog";
import {
  AUTO_IMAGE_SIZE,
  DEFAULT_IMAGE_SIZE,
  normalizeImageSize,
  parseImageSize,
} from "@/features/image-generation/resolution";
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
import { CachedImage as Image } from "@/features/shared/components/cached-image";

/**
 * 无限画布主交互组件。
 *
 * 使用方：/dashboard/canvas 页面。
 * 关键依赖：画布纯函数、现有图片生成 API、localStorage 本地持久化。
 */

const STORAGE_KEY = "gpt2image.infinite-canvas.v1";
const DEFAULT_NODE_POSITION = { x: 80, y: 80 };
const DEFAULT_CANVAS_IMAGE_DIMENSIONS = { width: 1024, height: 1024 };
const GENERATION_STATUS_POLL_INTERVAL_MS = 1500;
const GENERATION_STATUS_TIMEOUT_MS = 180_000;
const GENERATION_RESULT_SCHEMA = z.object({
  error: z.string().optional(),
  generationId: z.string().optional(),
  status: z.enum(["pending", "completed", "failed"]).optional(),
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
  model: z.string().optional(),
  size: z.string().optional(),
  creditsConsumed: z.number().optional(),
});

type ActiveTool = "select" | "pan" | "connect";
type ConnectorSide = "input" | "output";

type ImagePreviewState = {
  imageUrl: string;
  title: string;
};

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
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<ActiveTool>("select");
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [isBooted, setBooted] = useState(false);
  const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(
    null
  );
  const selectedNode = useMemo(
    () => state.nodes.find((node) => node.id === selectedIds[0]),
    [selectedIds, state.nodes]
  );
  const selectedEdges = useMemo(
    () => state.edges.filter((edge) => selectedEdgeIds.includes(edge.id)),
    [selectedEdgeIds, state.edges]
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

  /**
   * 下载当前预览中的图片。
   *
   * @sideEffects 读取图片数据并触发浏览器下载；跨域受限时退回直接下载链接。
   */
  const downloadPreviewImage = async () => {
    if (!imagePreview) return;
    try {
      await downloadCanvasImage(imagePreview.imageUrl, imagePreview.title);
      toast.success(copy("Image download started", "图片下载已开始"));
    } catch {
      triggerImageDownload(
        imagePreview.imageUrl,
        getCanvasImageDownloadName(imagePreview.title, imagePreview.imageUrl)
      );
      toast.info(copy("Download link opened", "已打开下载链接"));
    }
  };

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
      setSelectedEdgeIds([]);
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
        setSelectedEdgeIds([]);
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
      setSelectedEdgeIds([]);
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
   * 建立两个节点之间的有向连接。
   *
   * @param sourceId 输出侧节点 ID。
   * @param targetId 输入侧节点 ID。
   * @sideEffects 更新连线状态、连接工具状态与选区，并在无效连接时提示用户。
   */
  const connectCanvasNodes = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) {
      toast.info(copy("Pick another node to connect", "请选择另一个节点连接"));
      setSelectedIds([targetId]);
      setSelectedEdgeIds([]);
      return;
    }
    if (
      state.edges.some((edge) => edge.from === sourceId && edge.to === targetId)
    ) {
      toast.info(copy("Connection already exists", "这条连接已存在"));
      setConnectFromId(null);
      setActiveTool("select");
      setSelectedIds([targetId]);
      setSelectedEdgeIds([]);
      return;
    }
    patchState((current) => addCanvasEdge(current, sourceId, targetId));
    setConnectFromId(null);
    setActiveTool("select");
    setSelectedIds([targetId]);
    setSelectedEdgeIds([]);
  };

  /**
   * 选择、拖拽或在连接模式下连接整个节点卡片。
   *
   * @param nodeId 节点 ID。
   * @param event 指针事件。
   * @sideEffects 更新选区、拖拽状态或连线。
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
        setSelectedEdgeIds([]);
        return;
      }
      connectCanvasNodes(connectFromId, nodeId);
      return;
    }

    setSelectedIds((current) =>
      event.shiftKey
        ? current.includes(nodeId)
          ? current.filter((id) => id !== nodeId)
          : [...current, nodeId]
        : [nodeId]
    );
    setSelectedEdgeIds([]);

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
   * 处理节点左右连接点的点击。
   *
   * @param nodeId 连接点所属节点 ID。
   * @param side 输入点或输出点。
   * @param event 指针事件。
   * @sideEffects 输出点会进入连接模式，输入点会尝试完成连线。
   */
  const handleConnectorPointerDown = (
    nodeId: string,
    side: ConnectorSide,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    if (side === "output") {
      setActiveTool("connect");
      setConnectFromId(nodeId);
      setSelectedIds([nodeId]);
      setSelectedEdgeIds([]);
      return;
    }
    if (!connectFromId) {
      toast.info(copy("Pick a source connector first", "请先选择右侧输出圆点"));
      setActiveTool("connect");
      setSelectedIds([nodeId]);
      setSelectedEdgeIds([]);
      return;
    }
    connectCanvasNodes(connectFromId, nodeId);
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
    setSelectedEdgeIds([]);
  }, [patchState, selectedEdges, selectedIds]);

  /**
   * 响应画布级删除快捷键。
   *
   * @param event 键盘事件。
   * @sideEffects 在焦点不处于编辑控件内时删除当前选区。
   */
  const handleBoardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    deleteSelection();
  };

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
      setSelectedEdgeIds([]);
      toast.success(copy("Canvas imported", "画布已导入"));
    } catch {
      toast.error(copy("Import failed", "导入失败"));
    }
  };

  /**
   * 根据已连接输入组装提示词或生成节点的生成参数。
   *
   * @param node 提示词节点或生成节点。
   * @returns 提示词文本与输入图节点。
   * @sideEffects 无。
   */
  const buildGenerationInput = (node: CanvasNode) => {
    const inputs = getInputNodesForNode(state, node.id);
    const nestedInputs = inputs
      .filter((input) => input.kind === "prompt")
      .flatMap((input) => getInputNodesForNode(state, input.id));
    const promptTexts = inputs
      .filter((input) => input.kind === "prompt" && input.prompt?.trim())
      .map((input) => input.prompt?.trim() || "");
    const prompt = [node.prompt?.trim(), ...promptTexts]
      .filter(Boolean)
      .join("\n\n");
    const imageNodeById = new Map(
      [...inputs, ...nestedInputs]
        .filter(
          (input) =>
            (input.kind === "image" || input.kind === "output") &&
            input.imageUrl
        )
        .map((input) => [input.id, input])
    );
    const imageNodes = Array.from(imageNodeById.values());
    return { prompt, imageNodes };
  };

  /**
   * 运行当前指定或选中的提示词/生成节点。
   *
   * @sideEffects 调用现有图片生成 API，并向画布追加输出节点。
   */
  const runSelectedGenerator = async (nodeId?: string) => {
    const forcedNode = nodeId
      ? state.nodes.find((item) => item.id === nodeId)
      : undefined;
    const forcedRunnableNode =
      forcedNode?.kind === "generator" || forcedNode?.kind === "prompt"
        ? forcedNode
        : undefined;
    const selectedRunnableNode =
      selectedNode?.kind === "generator" || selectedNode?.kind === "prompt"
        ? selectedNode
        : undefined;
    const fallbackRunnableNode = state.nodes.find(
      (item) => item.kind === "generator" || item.kind === "prompt"
    );
    const node =
      forcedRunnableNode || selectedRunnableNode || fallbackRunnableNode;
    if (!node) {
      toast.error(
        copy(
          "Select a prompt or generator node first",
          "请先选择提示词或生成节点"
        )
      );
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
      const initialResult =
        imageNodes.length > 0
          ? await runImageEdit(prompt, node, imageNodes)
          : await runTextToImage(prompt, node);
      const result = await resolveGenerationResult(initialResult, copy);
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
      patchState((current) =>
        updateCanvasNode(current, node.id, { status: "idle", error: undefined })
      );
      setSelectedIds([outputNode.id]);
      setSelectedEdgeIds([]);
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
    setSelectedEdgeIds([]);
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
              setSelectedEdgeIds([]);
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
              setSelectedEdgeIds([]);
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
              setSelectedEdgeIds([]);
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
            onClick={() => void runSelectedGenerator()}
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
        // biome-ignore lint/a11y/noNoninteractiveTabindex: 无限画布工作区需要接收键盘快捷键焦点。
        tabIndex={0}
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
        onKeyDown={handleBoardKeyDown}
        onWheel={handleWheel}
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="canvas-edge-arrow"
              markerHeight="8"
              markerWidth="8"
              orient="auto"
              refX="7"
              refY="4"
              viewBox="0 0 8 8"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill="rgb(52 211 153)" />
            </marker>
          </defs>
          <g
            transform={`translate(${state.viewport.x} ${state.viewport.y}) scale(${state.viewport.zoom})`}
          >
            {state.edges.map((edge) => (
              <CanvasEdgePath
                key={edge.id}
                edge={edge}
                nodes={state.nodes}
                selected={selectedEdges.some((item) => item.id === edge.id)}
                onSelect={(edgeId) => {
                  setSelectedIds([]);
                  setSelectedEdgeIds([edgeId]);
                  setConnectFromId(null);
                  setActiveTool("select");
                }}
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
              connectMode={activeTool === "connect"}
              connectSource={connectFromId === node.id}
              onPointerDown={handleNodePointerDown}
              onConnectorPointerDown={handleConnectorPointerDown}
              onPatch={(patch) =>
                patchState((current) =>
                  updateCanvasNode(current, node.id, patch)
                )
              }
              onPreviewImage={(preview) => setImagePreview(preview)}
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
          {selectedEdgeIds.length > 0 && (
            <span className="text-foreground">
              {copy("Connection selected", "已选择连接线")}
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
      {imagePreview && (
        <ImagePreviewDialog
          preview={imagePreview}
          copy={copy}
          onClose={() => setImagePreview(null)}
          onDownload={() => void downloadPreviewImage()}
        />
      )}
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
 * 渲染画布图片的大图预览层。
 *
 * @param props 预览图片、文案函数、关闭与下载回调。
 * @returns 带下载入口的图片预览弹层。
 * @sideEffects 点击遮罩关闭，点击下载触发父组件下载逻辑。
 */
function ImagePreviewDialog({
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex h-full max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-md border border-border bg-background shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
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
 * 把画布节点保存的尺寸字符串转换为共享比例控件需要的值对象。
 *
 * @param size 节点持久化的 WIDTHxHEIGHT 或 auto。
 * @returns 比例控件可渲染的尺寸值。
 * @sideEffects 无。
 */
function getCanvasNodeSizeValue(
  size?: string | null
): AspectRatioSizeDialogValue {
  const normalizedSize = size?.trim().toLowerCase();
  const fallback =
    parseImageSize(DEFAULT_IMAGE_SIZE) || DEFAULT_CANVAS_IMAGE_DIMENSIONS;

  if (normalizedSize === AUTO_IMAGE_SIZE) {
    return {
      auto: true,
      width: fallback.width,
      height: fallback.height,
      mixWebFirst: false,
    };
  }

  const dimensions = normalizedSize ? parseImageSize(normalizedSize) : fallback;
  return {
    auto: false,
    width: dimensions?.width || fallback.width,
    height: dimensions?.height || fallback.height,
    mixWebFirst: false,
  };
}

/**
 * 把共享比例控件的值转换为画布节点保存的尺寸字符串。
 *
 * @param value 比例控件返回的尺寸值。
 * @returns 节点与生成接口使用的尺寸字符串。
 * @sideEffects 无。
 */
function getCanvasNodeSizeFromValue(value: AspectRatioSizeDialogValue) {
  if (value.auto) return AUTO_IMAGE_SIZE;
  return normalizeImageSize(value.width, value.height);
}

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
    output: "border-rose-300/70",
  }[node.kind];

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
        {(node.kind === "prompt" || node.kind === "generator") && (
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
function CanvasConnectorHandle({
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
 * 下载画布中的图片资源。
 *
 * @param imageUrl 图片 data URL 或网络 URL。
 * @param title 用于生成下载文件名的节点标题。
 * @sideEffects 读取图片并触发浏览器下载。
 */
async function downloadCanvasImage(imageUrl: string, title: string) {
  const fileName = getCanvasImageDownloadName(title, imageUrl);
  if (imageUrl.startsWith("data:")) {
    triggerImageDownload(imageUrl, fileName);
    return;
  }

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error("Image download failed");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    triggerImageDownload(objectUrl, fileName);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

/**
 * 触发浏览器下载链接。
 *
 * @param url 下载 URL。
 * @param fileName 文件名。
 * @sideEffects 创建并点击临时下载链接。
 */
function triggerImageDownload(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * 根据节点标题和图片地址生成下载文件名。
 *
 * @param title 节点标题。
 * @param imageUrl 图片地址。
 * @returns 安全的图片文件名。
 * @sideEffects 无。
 */
function getCanvasImageDownloadName(title: string, imageUrl: string) {
  const baseName =
    title
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "canvas-image";
  return `${baseName}.${getCanvasImageExtension(imageUrl)}`;
}

/**
 * 从图片 URL 中推断扩展名。
 *
 * @param imageUrl 图片地址。
 * @returns 浏览器下载使用的扩展名。
 * @sideEffects 无。
 */
function getCanvasImageExtension(imageUrl: string) {
  const dataMatch = /^data:image\/([a-z0-9.+-]+);/i.exec(imageUrl);
  if (dataMatch?.[1]) return normalizeImageExtension(dataMatch[1]);
  try {
    const pathname = new URL(imageUrl, window.location.href).pathname;
    const extension = pathname.split(".").pop()?.toLowerCase();
    if (extension) return normalizeImageExtension(extension);
  } catch {
    return "png";
  }
  return "png";
}

/**
 * 把 MIME 子类型或路径扩展名归一为常见图片扩展名。
 *
 * @param value MIME 子类型或扩展名。
 * @returns 可用于文件名的扩展名。
 * @sideEffects 无。
 */
function normalizeImageExtension(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "jpeg" || normalized === "jpg") return "jpg";
  if (normalized === "webp") return "webp";
  if (normalized === "gif") return "gif";
  if (normalized === "avif") return "avif";
  return "png";
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
      size: node.size || DEFAULT_IMAGE_SIZE,
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
  formData.set("size", node.size || DEFAULT_IMAGE_SIZE);
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
 * 等待已提交的生成任务完成。
 *
 * WHY：部分后端会先返回 generationId，图片稍后写入 generation 表。
 * 如果画布端直接要求首个响应带 imageUrl，就会误判失败，但图库稍后能看到成功结果。
 *
 * @param generationId 生成任务 ID。
 * @param initialError 首次响应携带的错误，用于状态记录不存在时快速返回真实错误。
 * @param copy 当前语言文本函数。
 * @returns 最终生成结果。
 * @sideEffects 轮询同源状态接口。
 */
async function pollGenerationResult(
  generationId: string,
  initialError: string | undefined,
  copy: (en: string, zh: string) => string
): Promise<GenerationResult> {
  const deadline = Date.now() + GENERATION_STATUS_TIMEOUT_MS;
  let lastError = initialError;

  while (Date.now() < deadline) {
    await delay(GENERATION_STATUS_POLL_INTERVAL_MS);
    const response = await fetch(
      `/api/images/status/${encodeURIComponent(generationId)}`
    );

    if (response.status === 404 && initialError) {
      throw new Error(initialError);
    }
    if (!response.ok) {
      lastError = `Status request failed: ${response.status}`;
      continue;
    }

    const result = await parseGenerationResponse(response);
    const imageUrl = firstImageUrl(result);
    if (imageUrl) return result;
    if (result.status === "failed") {
      throw new Error(
        result.error || initialError || copy("Generation failed", "生成失败")
      );
    }
    if (result.error) {
      lastError = result.error;
    }
  }

  throw new Error(
    lastError ||
      copy(
        "Generation is still running. Check the gallery later.",
        "生成仍在进行中，请稍后到图库查看。"
      )
  );
}

/**
 * 将首次生成响应解析为最终可渲染结果。
 *
 * @param result 首次生成响应。
 * @param copy 当前语言文本函数。
 * @returns 带图片地址的最终结果。
 * @sideEffects 必要时轮询状态接口。
 */
async function resolveGenerationResult(
  result: GenerationResult,
  copy: (en: string, zh: string) => string
) {
  if (firstImageUrl(result)) return result;
  if (!result.generationId) return result;
  return await pollGenerationResult(result.generationId, result.error, copy);
}

/**
 * 延迟指定毫秒数。
 *
 * @param ms 延迟时间。
 * @returns 延迟 Promise。
 * @sideEffects 设置计时器。
 */
function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
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
