"use client";

// 无限画布单一交互原型。编排创作节点、图片节点、批次生成、连接与视口状态。

import {
  Hand,
  LocateFixed,
  MoreHorizontal,
  MousePointer2,
  Plus,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArtworkFocus,
  type ArtworkFocusRect,
  getArtworkFocusOrigin,
} from "./artwork-focus";
import styles from "./canvas-preview.module.css";
import {
  CreatorNodeView,
  getCreatorIssues,
  ImageNodeView,
  sortMentionSuggestions,
} from "./canvas-preview-nodes";
import {
  CanvasAddPanel,
  CanvasGalleryPanel,
  CanvasImageEditor,
  CanvasMorePanel,
  ClearCanvasDialog,
  ExpandedPromptPanel,
} from "./canvas-preview-panels";
import {
  type CanvasPoint,
  type CanvasPreviewEdge,
  type CanvasPreviewNode,
  type CanvasViewport,
  type ConnectionDraft,
  type CreatorNode,
  type CreatorPanel,
  clampPreviewZoom,
  createPreviewCreatorNode,
  createPreviewImageNode,
  findPreviewFreePosition,
  getPreviewNodeBounds,
  getPreviewNodePort,
  getPreviewResultPositions,
  type ImageNode,
} from "./canvas-preview-types";
import { getArtwork } from "./mock-data";

type CanvasTool = "select" | "pan";

type DragState =
  | {
      type: "nodes";
      startPointer: CanvasPoint;
      positions: Array<{ id: string; x: number; y: number }>;
    }
  | {
      type: "pan";
      startPointer: CanvasPoint;
      startViewport: CanvasViewport;
    }
  | {
      type: "selection";
      startPointer: CanvasPoint;
      additive: boolean;
    };

type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type FocusedImage = {
  nodeId: string;
  originRect: ArtworkFocusRect;
};

const RESULT_ARTWORK_IDS = [
  "art-12",
  "art-08",
  "art-05",
  "art-03",
  "art-10",
  "art-02",
] as const;

/**
 * 创建首次进入画布时位于中央的空创作节点。
 */
function createInitialNodes(): CanvasPreviewNode[] {
  return [
    createPreviewCreatorNode({
      id: "creator-initial",
      x: 420,
      y: 210,
    }),
  ];
}

/**
 * 渲染融合两类节点的无限画布交互原型。
 *
 * @returns 可连续完成输入、连接、模拟生成、聚焦与编辑的全屏画布。
 * @sideEffects 使用计时器模拟生成和上传，不触发真实网络、存储或扣费。
 */
export function CanvasPreview() {
  const [nodes, setNodes] = useState<CanvasPreviewNode[]>(createInitialNodes);
  const [edges, setEdges] = useState<CanvasPreviewEdge[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(["creator-initial"]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [viewport, setViewport] = useState<CanvasViewport>({
    x: 0,
    y: 0,
    zoom: 1,
  });
  const [boardSize, setBoardSize] = useState({ width: 1280, height: 720 });
  const [connectionDraft, setConnectionDraft] =
    useState<ConnectionDraft | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [activeCreatorPanel, setActiveCreatorPanel] = useState<{
    nodeId: string;
    panel: Exclude<CreatorPanel, null>;
  } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);
  const [editorImageId, setEditorImageId] = useState<string | null>(null);
  const [editorReturnFocus, setEditorReturnFocus] =
    useState<FocusedImage | null>(null);
  const [focusedImage, setFocusedImage] = useState<FocusedImage | null>(null);
  const boardRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const spacePressedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const nodeMap = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes]
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const imageNodes = useMemo(
    () => nodes.filter((node): node is ImageNode => node.kind === "image"),
    [nodes]
  );
  const creatorNodes = useMemo(
    () => nodes.filter((node): node is CreatorNode => node.kind === "creator"),
    [nodes]
  );
  const focusedImageNode = focusedImage
    ? (imageNodes.find((node) => node.id === focusedImage.nodeId) ?? null)
    : null;
  const editorImageNode = editorImageId
    ? (imageNodes.find((node) => node.id === editorImageId) ?? null)
    : null;
  const expandedCreator = expandedPromptId
    ? (creatorNodes.find((node) => node.id === expandedPromptId) ?? null)
    : null;

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setBoardSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(board);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
    },
    []
  );

  /**
   * 把屏幕客户区坐标换算为当前视口的世界坐标。
   */
  const screenToWorld = (point: CanvasPoint) => {
    const rect = boardRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return {
      x: (point.x - left - viewport.x) / viewport.zoom,
      y: (point.y - top - viewport.y) / viewport.zoom,
    };
  };

  /**
   * 返回视口中心对应的世界坐标。
   */
  const getViewportCenter = () => ({
    x: (boardSize.width / 2 - viewport.x) / viewport.zoom,
    y: (boardSize.height / 2 - viewport.y) / viewport.zoom,
  });

  /**
   * 更新指定创作节点，保留联合类型边界。
   */
  const patchCreator = (nodeId: string, patch: Partial<CreatorNode>) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId && node.kind === "creator"
          ? { ...node, ...patch }
          : node
      )
    );
  };

  /**
   * 更新指定图片节点，保留联合类型边界。
   */
  const patchImage = (nodeId: string, patch: Partial<ImageNode>) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId && node.kind === "image"
          ? { ...node, ...patch }
          : node
      )
    );
  };

  /**
   * 读取一个创作节点当前连接的图片输入。
   */
  const getInputImages = (creatorId: string) => {
    const inputIds = new Set(
      edges
        .filter((edge) => edge.kind === "input" && edge.to === creatorId)
        .map((edge) => edge.from)
    );
    return imageNodes.filter((image) => inputIds.has(image.id));
  };

  /**
   * 选择节点并开始拖动单节点或当前多选集合。
   */
  const startNodeDrag = (
    node: CanvasPreviewNode,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (event.button !== 0 || activeTool !== "select") return;
    event.stopPropagation();
    setSelectedEdgeId(null);

    let nextSelection = selectedIds;
    if (event.shiftKey) {
      nextSelection = selectedIdSet.has(node.id)
        ? selectedIds.filter((id) => id !== node.id)
        : [...selectedIds, node.id];
      setSelectedIds(nextSelection);
      if (!nextSelection.includes(node.id)) return;
    } else if (!selectedIdSet.has(node.id)) {
      nextSelection = [node.id];
      setSelectedIds(nextSelection);
    }

    const positions = nodes
      .filter((item) => nextSelection.includes(item.id))
      .map((item) => ({ id: item.id, x: item.x, y: item.y }));
    dragRef.current = {
      type: "nodes",
      startPointer: { x: event.clientX, y: event.clientY },
      positions,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  /**
   * 在画布空白处开始平移或框选。
   */
  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest("[data-canvas-node='true']") ||
        target.closest("button, input, textarea, select, a"))
    ) {
      return;
    }

    const shouldPan =
      event.button === 1 || activeTool === "pan" || spacePressedRef.current;
    if (shouldPan) {
      dragRef.current = {
        type: "pan",
        startPointer: { x: event.clientX, y: event.clientY },
        startViewport: viewport,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;

    const rect = boardRef.current?.getBoundingClientRect();
    const left = event.clientX - (rect?.left ?? 0);
    const top = event.clientY - (rect?.top ?? 0);
    dragRef.current = {
      type: "selection",
      startPointer: { x: event.clientX, y: event.clientY },
      additive: event.shiftKey,
    };
    setSelectionBox({ left, top, width: 0, height: 0 });
    if (!event.shiftKey) setSelectedIds([]);
    setSelectedEdgeId(null);
    setActiveCreatorPanel(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  /**
   * 更新节点拖动、视口平移、框选和连接预览。
   */
  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag?.type === "nodes") {
      const deltaX = (event.clientX - drag.startPointer.x) / viewport.zoom;
      const deltaY = (event.clientY - drag.startPointer.y) / viewport.zoom;
      const starts = new Map(drag.positions.map((item) => [item.id, item]));
      setNodes((current) =>
        current.map((node) => {
          const start = starts.get(node.id);
          return start
            ? { ...node, x: start.x + deltaX, y: start.y + deltaY }
            : node;
        })
      );
    } else if (drag?.type === "pan") {
      setViewport((current) => ({
        ...current,
        x: drag.startViewport.x + event.clientX - drag.startPointer.x,
        y: drag.startViewport.y + event.clientY - drag.startPointer.y,
      }));
    } else if (drag?.type === "selection") {
      const rect = boardRef.current?.getBoundingClientRect();
      const startX = drag.startPointer.x - (rect?.left ?? 0);
      const startY = drag.startPointer.y - (rect?.top ?? 0);
      const currentX = event.clientX - (rect?.left ?? 0);
      const currentY = event.clientY - (rect?.top ?? 0);
      setSelectionBox({
        left: Math.min(startX, currentX),
        top: Math.min(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
      });
    }

    if (connectionDraft) {
      setConnectionDraft((current) =>
        current
          ? {
              ...current,
              point: screenToWorld({ x: event.clientX, y: event.clientY }),
            }
          : null
      );
    }
  };

  /**
   * 结束当前拖动；连接释放在空白处时创建新的图生图创作节点。
   */
  const handleCanvasPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag?.type === "selection" && selectionBox) {
      const topLeft = screenToWorld({
        x:
          selectionBox.left +
          (boardRef.current?.getBoundingClientRect().left ?? 0),
        y:
          selectionBox.top +
          (boardRef.current?.getBoundingClientRect().top ?? 0),
      });
      const bottomRight = screenToWorld({
        x:
          selectionBox.left +
          selectionBox.width +
          (boardRef.current?.getBoundingClientRect().left ?? 0),
        y:
          selectionBox.top +
          selectionBox.height +
          (boardRef.current?.getBoundingClientRect().top ?? 0),
      });
      const inside = nodes
        .filter(
          (node) =>
            node.x < bottomRight.x &&
            node.x + node.width > topLeft.x &&
            node.y < bottomRight.y &&
            node.y + node.height > topLeft.y
        )
        .map((node) => node.id);
      setSelectedIds((current) =>
        drag.additive ? Array.from(new Set([...current, ...inside])) : inside
      );
    }
    dragRef.current = null;
    setSelectionBox(null);

    if (connectionDraft) {
      const source = nodeMap.get(connectionDraft.sourceId);
      if (source?.kind === "image") {
        const point = screenToWorld({ x: event.clientX, y: event.clientY });
        createCreatorFromImage(source, point);
      }
      setConnectionDraft(null);
    }
  };

  /**
   * 使用触控板滚动平移，并以指针为中心执行捏合或修饰键缩放。
   */
  const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const rect = boardRef.current?.getBoundingClientRect();
      const localX = event.clientX - (rect?.left ?? 0);
      const localY = event.clientY - (rect?.top ?? 0);
      setViewport((current) => {
        const nextZoom = clampPreviewZoom(
          current.zoom * Math.exp(-event.deltaY * 0.0025)
        );
        const worldX = (localX - current.x) / current.zoom;
        const worldY = (localY - current.y) / current.zoom;
        return {
          x: localX - worldX * nextZoom,
          y: localY - worldY * nextZoom,
          zoom: nextZoom,
        };
      });
      return;
    }
    setViewport((current) => ({
      ...current,
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }));
  };

  /**
   * 从图片节点开始连接预览。
   */
  const startConnection = (
    imageNode: ImageNode,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    setConnectionDraft({
      sourceId: imageNode.id,
      point: getPreviewNodePort(imageNode, "output"),
    });
  };

  /**
   * 在创作节点输入端释放时建立图片输入连接。
   */
  const finishConnection = (
    creator: CreatorNode,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    const sourceId = connectionDraft?.sourceId;
    const source = sourceId ? nodeMap.get(sourceId) : null;
    if (!sourceId || source?.kind !== "image") return;
    const inputs = getInputImages(creator.id);
    if (source.hasMask && inputs.some((image) => image.hasMask)) {
      setConnectionDraft(null);
      return;
    }
    connectImageToCreator(sourceId, creator.id);
    setConnectionDraft(null);
  };

  /**
   * 幂等建立图片到创作节点的输入边。
   */
  const connectImageToCreator = (imageId: string, creatorId: string) => {
    setEdges((current) => {
      const exists = current.some(
        (edge) =>
          edge.kind === "input" &&
          edge.from === imageId &&
          edge.to === creatorId
      );
      return exists
        ? current
        : [
            ...current,
            {
              id: `input-${imageId}-${creatorId}`,
              from: imageId,
              to: creatorId,
              kind: "input",
            },
          ];
    });
  };

  /**
   * 在指定位置创建使用当前图片的新创作节点。
   */
  const createCreatorFromImage = (
    imageNode: ImageNode,
    point?: CanvasPoint
  ) => {
    const artwork = getArtwork(imageNode.artworkId);
    const ratio = artwork.width / artwork.height;
    const resolution =
      ratio > 1.2 ? "1024 × 688" : ratio < 0.82 ? "688 × 1024" : "1024 × 1024";
    const id = `creator-${Date.now()}`;
    const preferred = point ?? {
      x: imageNode.x + imageNode.width + 150,
      y: imageNode.y,
    };
    const freePosition = findPreviewFreePosition(nodes, preferred, {
      width: 340,
      height: 250,
    });
    const creator = createPreviewCreatorNode({
      id,
      x: freePosition.x,
      y: freePosition.y,
      modelName: imageNode.modelSnapshot ?? "GPT Image 2",
      ratio: ratio > 1.2 ? "3:2" : ratio < 0.82 ? "2:3" : "1:1",
      resolution,
    });
    setNodes((current) => [...current, creator]);
    setEdges((current) => [
      ...current,
      {
        id: `input-${imageNode.id}-${id}`,
        from: imageNode.id,
        to: id,
        kind: "input",
      },
    ]);
    setSelectedIds([id]);
    setActiveCreatorPanel(null);
  };

  /**
   * 模拟运行创作节点，立即创建独立骨架并逐张完成。
   */
  const runCreator = (creator: CreatorNode, count: number) => {
    const issues = getCreatorIssues(creator, getInputImages(creator.id));
    if (issues.length > 0 || creator.runningBatchId) return;
    const batchId = `batch-${Date.now()}`;
    const positions = getPreviewResultPositions(creator, count, nodes);
    const sequenceStart = creator.outputSequence;
    const imageNodesForBatch = positions.map((position, index) => {
      const artworkId =
        RESULT_ARTWORK_IDS[
          (sequenceStart + index) % RESULT_ARTWORK_IDS.length
        ] ?? "art-12";
      return createPreviewImageNode({
        id: `${batchId}-image-${index + 1}`,
        artworkId,
        x: position.x,
        y: position.y,
        title: `${creator.title} ${String(sequenceStart + index + 1).padStart(2, "0")}`,
        source: "generated",
        status: "queued",
        batchId,
        creatorId: creator.id,
        promptSnapshot: creator.prompt,
        modelSnapshot: creator.modelName,
        generatedAt: "刚刚",
      });
    });
    const outputEdges = imageNodesForBatch.map((imageNode) => ({
      id: `output-${creator.id}-${imageNode.id}`,
      from: creator.id,
      to: imageNode.id,
      kind: "output" as const,
      batchId,
    }));

    setNodes((current) => [...current, ...imageNodesForBatch]);
    setEdges((current) => [...current, ...outputEdges]);
    patchCreator(creator.id, {
      count,
      runningBatchId: batchId,
      completedCount: 0,
      outputSequence: sequenceStart + count,
    });
    revealNewResults(imageNodesForBatch);

    imageNodesForBatch.forEach((imageNode, index) => {
      timersRef.current.push(
        window.setTimeout(
          () => patchImage(imageNode.id, { status: "generating" }),
          180 + index * 90
        )
      );
      timersRef.current.push(
        window.setTimeout(
          () => {
            patchImage(imageNode.id, { status: "ready" });
            patchCreator(creator.id, { completedCount: index + 1 });
            if (index === imageNodesForBatch.length - 1) {
              patchCreator(creator.id, {
                runningBatchId: undefined,
                completedCount: count,
              });
            }
          },
          850 + index * 360
        )
      );
    });
  };

  /**
   * 仅在新结果超出视口时执行最小距离平移。
   */
  const revealNewResults = (newNodes: ImageNode[]) => {
    const bounds = getPreviewNodeBounds(newNodes);
    if (!bounds) return;
    const margin = 96;
    const screenRight = bounds.maxX * viewport.zoom + viewport.x;
    const screenBottom = bounds.maxY * viewport.zoom + viewport.y;
    const deltaX = Math.min(0, boardSize.width - margin - screenRight);
    const deltaY = Math.min(0, boardSize.height - margin - screenBottom);
    if (deltaX !== 0 || deltaY !== 0) {
      setViewport((current) => ({
        ...current,
        x: current.x + deltaX,
        y: current.y + deltaY,
      }));
    }
  };

  /**
   * 模拟上传一个素材节点，并在完成后保持原位置。
   */
  const addMockUpload = () => {
    const center = getViewportCenter();
    const draftNode = createPreviewImageNode({
      id: `upload-${Date.now()}`,
      artworkId: "art-09",
      x: 0,
      y: 0,
      title: "材质参考.jpg",
      source: "uploaded",
      status: "uploading",
    });
    const position = findPreviewFreePosition(
      nodes,
      {
        x: center.x - draftNode.width / 2,
        y: center.y - draftNode.height / 2,
      },
      draftNode
    );
    const imageNode = { ...draftNode, ...position };
    setNodes((current) => [...current, imageNode]);
    setSelectedIds([imageNode.id]);
    setAddOpen(false);
    timersRef.current.push(
      window.setTimeout(
        () => patchImage(imageNode.id, { status: "ready" }),
        900
      )
    );
  };

  /**
   * 把图库选择结果加入当前视口附近且不移动已有节点。
   */
  const addGalleryImages = (
    artworkIds: string[],
    source: ImageNode["source"]
  ) => {
    const center = getViewportCenter();
    const added: ImageNode[] = [];
    for (const [index, artworkId] of artworkIds.entries()) {
      const draftNode = createPreviewImageNode({
        id: `gallery-${artworkId}-${Date.now()}-${index}`,
        artworkId,
        x: 0,
        y: 0,
        source,
      });
      const position = findPreviewFreePosition(
        nodes.concat(added),
        {
          x: center.x - draftNode.width / 2,
          y: center.y - draftNode.height / 2,
        },
        draftNode
      );
      added.push({ ...draftNode, ...position });
    }
    setNodes((current) => [...current, ...added]);
    setSelectedIds(added.map((node) => node.id));
    setGalleryOpen(false);
  };

  /**
   * 打开统一作品聚焦组件并记录图片真实可见区域。
   */
  const focusImage = (imageNode: ImageNode, element: HTMLElement) => {
    const artwork = getArtwork(imageNode.artworkId);
    setFocusedImage({
      nodeId: imageNode.id,
      originRect: getArtworkFocusOrigin(element, artwork.width, artwork.height),
    });
  };

  /**
   * 删除当前节点选区或选中的输入连线。
   */
  const deleteSelection = () => {
    if (selectedEdgeId) {
      setEdges((current) =>
        current.filter((edge) => edge.id !== selectedEdgeId)
      );
      setSelectedEdgeId(null);
      return;
    }
    if (selectedIds.length === 0) return;
    const deleted = new Set(selectedIds);
    setNodes((current) => current.filter((node) => !deleted.has(node.id)));
    setEdges((current) =>
      current.filter((edge) => !deleted.has(edge.from) && !deleted.has(edge.to))
    );
    setSelectedIds([]);
  };

  /**
   * 复制唯一选中节点；创作节点继承输入，图片节点不复制连接。
   */
  const duplicateSingleSelection = () => {
    if (selectedIds.length !== 1) return;
    const selectedId = selectedIds[0];
    if (!selectedId) return;
    const source = nodeMap.get(selectedId);
    if (!source) return;
    const id = `${source.kind}-copy-${Date.now()}`;
    if (source.kind === "creator") {
      const duplicate: CreatorNode = {
        ...source,
        id,
        title: `${source.title} 副本`,
        x: source.x + 38,
        y: source.y + 38,
        outputSequence: 0,
        runningBatchId: undefined,
        completedCount: 0,
      };
      const copiedInputs = edges
        .filter((edge) => edge.kind === "input" && edge.to === source.id)
        .map((edge) => ({
          ...edge,
          id: `input-${edge.from}-${id}`,
          to: id,
        }));
      setNodes((current) => [...current, duplicate]);
      setEdges((current) => [...current, ...copiedInputs]);
    } else {
      const duplicate: ImageNode = {
        ...source,
        id,
        title: `${source.title} 副本`,
        x: source.x + 38,
        y: source.y + 38,
        batchId: undefined,
        creatorId: undefined,
      };
      setNodes((current) => [...current, duplicate]);
    }
    setSelectedIds([id]);
  };

  useEffect(() => {
    /** 处理画布管理快捷键，不抢占文字编辑输入。 */
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (event.code === "Space" && !editing) {
        spacePressedRef.current = true;
        event.preventDefault();
      }
      if (editing) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSingleSelection();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePressedRef.current = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  });

  /**
   * 适应当前选区；没有选区时适应全部节点。
   */
  const fitView = () => {
    const targets =
      selectedIds.length > 0
        ? nodes.filter((node) => selectedIdSet.has(node.id))
        : nodes;
    const bounds = getPreviewNodeBounds(targets);
    if (!bounds) return;
    const marginX = 220;
    const marginY = 160;
    const zoom = clampPreviewZoom(
      Math.min(
        (boardSize.width - marginX) / Math.max(bounds.width, 1),
        (boardSize.height - marginY) / Math.max(bounds.height, 1)
      )
    );
    setViewport({
      zoom,
      x: boardSize.width / 2 - (bounds.minX + bounds.width / 2) * zoom,
      y: boardSize.height / 2 - (bounds.minY + bounds.height / 2) * zoom,
    });
  };

  /**
   * 清空唯一画布并在当前视口中央恢复一个空创作节点。
   */
  const clearCanvas = () => {
    const center = getViewportCenter();
    const creator = createPreviewCreatorNode({
      id: `creator-${Date.now()}`,
      x: center.x - 170,
      y: center.y - 125,
    });
    setNodes([creator]);
    setEdges([]);
    setSelectedIds([creator.id]);
    setSelectedEdgeId(null);
    setClearOpen(false);
    setMoreOpen(false);
  };

  const outputBatches = useMemo(() => {
    const grouped = new Map<string, CanvasPreviewEdge[]>();
    for (const edge of edges) {
      if (edge.kind !== "output" || !edge.batchId) continue;
      const current = grouped.get(edge.batchId) ?? [];
      current.push(edge);
      grouped.set(edge.batchId, current);
    }
    return grouped;
  }, [edges]);

  return (
    <main
      ref={boardRef}
      className={styles.canvas}
      data-tool={activeTool}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      onPointerCancel={() => {
        dragRef.current = null;
        setSelectionBox(null);
        setConnectionDraft(null);
      }}
      onWheel={handleWheel}
    >
      <div
        className={styles.world}
        style={{
          transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
        }}
      >
        <svg className={styles.edgeLayer} aria-hidden="true">
          {edges
            .filter((edge) => edge.kind === "input")
            .map((edge) => {
              const from = nodeMap.get(edge.from);
              const to = nodeMap.get(edge.to);
              if (!from || !to) return null;
              return (
                <InputEdge
                  key={edge.id}
                  from={from}
                  to={to}
                  selected={edge.id === selectedEdgeId}
                  onSelect={() => {
                    setSelectedEdgeId(edge.id);
                    setSelectedIds([]);
                  }}
                  onDelete={() =>
                    setEdges((current) =>
                      current.filter((item) => item.id !== edge.id)
                    )
                  }
                />
              );
            })}
          {Array.from(outputBatches.entries()).map(([batchId, batchEdges]) => (
            <BatchEdge key={batchId} edges={batchEdges} nodeMap={nodeMap} />
          ))}
          {connectionDraft &&
            (() => {
              const source = nodeMap.get(connectionDraft.sourceId);
              if (!source) return null;
              const start = getPreviewNodePort(source, "output");
              const curve = Math.max(
                80,
                Math.abs(connectionDraft.point.x - start.x) * 0.45
              );
              return (
                <path
                  className={styles.connectionDraft}
                  d={`M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${connectionDraft.point.x - curve} ${connectionDraft.point.y}, ${connectionDraft.point.x} ${connectionDraft.point.y}`}
                />
              );
            })()}
        </svg>

        {nodes.map((node) => {
          if (node.kind === "creator") {
            const inputs = getInputImages(node.id);
            const connectedIds = new Set(inputs.map((image) => image.id));
            const panel =
              activeCreatorPanel?.nodeId === node.id
                ? activeCreatorPanel.panel
                : null;
            return (
              <CreatorNodeView
                key={node.id}
                node={node}
                selected={selectedIdSet.has(node.id)}
                connecting={Boolean(connectionDraft)}
                inputImages={inputs}
                mentionSuggestions={sortMentionSuggestions(
                  node,
                  imageNodes,
                  connectedIds
                )}
                activePanel={panel}
                issues={getCreatorIssues(node, inputs)}
                onPatch={(patch) => patchCreator(node.id, patch)}
                onPointerDown={(event) => startNodeDrag(node, event)}
                onConnectionFinish={(event) => finishConnection(node, event)}
                onPanelChange={(nextPanel) =>
                  setActiveCreatorPanel(
                    nextPanel ? { nodeId: node.id, panel: nextPanel } : null
                  )
                }
                onMentionImage={(imageId) => {
                  connectImageToCreator(imageId, node.id);
                  patchCreator(node.id, {
                    references: Array.from(
                      new Set([...node.references, imageId])
                    ),
                  });
                }}
                onLocateImage={(imageId) => {
                  const imageNode = nodeMap.get(imageId);
                  if (!imageNode) return;
                  setSelectedIds([imageId]);
                  setViewport((current) => ({
                    ...current,
                    x:
                      boardSize.width / 2 -
                      (imageNode.x + imageNode.width / 2) * current.zoom,
                    y:
                      boardSize.height / 2 -
                      (imageNode.y + imageNode.height / 2) * current.zoom,
                  }));
                }}
                onExpandPrompt={() => setExpandedPromptId(node.id)}
                onRun={(count) => runCreator(node, count)}
              />
            );
          }
          return (
            <ImageNodeView
              key={node.id}
              node={node}
              selected={selectedIdSet.has(node.id)}
              connecting={Boolean(connectionDraft)}
              onPatch={(patch) => patchImage(node.id, patch)}
              onPointerDown={(event) => startNodeDrag(node, event)}
              onConnectionStart={(event) => startConnection(node, event)}
              onFocus={(element) => focusImage(node, element)}
              onContinue={() => createCreatorFromImage(node)}
              onEdit={() => {
                setEditorReturnFocus(null);
                setEditorImageId(node.id);
              }}
              onRestore={() =>
                patchImage(node.id, {
                  edited: false,
                  hasMask: false,
                  maskDataUrl: undefined,
                })
              }
              onRetry={() => {
                patchImage(node.id, { status: "generating", error: undefined });
                timersRef.current.push(
                  window.setTimeout(
                    () => patchImage(node.id, { status: "ready" }),
                    900
                  )
                );
              }}
            />
          );
        })}
      </div>

      {selectionBox && (
        <span className={styles.selectionBox} style={selectionBox} />
      )}

      <div className={styles.canvasDock}>
        <button
          type="button"
          data-active={activeTool === "select"}
          onClick={() => setActiveTool("select")}
        >
          <MousePointer2 size={14} aria-hidden="true" />
          选择
        </button>
        <button
          type="button"
          data-active={activeTool === "pan"}
          onClick={() => setActiveTool("pan")}
        >
          <Hand size={14} aria-hidden="true" />
          平移
        </button>
        <span className={styles.dockDivider} />
        <div className={styles.dockGroup}>
          <button
            type="button"
            data-active={addOpen}
            onClick={() => {
              setAddOpen((current) => !current);
              setMoreOpen(false);
            }}
          >
            <Plus size={14} aria-hidden="true" />
            添加
          </button>
          {addOpen && (
            <CanvasAddPanel
              onAddCreator={() => {
                const center = getViewportCenter();
                const position = findPreviewFreePosition(
                  nodes,
                  { x: center.x - 170, y: center.y - 125 },
                  { width: 340, height: 250 }
                );
                const creator = createPreviewCreatorNode({
                  id: `creator-${Date.now()}`,
                  x: position.x,
                  y: position.y,
                });
                setNodes((current) => [...current, creator]);
                setSelectedIds([creator.id]);
                setAddOpen(false);
              }}
              onMockUpload={addMockUpload}
              onOpenGallery={() => {
                setGalleryOpen(true);
                setAddOpen(false);
              }}
            />
          )}
        </div>
        <div className={styles.dockGroup}>
          <button
            type="button"
            data-active={moreOpen}
            aria-label="更多画布命令"
            title="更多"
            onClick={() => {
              setMoreOpen((current) => !current);
              setAddOpen(false);
            }}
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </button>
          {moreOpen && <CanvasMorePanel onClear={() => setClearOpen(true)} />}
        </div>
      </div>

      <CanvasMinimap
        nodes={nodes}
        selectedIds={selectedIdSet}
        viewport={viewport}
        boardSize={boardSize}
        onNavigate={(point) =>
          setViewport((current) => ({
            ...current,
            x: boardSize.width / 2 - point.x * current.zoom,
            y: boardSize.height / 2 - point.y * current.zoom,
          }))
        }
      />
      <div className={styles.viewDock}>
        <button type="button" title="当前缩放">
          {Math.round(viewport.zoom * 100)}%
        </button>
        <button type="button" title="适应视图" onClick={fitView}>
          <LocateFixed size={14} aria-hidden="true" />
          适应
        </button>
      </div>

      {galleryOpen && (
        <CanvasGalleryPanel
          onClose={() => setGalleryOpen(false)}
          onAdd={addGalleryImages}
        />
      )}
      {expandedCreator && (
        <ExpandedPromptPanel
          title={expandedCreator.title}
          prompt={expandedCreator.prompt}
          onChange={(prompt) => patchCreator(expandedCreator.id, { prompt })}
          onClose={() => setExpandedPromptId(null)}
        />
      )}
      {clearOpen && (
        <ClearCanvasDialog
          onCancel={() => setClearOpen(false)}
          onConfirm={clearCanvas}
        />
      )}
      {focusedImageNode && focusedImage && (
        <ArtworkFocus
          artworkId={focusedImageNode.artworkId}
          originRect={focusedImage.originRect}
          prompt={focusedImageNode.promptSnapshot ?? "私人图片素材"}
          modelName={focusedImageNode.modelSnapshot ?? "图片素材"}
          generatedAt={focusedImageNode.generatedAt ?? "已加入画布"}
          referenceLabel="继续创作"
          inpaintLabel="图片编辑"
          onClose={() => setFocusedImage(null)}
          onUseAsReference={() => {
            createCreatorFromImage(focusedImageNode);
            setFocusedImage(null);
          }}
          onInpaint={() => {
            setEditorReturnFocus(focusedImage);
            setEditorImageId(focusedImageNode.id);
            setFocusedImage(null);
          }}
        />
      )}
      {editorImageNode && (
        <CanvasImageEditor
          imageNode={editorImageNode}
          onCancel={() => {
            setEditorImageId(null);
            setFocusedImage(editorReturnFocus);
            setEditorReturnFocus(null);
          }}
          onComplete={({ hasMask, maskDataUrl }) => {
            patchImage(editorImageNode.id, {
              edited: true,
              hasMask,
              maskDataUrl,
            });
            setEditorImageId(null);
            setFocusedImage(null);
            setEditorReturnFocus(null);
          }}
        />
      )}
    </main>
  );
}

/**
 * 渲染可选择和删除的单条图片输入连线。
 */
function InputEdge({
  from,
  to,
  selected,
  onSelect,
  onDelete,
}: {
  from: CanvasPreviewNode;
  to: CanvasPreviewNode;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const start = getPreviewNodePort(from, "output");
  const end = getPreviewNodePort(to, "input");
  const curve = Math.max(90, Math.abs(end.x - start.x) * 0.45);
  const path = `M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`;
  return (
    <g className={styles.edgeGroup} data-selected={selected}>
      <path className={styles.edgeVisible} d={path} />
      <path
        className={styles.edgeHitArea}
        d={path}
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      />
      <foreignObject x={end.x - 38} y={end.y - 13} width="26" height="26">
        <button
          type="button"
          className={styles.edgeDeleteButton}
          aria-label="断开图片输入"
          title="断开连接"
          onClick={onDelete}
        >
          ×
        </button>
      </foreignObject>
    </g>
  );
}

/**
 * 渲染一次生成批次共享主干和多条结果支线。
 */
function BatchEdge({
  edges,
  nodeMap,
}: {
  edges: CanvasPreviewEdge[];
  nodeMap: Map<string, CanvasPreviewNode>;
}) {
  const creator = edges[0] ? nodeMap.get(edges[0].from) : null;
  if (!creator) return null;
  const start = getPreviewNodePort(creator, "output");
  const targets = edges
    .map((edge) => nodeMap.get(edge.to))
    .filter((node): node is CanvasPreviewNode => Boolean(node));
  if (targets.length === 0) return null;
  const firstTargetX = Math.min(...targets.map((node) => node.x));
  const junctionX = Math.min(firstTargetX - 52, start.x + 108);
  const junctionY =
    targets.reduce(
      (total, node) => total + getPreviewNodePort(node, "input").y,
      0
    ) / targets.length;
  return (
    <g className={styles.batchEdgeGroup}>
      <path
        d={`M ${start.x} ${start.y} C ${start.x + 54} ${start.y}, ${junctionX - 30} ${junctionY}, ${junctionX} ${junctionY}`}
      />
      {targets.map((target) => {
        const end = getPreviewNodePort(target, "input");
        const curve = Math.max(48, (end.x - junctionX) * 0.42);
        return (
          <path
            key={target.id}
            d={`M ${junctionX} ${junctionY} C ${junctionX + curve} ${junctionY}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`}
          />
        );
      })}
      <circle cx={junctionX} cy={junctionY} r="4" />
    </g>
  );
}

/**
 * 渲染可单击定位的只读节点总览。
 */
function CanvasMinimap({
  nodes,
  selectedIds,
  viewport,
  boardSize,
  onNavigate,
}: {
  nodes: CanvasPreviewNode[];
  selectedIds: Set<string>;
  viewport: CanvasViewport;
  boardSize: { width: number; height: number };
  onNavigate: (point: CanvasPoint) => void;
}) {
  const bounds = getPreviewNodeBounds(nodes) ?? {
    minX: 0,
    minY: 0,
    width: 1,
    height: 1,
  };
  const padding = 12;
  const width = 168;
  const height = 112;
  const mapWidth = Math.max(bounds.width, 900);
  const mapHeight = Math.max(bounds.height, 620);
  const mapMinX = bounds.minX - (mapWidth - bounds.width) / 2;
  const mapMinY = bounds.minY - (mapHeight - bounds.height) / 2;
  const scale = Math.min(
    (width - padding * 2) / mapWidth,
    (height - padding * 2) / mapHeight
  );
  const mapPoint = (point: CanvasPoint) => ({
    x: padding + (point.x - mapMinX) * scale,
    y: padding + (point.y - mapMinY) * scale,
  });
  const viewportOrigin = mapPoint({
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
  });

  return (
    <button
      type="button"
      className={styles.minimap}
      aria-label="无限画布小地图"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onNavigate({
          x: mapMinX + (event.clientX - rect.left - padding) / scale,
          y: mapMinY + (event.clientY - rect.top - padding) / scale,
        });
      }}
    >
      <span className={styles.minimapLabel}>Overview</span>
      {nodes.map((node) => {
        const point = mapPoint(node);
        return (
          <span
            className={styles.minimapNode}
            data-kind={node.kind}
            data-selected={selectedIds.has(node.id)}
            key={node.id}
            style={{
              left: point.x,
              top: point.y,
              width: Math.max(8, node.width * scale),
              height: Math.max(5, node.height * scale),
            }}
          />
        );
      })}
      <span
        className={styles.minimapViewport}
        style={{
          left: viewportOrigin.x,
          top: viewportOrigin.y,
          width: (boardSize.width / viewport.zoom) * scale,
          height: (boardSize.height / viewport.zoom) * scale,
        }}
      />
    </button>
  );
}
