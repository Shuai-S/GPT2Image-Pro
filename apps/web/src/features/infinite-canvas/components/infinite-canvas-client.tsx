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
  Repeat2,
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
import {
  addCanvasEdge,
  addCanvasNode,
  type CanvasNode,
  type CanvasNodeKind,
  type CanvasState,
  type CanvasViewport,
  clampCanvasZoom,
  createCanvasNode,
  createEmptyCanvasState,
  fitViewportToNodes,
  getInputNodesForNode,
  moveCanvasNode,
  parseCanvasState,
  removeCanvasEdge,
  removeCanvasNodes,
  screenPointToWorld,
  serializeCanvasState,
  updateCanvasNode,
} from "@/features/infinite-canvas/canvas-state";
import {
  type ConnectorSide,
  type ImagePreviewState,
  buildCanvasLoopPromptPlan,
  createCanvasGenerationId,
  downloadCanvasImage,
  getCanvasImageDownloadName,
  isCanvasPromptLikeNode,
  readFileAsDataUrl,
  triggerImageDownload,
} from "@/features/infinite-canvas/components/canvas-helpers";
import {
  createCanvasOutputNodes,
  countFailedGenerationResults,
  firstGenerationResultError,
  runCanvasGenerationPlan,
} from "@/features/infinite-canvas/components/canvas-generators";
import {
  CanvasEdgePath,
  CanvasNodeView,
  ImagePreviewDialog,
  ToolbarButton,
  buildMinimap,
} from "@/features/infinite-canvas/components/canvas-ui";

/**
 * 无限画布主交互组件。
 *
 * 使用方：/dashboard/canvas 页面。
 * 关键依赖：画布纯函数、现有图片生成 API、localStorage 本地持久化。
 */

const STORAGE_KEY = "gpt2image.infinite-canvas.v1";
const STORAGE_WRITE_DEBOUNCE_MS = 300;
const DEFAULT_NODE_POSITION = { x: 80, y: 80 };

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
  // 高频指针/滚轮事件节流:仅保留最近一帧待处理事件,由 rAF 合并写入一次 state。
  const pendingPointerEventRef =
    useRef<ReactPointerEvent<HTMLDivElement> | null>(null);
  const pointerRafIdRef = useRef<number | null>(null);
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

  /**
   * 挂载时一次性从 localStorage 读取已持久化的画布草稿。
   *
   * WHY：把读取收敛到挂载单次执行,避免在后续 effect 链里反复读取本地存储。
   * copy 经 useCallback 稳定,语言切换不会触发重复加载。
   */
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
    // copy 经 useCallback 稳定,语言变化不会重复触发草稿加载;依赖数组保持 [copy] 即可。
  }, [copy]);

  /**
   * 持久化画布状态到 localStorage。
   *
   * WHY：拖拽/缩放会高频更新 state,直接同步写盘会阻塞主线程。
   * 这里用 300ms 节流延时:连续变化只在最后一次变更后写一次。
   */
  useEffect(() => {
    if (!isBooted) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, serializeCanvasState(state));
    }, STORAGE_WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [isBooted, state]);

  // 组件卸载时取消未执行的指针/滚轮节流帧,避免 setState 作用在已卸载组件。
  useEffect(() => {
    return () => {
      if (pointerRafIdRef.current !== null) {
        window.cancelAnimationFrame(pointerRafIdRef.current);
        pointerRafIdRef.current = null;
      }
      if (wheelRafIdRef.current !== null) {
        window.cancelAnimationFrame(wheelRafIdRef.current);
        wheelRafIdRef.current = null;
      }
    };
  }, []);

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
   * 处理画布指针移动。
   *
   * WHY：指针移动事件高频触发,直接 setState 会导致每像素一次渲染。
   * 这里把事件暂存到 ref,在下一帧 rAF 里合并执行一次状态更新,
   * 中间事件被丢弃但位移通过 lastWorld 累积保持等价(见 flushPointerFrame)。
   *
   * @param event 指针事件。
   * @sideEffects 调度 rAF,在一帧内合并多次移动为一次写入。
   */
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    pendingPointerEventRef.current = event;
    if (pointerRafIdRef.current !== null) return;
    pointerRafIdRef.current = window.requestAnimationFrame(() => {
      pointerRafIdRef.current = null;
      const pending = pendingPointerEventRef.current;
      pendingPointerEventRef.current = null;
      if (!pending) return;
      flushPointerMove(pending);
    });
  };

  /**
   * 在 rAF 帧内消费一次累积的指针移动事件,真正写入状态。
   *
   * @param event 最近一帧的指针事件。
   * @sideEffects 更新视口或节点位置。
   */
  const flushPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
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
   * 结束画布拖拽,并取消未执行的节流帧。
   *
   * @sideEffects 清理拖拽状态与待 rAF。
   */
  const handlePointerUp = () => {
    dragRef.current = null;
    pendingPointerEventRef.current = null;
    if (pointerRafIdRef.current !== null) {
      window.cancelAnimationFrame(pointerRafIdRef.current);
      pointerRafIdRef.current = null;
    }
  };

  // 滚轮事件节流:仅保留最近一次缩放意图,按帧合并写入。
  const pendingWheelEventRef = useRef<ReactWheelEvent<HTMLDivElement> | null>(
    null
  );
  const wheelRafIdRef = useRef<number | null>(null);

  /**
   * 处理滚轮缩放,缩放中心保持在鼠标位置。
   *
   * WHY：滚轮事件高频触发,直接 setState 会导致每滚动一格一次渲染。
   * 这里把事件暂存到 ref,在下一帧 rAF 里合并执行一次状态更新,
   * 并在事件序列中累积 deltaY 以保持最终缩放比例等价。
   *
   * @param event 滚轮事件。
   * @sideEffects 调度 rAF,在一帧内合并多次缩放为一次写入。
   */
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    pendingWheelEventRef.current = event;
    if (wheelRafIdRef.current !== null) return;
    wheelRafIdRef.current = window.requestAnimationFrame(() => {
      wheelRafIdRef.current = null;
      const pending = pendingWheelEventRef.current;
      pendingWheelEventRef.current = null;
      if (!pending) return;
      flushWheel(pending);
    });
  };

  /**
   * 在 rAF 帧内消费一次累积的滚轮事件,真正写入视口。
   *
   * @param event 最近一帧的滚轮事件。
   * @sideEffects 更新视口。
   */
  const flushWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
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
      .filter((input) => isCanvasPromptLikeNode(input))
      .flatMap((input) => getInputNodesForNode(state, input.id));
    const promptTexts = inputs
      .filter((input) => isCanvasPromptLikeNode(input) && input.prompt?.trim())
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
      forcedNode?.kind === "generator" ||
      forcedNode?.kind === "prompt" ||
      forcedNode?.kind === "loop"
        ? forcedNode
        : undefined;
    const selectedRunnableNode =
      selectedNode?.kind === "generator" ||
      selectedNode?.kind === "prompt" ||
      selectedNode?.kind === "loop"
        ? selectedNode
        : undefined;
    const fallbackRunnableNode = state.nodes.find(
      (item) =>
        item.kind === "generator" ||
        item.kind === "prompt" ||
        item.kind === "loop"
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
    const promptPlan =
      node.kind === "loop" ? buildCanvasLoopPromptPlan(node, prompt) : [prompt];
    if (promptPlan.length > 1) {
      const confirmed = window.confirm(
        copy(
          `This will submit ${promptPlan.length} image generations and consume credits for each result. Continue?`,
          `本次会提交 ${promptPlan.length} 张图片生成，并按每张结果消耗积分。是否继续？`
        )
      );
      if (!confirmed) return;
    }

    setRunningNodeId(node.id);
    patchState((current) =>
      updateCanvasNode(current, node.id, {
        status: "running",
        error: undefined,
      })
    );
    const generationIds = promptPlan.map(() => createCanvasGenerationId());
    try {
      const results = await runCanvasGenerationPlan({
        prompts: promptPlan,
        node,
        imageNodes,
        generationIds,
        copy,
      });
      const outputNodes = createCanvasOutputNodes({
        sourceNode: node,
        prompts: promptPlan,
        results,
        copy,
        createNode: createCanvasNode,
      });
      const failedCount = countFailedGenerationResults(results);
      if (outputNodes.length === 0) {
        throw new Error(
          firstGenerationResultError(results) ||
            copy("No image returned", "未返回图片")
        );
      }
      patchState((current) => {
        let next = current;
        for (const outputNode of outputNodes) {
          next = addCanvasEdge(
            addCanvasNode(next, outputNode),
            node.id,
            outputNode.id
          );
        }
        return next;
      });
      const partialMessage =
        failedCount > 0
          ? copy(
              `${outputNodes.length} image(s) generated, ${failedCount} still failed or timed out.`,
              `已生成 ${outputNodes.length} 张，${failedCount} 张失败或等待超时。`
            )
          : undefined;
      patchState((current) =>
        updateCanvasNode(current, node.id, {
          status: "idle",
          error: partialMessage,
        })
      );
      setSelectedIds(outputNodes.map((outputNode) => outputNode.id));
      setSelectedEdgeIds([]);
      if (partialMessage) {
        toast.warning(copy("Partial results generated", "已生成部分结果"), {
          description: partialMessage,
        });
      } else {
        toast.success(
          outputNodes.length > 1
            ? copy("Images generated", "图片已批量生成")
            : copy("Image generated", "图片已生成")
        );
      }
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
            label={copy("Loop", "循环")}
            onClick={() =>
              addNode("loop", {
                title: copy("Loop", "循环"),
                prompt: "",
                loopCount: 4,
                loopItems: "",
              })
            }
          >
            <Repeat2 className="h-4 w-4" />
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
