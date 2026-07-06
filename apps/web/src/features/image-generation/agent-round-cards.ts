import type { AgentRunEvent } from "./types";

export type AgentTaskCard = {
  key: string;
  kind: AgentRunEvent["kind"];
  title: string;
  detail?: string;
  status?: AgentRunEvent["status"];
  startedAt?: string;
  updatedAt?: string;
  toolType?: string;
  imageUrl?: string;
  events: AgentRunEvent[];
  children?: AgentTaskCard[];
};

export type AgentRoundCard = {
  key: string;
  title: string;
  detail?: string;
  status?: AgentRunEvent["status"];
  startedAt?: string;
  updatedAt?: string;
  tasks: AgentTaskCard[];
  notes: AgentRunEvent[];
};

const AGENT_BACKGROUND_TOOL_TYPES = new Set([
  "agent_round_request",
  "agent_tool_compat",
  "responses_stream_event",
]);

export function agentEventToImageUrl(event: AgentRunEvent) {
  if (event.imageUrl) return event.imageUrl;
  if (event.imageBase64) return `data:image/png;base64,${event.imageBase64}`;
  return undefined;
}

export function normalizeAgentEvent(event: AgentRunEvent): AgentRunEvent {
  return {
    ...event,
    imageUrl: agentEventToImageUrl(event),
    imageBase64: undefined,
    timestamp: event.timestamp || new Date().toISOString(),
  };
}

function isAgentRoundStartEvent(event: AgentRunEvent) {
  return (
    event.kind === "message" && /Agent 第\s*\d+\s*轮开始/.test(event.title)
  );
}

function getAgentRoundStartNumber(event: AgentRunEvent) {
  const match = event.title.match(/Agent 第\s*(\d+)\s*轮开始/);
  return match?.[1];
}

export function appendAgentRunEvent(
  events: AgentRunEvent[],
  incoming: AgentRunEvent
) {
  const nextEvent = normalizeAgentEvent(incoming);
  const matchIndex = events.findIndex((event) => {
    if (nextEvent.kind === "image_partial" || event.kind === "image_partial") {
      return (
        nextEvent.kind === "image_partial" &&
        event.kind === "image_partial" &&
        nextEvent.partialImageIndex !== undefined &&
        event.partialImageIndex === nextEvent.partialImageIndex &&
        (event.index === undefined ||
          nextEvent.index === undefined ||
          event.index === nextEvent.index)
      );
    }
    if (nextEvent.id && event.id === nextEvent.id) return true;
    if (isAgentRoundStartEvent(nextEvent) && isAgentRoundStartEvent(event)) {
      const nextRound = getAgentRoundStartNumber(nextEvent);
      return Boolean(
        nextRound && nextRound === getAgentRoundStartNumber(event)
      );
    }
    return false;
  });

  if (matchIndex < 0) return [...events, nextEvent];

  return events.map((event, index) =>
    index === matchIndex ? { ...event, ...nextEvent } : event
  );
}

function getAgentTaskKey(event: AgentRunEvent) {
  if (event.id) return `id:${event.id}`;
  if (event.kind === "image_partial") {
    return [
      "image_partial",
      event.index ?? "",
      event.partialImageIndex ?? "",
      event.toolType || "",
    ].join(":");
  }
  return [
    event.kind,
    event.toolType || "",
    event.title,
    event.index ?? "",
    event.partialImageIndex ?? "",
  ].join(":");
}

function isAgentRoundEndEvent(event: AgentRunEvent) {
  return (
    event.kind === "message" &&
    (/Agent 第\s*\d+\s*轮(?:完成|停止)/.test(event.title) ||
      /Agent 执行(?:完成|失败)/.test(event.title))
  );
}

function isAgentTaskEvent(event: AgentRunEvent) {
  return (
    event.kind === "web_search" ||
    event.kind === "code_interpreter" ||
    event.kind === "image_generation" ||
    event.kind === "image_partial" ||
    event.kind === "tool"
  );
}

function isBackgroundAgentTaskEvent(event: AgentRunEvent) {
  return Boolean(
    event.toolType && AGENT_BACKGROUND_TOOL_TYPES.has(event.toolType)
  );
}

function isActiveRoundStatus(status: AgentRunEvent["status"]) {
  return status !== "completed" && status !== "failed";
}

function isWebSearchEvent(event: AgentRunEvent) {
  return event.kind === "web_search" || event.toolType === "web_search_call";
}

function getTaskLastEvent(task: AgentTaskCard) {
  return task.events[task.events.length - 1];
}

function getDominantStatus(events: AgentRunEvent[]): AgentRunEvent["status"] {
  if (events.some((event) => event.status === "failed")) return "failed";
  const latestStatus = events
    .toReversed()
    .map((event) => event.status)
    .find((status): status is NonNullable<AgentRunEvent["status"]> =>
      Boolean(status)
    );
  if (latestStatus === "started") return "running";
  if (latestStatus) return latestStatus;
  return undefined;
}

function summarizeWebSearchDetail(events: AgentRunEvent[]) {
  const details = events
    .map((event) => event.detail?.trim())
    .filter((detail): detail is string => Boolean(detail));
  return Array.from(new Set(details)).slice(-3).join("\n");
}

function mergeWebSearchTask(
  task: AgentTaskCard,
  event: AgentRunEvent,
  imageUrl?: string
): AgentTaskCard {
  const events = appendAgentRunEvent(task.events, event);
  const status = getDominantStatus(events) || event.status || task.status;
  const detail =
    summarizeWebSearchDetail(events) || event.detail || task.detail;
  return {
    ...task,
    title: status === "completed" ? "联网搜索完成" : "联网搜索",
    detail,
    status,
    updatedAt: event.timestamp || task.updatedAt,
    imageUrl: imageUrl || task.imageUrl,
    events,
  };
}

function findOpenWebSearchTaskIndex(tasks: AgentTaskCard[]) {
  const index = tasks.length - 1;
  if (index < 0) return -1;
  const task = tasks[index];
  if (!task) return -1;
  const lastEvent = getTaskLastEvent(task);
  return lastEvent && isWebSearchEvent(lastEvent) ? index : -1;
}

export function buildAgentRoundCards(events: AgentRunEvent[] | undefined) {
  const normalizedEvents = (events || []).reduce<AgentRunEvent[]>(
    (items, event) => appendAgentRunEvent(items, event),
    []
  );
  const rounds: AgentRoundCard[] = [];
  let currentRound: AgentRoundCard | undefined;

  const ensureRound = () => {
    if (currentRound) return currentRound;
    currentRound = {
      key: "round-implicit",
      title: "Agent run",
      tasks: [],
      notes: [],
    };
    rounds.push(currentRound);
    return currentRound;
  };

  for (const event of normalizedEvents) {
    if (isAgentRoundStartEvent(event)) {
      currentRound = {
        key: event.id || `round-${rounds.length + 1}`,
        title: event.title,
        detail: event.detail,
        status: event.status || "running",
        startedAt: event.timestamp,
        updatedAt: event.timestamp,
        tasks: [],
        notes: [],
      };
      rounds.push(currentRound);
      continue;
    }

    const round = ensureRound();
    round.updatedAt = event.timestamp || round.updatedAt;

    if (isAgentRoundEndEvent(event)) {
      round.status = event.status || "completed";
      round.detail = event.detail || round.detail;
      round.updatedAt = event.timestamp || round.updatedAt;
      round.notes.push(event);
      continue;
    }

    if (!isAgentTaskEvent(event)) {
      round.notes.push(event);
      continue;
    }

    if (event.toolType === "responses_stream_event") {
      continue;
    }

    const key = getAgentTaskKey(event);
    const existingIndex = round.tasks.findIndex((task) => task.key === key);
    const imageUrl = agentEventToImageUrl(event);
    const backgroundEvent = isBackgroundAgentTaskEvent(event);
    if (existingIndex >= 0) {
      const task = round.tasks[existingIndex];
      if (!task) continue;
      round.tasks[existingIndex] = isWebSearchEvent(event)
        ? mergeWebSearchTask(task, event, imageUrl)
        : {
            ...task,
            title: event.title || task.title,
            detail: event.detail || task.detail,
            status: event.status || task.status,
            updatedAt: event.timestamp || task.updatedAt,
            toolType: event.toolType || task.toolType,
            imageUrl: imageUrl || task.imageUrl,
            events: appendAgentRunEvent(task.events, event),
          };
      continue;
    }

    if (
      !backgroundEvent &&
      event.status !== "failed" &&
      isActiveRoundStatus(currentRound?.status)
    ) {
      const waitingTaskIndex = round.tasks.findIndex(
        (task) =>
          task.toolType === "agent_round_request" && task.status === "running"
      );
      if (waitingTaskIndex >= 0) {
        const waitingTask = round.tasks[waitingTaskIndex];
        const lastWaitingEvent =
          waitingTask?.events[waitingTask.events.length - 1];
        if (!waitingTask || !lastWaitingEvent) continue;
        const completedEvent: AgentRunEvent = {
          ...lastWaitingEvent,
          status: "completed",
          detail: "已收到工具事件，继续展示实际执行步骤",
          timestamp: event.timestamp || new Date().toISOString(),
        };
        round.tasks[waitingTaskIndex] = {
          ...waitingTask,
          status: "completed",
          detail: completedEvent.detail,
          updatedAt: completedEvent.timestamp,
          events: appendAgentRunEvent(waitingTask.events, completedEvent),
        };
      }
    }

    if (isWebSearchEvent(event)) {
      const webSearchTaskIndex = findOpenWebSearchTaskIndex(round.tasks);
      if (webSearchTaskIndex >= 0) {
        const task = round.tasks[webSearchTaskIndex];
        if (!task) continue;
        round.tasks[webSearchTaskIndex] = mergeWebSearchTask(
          task,
          event,
          imageUrl
        );
        continue;
      }
    }

    round.tasks.push({
      key,
      kind: event.kind,
      title: event.title,
      detail: event.detail,
      status: event.status,
      startedAt: event.timestamp,
      updatedAt: event.timestamp,
      toolType: event.toolType,
      imageUrl,
      events: [normalizeAgentEvent(event)],
    });
  }

  return rounds;
}

export function createAgentRoundStartEvent(round = 1): AgentRunEvent {
  return {
    id: `agent-round-${round}-start`,
    kind: "message",
    status: "started",
    title: `Agent 第 ${round} 轮开始`,
    detail:
      round === 1 ? "分析请求并按需调用工具" : "根据上一版结果继续判断是否迭代",
    timestamp: new Date().toISOString(),
  };
}

export function createAgentRoundWaitingEvent(round = 1): AgentRunEvent {
  return {
    id: `agent-round-${round}-upstream`,
    kind: "tool",
    status: "running",
    title: "等待 Codex/Responses 上游响应",
    detail: "已发送请求，等待模型返回工具调用、文本或图片",
    timestamp: new Date().toISOString(),
    toolType: "agent_round_request",
  };
}

export function createOptimisticAgentRoundEvents(round = 1): AgentRunEvent[] {
  return [
    createAgentRoundStartEvent(round),
    createAgentRoundWaitingEvent(round),
  ];
}
