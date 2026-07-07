"use client";

import { CircleHelp, FileText, ImagePlus, Search, Wand2 } from "lucide-react";
import { CachedImage as Image } from "@/features/shared/components/cached-image";
import { type AgentTaskCard, buildAgentRoundCards } from "../agent-round-cards";
import { shouldBypassImageOptimization, thumbSrc } from "./create-page-options";
import type { AgentRunEvent } from "./create-page-types";

// Agent 过程展示组件:负责 thinking、原始日志、工具任务卡和按轮次分组的 Agent 过程。

type CopyFn = (en: string, zh: string) => string;

/**
 * 渲染模型 thinking 内容。
 *
 * @param props.thinking thinking 文本。
 * @param props.open 是否默认展开。
 * @param props.copy 中英文文案选择器。
 * @returns thinking 折叠块或 null。
 * @sideEffects 无。
 * @failureMode 空文本不渲染。
 */
export function CreatePageThinkingBlock({
  thinking,
  open = false,
  copy,
}: {
  thinking?: string;
  open?: boolean;
  copy: CopyFn;
}) {
  if (!thinking) return null;
  return (
    <details
      className="mb-3 rounded-md border border-border bg-background/70 p-2"
      open={open}
    >
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        {copy("Thinking", "思考过程")}
      </summary>
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
        {thinking}
      </p>
    </details>
  );
}

/**
 * 渲染 Agent 原始运行日志。
 *
 * @param props.agent Agent 文本。
 * @param props.open 是否默认展开。
 * @param props.showAgentProcessHint 当前后端是否展示 Agent 过程。
 * @param props.copy 中英文文案选择器。
 * @returns Agent 日志折叠块或 null。
 * @sideEffects 无。
 * @failureMode 后端不展示过程或空文本时不渲染。
 */
export function CreatePageAgentBlock({
  agent,
  open = false,
  showAgentProcessHint,
  copy,
}: {
  agent?: string;
  open?: boolean;
  showAgentProcessHint: boolean;
  copy: CopyFn;
}) {
  if (!agent || !showAgentProcessHint) return null;
  return (
    <details
      className="mb-3 rounded-md border border-border bg-background/70 p-2"
      open={open}
    >
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        {copy("Agent run", "运行过程")}
      </summary>
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
        {agent}
      </p>
    </details>
  );
}

/**
 * 渲染按轮次聚合的 Agent 任务卡片。
 *
 * @param props.events Agent 事件。
 * @param props.fallbackAgent 无结构化事件时的日志回退。
 * @param props.open 是否默认展开。
 * @param props.showAgentProcessHint 当前后端是否展示 Agent 过程。
 * @param props.copy 中英文文案选择器。
 * @returns Agent 任务折叠块或 null。
 * @sideEffects 无。
 * @failureMode 无结构化轮次时回退原始 Agent 日志。
 */
export function CreatePageAgentRoundCards({
  events,
  fallbackAgent,
  open = false,
  showAgentProcessHint,
  copy,
}: {
  events?: AgentRunEvent[];
  fallbackAgent?: string;
  open?: boolean;
  showAgentProcessHint: boolean;
  copy: CopyFn;
}) {
  if (!showAgentProcessHint) return null;
  const rounds = buildAgentRoundCards(events);
  if (rounds.length === 0) {
    return (
      <CreatePageAgentBlock
        agent={fallbackAgent}
        open={open}
        showAgentProcessHint={showAgentProcessHint}
        copy={copy}
      />
    );
  }

  const helpers = createAgentProgressHelpers(copy);

  return (
    <details
      className="mb-3 rounded-md border border-border bg-background/70 p-2"
      open={open}
    >
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        {copy("Agent tasks", "Agent 任务")}
      </summary>
      <div className="mt-3 space-y-3">
        {rounds.map((round, index) => (
          <section
            key={round.key}
            className="rounded-md border border-border bg-muted/20 p-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  {round.title ||
                    copy(`Round ${index + 1}`, `第 ${index + 1} 轮`)}
                </p>
                {round.detail && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                    {round.detail}
                  </p>
                )}
              </div>
              <span
                className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${helpers.taskStatusClass(
                  round.status
                )}`}
              >
                {helpers.taskStatusLabel(round.status)}
              </span>
            </div>
            {round.tasks.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {round.tasks.map((task) => renderAgentTaskCard(task, helpers))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                {copy("No tool task in this round.", "本轮暂无工具任务。")}
              </p>
            )}
            {round.notes.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-border pt-2">
                {round.notes.map((note, noteIndex) => (
                  <p
                    // biome-ignore lint/suspicious/noArrayIndexKey: round notes 为追加型、不重排,noteIndex 作 key 安全
                    key={`${round.key}-note-${noteIndex}`}
                    className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground"
                  >
                    {note.title}
                    {note.detail ? ` - ${note.detail}` : ""}
                  </p>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      {fallbackAgent && (
        <details className="mt-3 border-t border-border pt-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            {copy("Raw log", "原始日志")}
          </summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
            {fallbackAgent}
          </p>
        </details>
      )}
    </details>
  );
}

/**
 * 创建 Agent 任务展示所需的标签和样式 helper。
 *
 * @param copy 中英文文案选择器。
 * @returns 内部任务卡片渲染 helper。
 * @sideEffects 无。
 * @failureMode 未识别事件会使用工具默认标签。
 */
function createAgentProgressHelpers(copy: CopyFn) {
  const eventLabel = (event: AgentRunEvent) => {
    if (event.kind === "web_search") return copy("Search", "联网");
    if (event.kind === "code_interpreter") return copy("Code", "代码");
    if (event.kind === "image_generation") return copy("Image", "生图");
    if (event.kind === "image_partial") return copy("Stream", "流式");
    if (event.kind === "reasoning") return copy("Thinking", "思考");
    if (event.kind === "message") return copy("Message", "消息");
    if (event.toolType === "agent_decision") return copy("Decision", "决策");
    return copy("Tool", "工具");
  };

  const eventStatusLabel = (event: AgentRunEvent) => {
    if (event.status === "completed") return copy("done", "完成");
    if (event.status === "failed") return copy("failed", "失败");
    if (event.status === "running") return copy("running", "运行中");
    return copy("started", "开始");
  };

  const taskStatusLabel = (status?: AgentRunEvent["status"]) => {
    if (status === "completed") return copy("Done", "完成");
    if (status === "failed") return copy("Failed", "失败");
    if (status === "running") return copy("Running", "运行中");
    return copy("Started", "开始");
  };

  const taskIcon = (kind: AgentRunEvent["kind"]) => {
    if (kind === "web_search") return <Search className="h-3.5 w-3.5" />;
    if (kind === "code_interpreter") {
      return <FileText className="h-3.5 w-3.5" />;
    }
    if (kind === "image_generation" || kind === "image_partial") {
      return <ImagePlus className="h-3.5 w-3.5" />;
    }
    if (kind === "reasoning") return <CircleHelp className="h-3.5 w-3.5" />;
    return <Wand2 className="h-3.5 w-3.5" />;
  };

  const taskBorderClass = (status?: AgentRunEvent["status"]) => {
    if (status === "completed") return "border-emerald-500/35";
    if (status === "failed") return "border-destructive/50";
    if (status === "running") return "border-primary/40";
    return "border-border";
  };

  const taskStatusClass = (status?: AgentRunEvent["status"]) => {
    if (status === "completed") {
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    }
    if (status === "failed") {
      return "border-destructive/30 bg-destructive/10 text-destructive";
    }
    if (status === "running") {
      return "border-primary/30 bg-primary/10 text-primary";
    }
    return "border-border bg-muted text-muted-foreground";
  };

  return {
    eventLabel,
    eventStatusLabel,
    taskStatusLabel,
    taskIcon,
    taskBorderClass,
    taskStatusClass,
  };
}

/**
 * 渲染单个 Agent 任务卡。
 *
 * @param task 聚合后的任务卡数据。
 * @param helpers 标签和样式 helper。
 * @returns Agent 任务卡片。
 * @sideEffects 无。
 * @failureMode 缺失首事件时使用任务本身字段构造展示事件。
 */
function renderAgentTaskCard(
  task: AgentTaskCard,
  helpers: ReturnType<typeof createAgentProgressHelpers>
) {
  return (
    <div
      key={task.key}
      className={`rounded-md border bg-background/75 p-2.5 ${helpers.taskBorderClass(
        task.status
      )}`}
    >
      {(() => {
        const firstEvent = task.events[0] || {
          kind: task.kind,
          title: task.title,
          status: task.status,
          toolType: task.toolType,
        };
        return (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                  {helpers.taskIcon(task.kind)}
                </span>
                <span className="text-xs font-semibold text-foreground">
                  {helpers.eventLabel({ ...firstEvent, kind: task.kind })}
                </span>
                {task.toolType && (
                  <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {task.toolType}
                  </span>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-xs font-medium leading-relaxed text-foreground">
                {task.title}
              </p>
              {task.detail && (
                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                  {task.detail}
                </p>
              )}
            </div>
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${helpers.taskStatusClass(
                task.status
              )}`}
            >
              {helpers.taskStatusLabel(task.status)}
            </span>
          </div>
        );
      })()}
      {task.imageUrl && (
        <div className="mt-2 max-w-[240px] overflow-hidden rounded-md border bg-muted">
          <Image
            src={thumbSrc(task.imageUrl, 480)}
            alt={task.title}
            width={240}
            height={240}
            className="h-auto w-full object-contain"
            unoptimized={shouldBypassImageOptimization(task.imageUrl)}
          />
        </div>
      )}
      {task.events.length > 1 && (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {task.events.slice(-3).map((event, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 事件为追加型日志、仅取末3条且不重排,index 与状态组合作 key 安全
              key={`${task.key}-event-${event.status || ""}-${index}`}
              className="flex items-center gap-2 text-[11px] text-muted-foreground"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/45" />
              <span>{helpers.eventStatusLabel(event)}</span>
              {event.detail && (
                <span className="min-w-0 truncate">{event.detail}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
