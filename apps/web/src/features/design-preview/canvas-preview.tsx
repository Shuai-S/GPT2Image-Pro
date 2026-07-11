"use client";

// 无限画布交互原型。模拟节点拖动、端口直连、节点运行、精简工具坞与小地图。

import {
  Download,
  FileUp,
  Hand,
  Image as ImageIcon,
  LocateFixed,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Repeat2,
  Sparkles,
  TextCursorInput,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getArtwork,
  previewEdges,
  previewNodes,
  type PreviewNode,
} from "./mock-data";
import styles from "./design-preview.module.css";

type CanvasTool = "select" | "pan";

type DragState =
  | {
      type: "node";
      nodeId: string;
      startPointer: { x: number; y: number };
      startPosition: { x: number; y: number };
    }
  | {
      type: "pan";
      startPointer: { x: number; y: number };
      startViewport: { x: number; y: number };
    };

/**
 * 渲染无限画布交互原型。
 *
 * @returns 可拖动节点、连接端口、运行节点并观察小地图的全屏画布。
 */
export function CanvasPreview() {
  const [nodes, setNodes] = useState<PreviewNode[]>(previewNodes);
  const [edges, setEdges] = useState<Array<readonly [string, string]>>(
    previewEdges.map((edge) => edge)
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    "node-generator"
  );
  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [connectionPoint, setConnectionPoint] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ x: 0, y: -96, zoom: 0.9 });
  const [addOpen, setAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const nodeMap = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes]
  );

  /**
   * 把屏幕指针坐标转换为当前视口下的画布世界坐标。
   */
  const toWorldPoint = (
    event: ReactPointerEvent<HTMLElement>,
    rect: DOMRect
  ) => ({
    x: (event.clientX - rect.left - viewport.x) / viewport.zoom,
    y: (event.clientY - rect.top - viewport.y) / viewport.zoom,
  });

  /**
   * 开始拖动节点，保留节点起始位置以避免累计误差。
   */
  const startNodeDrag = (
    node: PreviewNode,
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (activeTool !== "select") return;
    event.stopPropagation();
    setSelectedNodeId(node.id);
    dragRef.current = {
      type: "node",
      nodeId: node.id,
      startPointer: { x: event.clientX, y: event.clientY },
      startPosition: { x: node.x, y: node.y },
    };
  };

  /**
   * 在空白区域按下时清除选择或开始平移视口。
   */
  const handleCanvasPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (event.target !== event.currentTarget) return;
    if (activeTool === "pan") {
      dragRef.current = {
        type: "pan",
        startPointer: { x: event.clientX, y: event.clientY },
        startViewport: { x: viewport.x, y: viewport.y },
      };
      return;
    }
    setSelectedNodeId(null);
  };

  /**
   * 更新节点拖动、视口平移或连接预览线。
   */
  const handleCanvasPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const drag = dragRef.current;
    if (drag?.type === "node") {
      const deltaX = (event.clientX - drag.startPointer.x) / viewport.zoom;
      const deltaY = (event.clientY - drag.startPointer.y) / viewport.zoom;
      setNodes((current) =>
        current.map((node) =>
          node.id === drag.nodeId
            ? {
                ...node,
                x: drag.startPosition.x + deltaX,
                y: drag.startPosition.y + deltaY,
              }
            : node
        )
      );
    } else if (drag?.type === "pan") {
      setViewport((current) => ({
        ...current,
        x: drag.startViewport.x + event.clientX - drag.startPointer.x,
        y: drag.startViewport.y + event.clientY - drag.startPointer.y,
      }));
    }

    if (connectFromId) {
      const rect = event.currentTarget.getBoundingClientRect();
      setConnectionPoint(toWorldPoint(event, rect));
    }
  };

  /**
   * 结束拖动，并在未命中端口时取消连接预览。
   */
  const handleCanvasPointerUp = () => {
    dragRef.current = null;
    if (connectFromId) {
      window.setTimeout(() => setConnectFromId(null), 0);
    }
  };

  /**
   * 从输出端口开始直接拖拽连接。
   */
  const startConnection = (
    node: PreviewNode,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    setConnectFromId(node.id);
    setConnectionPoint({ x: node.x + node.width, y: node.y + 72 });
  };

  /**
   * 在输入端口释放时建立连接，重复边保持幂等。
   */
  const finishConnection = (
    targetNode: PreviewNode,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    const sourceId = connectFromId;
    if (!sourceId || sourceId === targetNode.id) return;
    setEdges((current) => {
      const exists = current.some(
        ([from, to]) => from === sourceId && to === targetNode.id
      );
      return exists ? current : [...current, [sourceId, targetNode.id]];
    });
    setConnectFromId(null);
  };

  /**
   * 添加一种现有节点类型到画布中心附近。
   */
  const addNode = (type: PreviewNode["type"]) => {
    const id = `preview-${type}-${nodes.length + 1}`;
    const titles = {
      prompt: "提示词",
      image: "图片",
      generator: "生成",
      output: "输出",
    } satisfies Record<PreviewNode["type"], string>;
    const nextNode: PreviewNode = {
      id,
      type,
      title: titles[type],
      text:
        type === "prompt"
          ? "输入新的创作描述"
          : type === "generator"
            ? "GPT Image 2 · 1 张"
            : undefined,
      imageId: type === "image" || type === "output" ? "art-07" : undefined,
      x: 500 + nodes.length * 18,
      y: 500 + nodes.length * 12,
      width: type === "image" || type === "output" ? 220 : 250,
    };
    setNodes((current) => [...current, nextNode]);
    setSelectedNodeId(nextNode.id);
    setAddOpen(false);
  };

  /**
   * 模拟运行节点，并在完成后追加结果节点和连线。
   */
  const runNode = (node: PreviewNode) => {
    if (runningNodeId) return;
    setRunningNodeId(node.id);
    window.setTimeout(() => {
      const outputId = `preview-output-${Date.now()}`;
      const outputNode: PreviewNode = {
        id: outputId,
        type: "output",
        title: "新结果",
        imageId: "art-12",
        x: node.x + 410,
        y: node.y + 25,
        width: 240,
      };
      setNodes((current) => [...current, outputNode]);
      setEdges((current) => [...current, [node.id, outputId]]);
      setSelectedNodeId(outputId);
      setRunningNodeId(null);
    }, 900);
  };

  /**
   * 删除当前选中节点及其关联边。
   */
  const deleteSelectedNode = () => {
    const nodeId = selectedNodeId;
    if (!nodeId) return;
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) =>
      current.filter(([from, to]) => from !== nodeId && to !== nodeId)
    );
    setSelectedNodeId(null);
  };

  /**
   * 将视口恢复到原型的标准观察距离。
   */
  const fitView = () => setViewport({ x: 0, y: -96, zoom: 0.9 });

  return (
    <main
      className={styles.canvasView}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      onPointerCancel={handleCanvasPointerUp}
      onWheel={(event) => {
        event.preventDefault();
        setViewport((current) => ({
          ...current,
          zoom: Math.min(
            1.25,
            Math.max(0.55, current.zoom * (event.deltaY > 0 ? 0.92 : 1.08))
          ),
        }));
      }}
    >
      <div
        className={styles.nodeWorld}
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        <svg className={styles.nodeEdgeLayer} aria-hidden="true">
          {edges.map(([fromId, toId]) => {
            const fromNode = nodeMap.get(fromId);
            const toNode = nodeMap.get(toId);
            if (!fromNode || !toNode) return null;
            const startX = fromNode.x + fromNode.width;
            const startY = fromNode.y + 72;
            const endX = toNode.x;
            const endY = toNode.y + 72;
            const curve = Math.max(90, Math.abs(endX - startX) * 0.45);
            return (
              <path
                key={`${fromId}-${toId}`}
                className={styles.nodeEdge}
                d={`M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`}
              />
            );
          })}
          {connectFromId &&
            (() => {
              const source = nodeMap.get(connectFromId);
              if (!source) return null;
              const startX = source.x + source.width;
              const startY = source.y + 72;
              const curve = Math.max(
                90,
                Math.abs(connectionPoint.x - startX) * 0.45
              );
              return (
                <path
                  className={styles.nodeEdge}
                  d={`M ${startX} ${startY} C ${startX + curve} ${startY}, ${connectionPoint.x - curve} ${connectionPoint.y}, ${connectionPoint.x} ${connectionPoint.y}`}
                />
              );
            })()}
        </svg>

        {nodes.map((node) => (
          <PreviewNodeView
            key={node.id}
            node={node}
            selected={node.id === selectedNodeId}
            connecting={Boolean(connectFromId)}
            running={node.id === runningNodeId}
            onSelect={() => setSelectedNodeId(node.id)}
            onDragStart={(event) => startNodeDrag(node, event)}
            onConnectionStart={(event) => startConnection(node, event)}
            onConnectionFinish={(event) => finishConnection(node, event)}
            onRun={() => runNode(node)}
            onDelete={deleteSelectedNode}
          />
        ))}
      </div>

      <div className={styles.canvasToolbar}>
        <button
          type="button"
          className={styles.toolButton}
          data-active={activeTool === "select"}
          onClick={() => setActiveTool("select")}
          title="选择"
        >
          <MousePointer2 size={14} aria-hidden="true" />
          选择
        </button>
        <button
          type="button"
          className={styles.toolButton}
          data-active={activeTool === "pan"}
          onClick={() => setActiveTool("pan")}
          title="平移"
        >
          <Hand size={14} aria-hidden="true" />
          平移
        </button>
        <span className={styles.toolbarDivider} />
        <div className={styles.controlGroup}>
          <button
            type="button"
            className={styles.toolButton}
            data-active={addOpen}
            onClick={() => {
              setAddOpen((current) => !current);
              setMoreOpen(false);
            }}
          >
            <Plus size={14} aria-hidden="true" />
            添加
          </button>
          {addOpen && <NodePalette onAdd={addNode} />}
        </div>
        <div className={styles.controlGroup}>
          <button
            type="button"
            className={styles.toolButton}
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
          {moreOpen && (
            <div className={styles.canvasMorePanel}>
              <button type="button">
                <FileUp size={12} aria-hidden="true" /> 导入画布
              </button>
              <button type="button">
                <Download size={12} aria-hidden="true" /> 导出画布
              </button>
              <button type="button" onClick={deleteSelectedNode}>
                <Trash2 size={12} aria-hidden="true" /> 删除选中节点
              </button>
            </div>
          )}
        </div>
      </div>

      <Minimap nodes={nodes} selectedNodeId={selectedNodeId} />
      <div className={styles.edgeDock}>
        <button type="button" className={styles.viewButton}>
          {Math.round(viewport.zoom * 100)}%
        </button>
        <button
          type="button"
          className={styles.viewButton}
          title="适应视图"
          onClick={fitView}
        >
          <LocateFixed size={14} aria-hidden="true" />
          适应
        </button>
      </div>
    </main>
  );
}

/**
 * 渲染单个艺术化节点、运行命令与渐进显露端口。
 */
function PreviewNodeView({
  node,
  selected,
  connecting,
  running,
  onSelect,
  onDragStart,
  onConnectionStart,
  onConnectionFinish,
  onRun,
  onDelete,
}: {
  node: PreviewNode;
  selected: boolean;
  connecting: boolean;
  running: boolean;
  onSelect: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onConnectionStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onConnectionFinish: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  const artwork = node.imageId ? getArtwork(node.imageId) : null;
  const canReceive = node.type === "generator" || node.type === "output";
  const canOutput = node.type !== "output";
  const canRun = node.type === "prompt" || node.type === "generator";

  return (
    <article
      className={styles.node}
      data-selected={selected}
      style={{ left: node.x, top: node.y, width: node.width }}
      onPointerDown={onSelect}
    >
      {canReceive && (selected || connecting) && (
        <button
          type="button"
          className={styles.nodeHandle}
          data-side="input"
          aria-label={`${node.title}输入端口`}
          onPointerUp={onConnectionFinish}
        />
      )}
      {canOutput && selected && (
        <button
          type="button"
          className={styles.nodeHandle}
          data-side="output"
          data-active={connecting}
          aria-label={`${node.title}输出端口`}
          onPointerDown={onConnectionStart}
        />
      )}
      <div className={styles.nodeHeader} onPointerDown={onDragStart}>
        <span className={styles.nodeTitle}>
          <NodeIcon type={node.type} />
          {node.title}
        </span>
        <span style={{ display: "inline-flex", gap: 5 }}>
          {canRun && (
            <button
              type="button"
              className={styles.nodeRun}
              aria-label={`运行${node.title}节点`}
              title="运行"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onRun}
            >
              <Sparkles size={12} aria-hidden="true" />
            </button>
          )}
          {selected && (
            <button
              type="button"
              className={styles.nodeRun}
              aria-label={`删除${node.title}节点`}
              title="删除"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onDelete}
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
      <div className={styles.nodeBody}>
        <div className={styles.nodeType}>{node.type}</div>
        {artwork ? (
          <Image
            className={styles.nodeImage}
            src={artwork.src}
            alt={artwork.alt}
            width={artwork.width}
            height={artwork.height}
            unoptimized
          />
        ) : (
          <p>{running ? "正在生成结果..." : node.text}</p>
        )}
      </div>
    </article>
  );
}

/**
 * 返回节点类型对应的中性图标，不使用彩色编码。
 */
function NodeIcon({ type }: { type: PreviewNode["type"] }) {
  if (type === "prompt")
    return <TextCursorInput size={13} aria-hidden="true" />;
  if (type === "image") return <ImageIcon size={13} aria-hidden="true" />;
  if (type === "generator")
    return <WandSparkles size={13} aria-hidden="true" />;
  return <Repeat2 size={13} aria-hidden="true" />;
}

/**
 * 渲染添加节点的唯一主面板。
 */
function NodePalette({
  onAdd,
}: {
  onAdd: (type: PreviewNode["type"]) => void;
}) {
  const options: Array<{
    type: PreviewNode["type"];
    label: string;
    detail: string;
  }> = [
    { type: "prompt", label: "提示词", detail: "输入创作描述" },
    { type: "image", label: "图片", detail: "加入参考素材" },
    { type: "generator", label: "生成", detail: "组合输入并生成" },
    { type: "output", label: "输出", detail: "承载最终结果" },
  ];
  return (
    <div className={styles.floatingPanel} style={{ right: "auto", left: 0 }}>
      <div className={styles.panelHeader}>
        <h3>添加创作画布</h3>
        <span>现有节点</span>
      </div>
      <div className={styles.modelList}>
        {options.map((option) => (
          <button
            type="button"
            className={styles.modelOption}
            key={option.type}
            onClick={() => onAdd(option.type)}
          >
            <span>
              <span className={styles.modelName}>{option.label}</span>
              <span className={styles.modelDetail}>{option.detail}</span>
            </span>
            <NodeIcon type={option.type} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 渲染只读小地图，按节点世界坐标映射位置并增强当前选择。
 */
function Minimap({
  nodes,
  selectedNodeId,
}: {
  nodes: PreviewNode[];
  selectedNodeId: string | null;
}) {
  return (
    <aside className={styles.minimap} aria-label="无限画布小地图">
      <span className={styles.minimapLabel}>Overview</span>
      {nodes.map((node) => (
        <span
          className={styles.miniNode}
          key={node.id}
          style={{
            left: 14 + node.x * 0.1,
            top: 18 + node.y * 0.08,
            width: Math.max(12, node.width * 0.08),
            height: node.id === selectedNodeId ? 13 : 10,
            opacity: node.id === selectedNodeId ? 1 : 0.58,
          }}
        />
      ))}
      <span className={styles.miniViewport} />
    </aside>
  );
}
