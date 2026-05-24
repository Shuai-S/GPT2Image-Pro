import { describe, expect, it } from "vitest";
import {
  appendAgentRunEvent,
  buildAgentRoundCards,
  createOptimisticAgentRoundEvents,
} from "./agent-round-cards";
import type { AgentRunEvent } from "./types";

const roundStart: AgentRunEvent = {
  id: "round-1",
  kind: "message",
  status: "started",
  title: "Agent 第 1 轮开始",
  detail: "分析请求并按需调用工具",
  timestamp: "2026-05-24T00:00:00.000Z",
};

const waiting: AgentRunEvent = {
  id: "agent-round-1-upstream",
  kind: "tool",
  status: "running",
  title: "等待 Codex/Responses 上游响应",
  detail: "已发送请求，等待模型返回工具调用、文本或图片",
  timestamp: "2026-05-24T00:00:01.000Z",
  toolType: "agent_round_request",
};

describe("Agent round task cards", () => {
  it("creates an optimistic round with a visible waiting task", () => {
    const rounds = buildAgentRoundCards(createOptimisticAgentRoundEvents(1));

    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.title).toBe("Agent 第 1 轮开始");
    expect(rounds[0]?.tasks[0]).toMatchObject({
      toolType: "agent_round_request",
      status: "running",
    });
  });

  it("merges optimistic waiting events with backend waiting updates", () => {
    const events = createOptimisticAgentRoundEvents(1).reduce<
      AgentRunEvent[]
    >((items, event) => appendAgentRunEvent(items, event), []);
    const merged = appendAgentRunEvent(events, {
      id: "agent-round-1-upstream",
      kind: "tool",
      status: "running",
      title: "等待 Codex/Responses 上游响应",
      detail: "模型仍在处理，已等待 15 秒",
      timestamp: "2026-05-24T00:00:15.000Z",
      toolType: "agent_round_request",
    });
    const rounds = buildAgentRoundCards(merged);

    expect(rounds[0]?.tasks).toHaveLength(1);
    expect(rounds[0]?.tasks[0]).toMatchObject({
      toolType: "agent_round_request",
      status: "running",
      detail: "模型仍在处理，已等待 15 秒",
    });
  });

  it("merges optimistic round starts with backend round starts by round number", () => {
    const events = createOptimisticAgentRoundEvents(1).reduce<
      AgentRunEvent[]
    >((items, event) => appendAgentRunEvent(items, event), []);
    const merged = appendAgentRunEvent(events, {
      kind: "message",
      status: "started",
      title: "Agent 第 1 轮开始",
      detail: "分析请求并按需调用工具",
      timestamp: "2026-05-24T00:00:02.000Z",
    });
    const rounds = buildAgentRoundCards(merged);

    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.title).toBe("Agent 第 1 轮开始");
    expect(rounds[0]?.tasks).toHaveLength(1);
    expect(rounds[0]?.tasks[0]?.toolType).toBe("agent_round_request");
  });

  it("keeps the upstream waiting card running before real tool events", () => {
    const rounds = buildAgentRoundCards([roundStart, waiting]);

    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.status).toBe("started");
    expect(rounds[0]?.tasks).toHaveLength(1);
    expect(rounds[0]?.tasks[0]).toMatchObject({
      toolType: "agent_round_request",
      status: "running",
    });
  });

  it("does not treat tool compatibility retry as the first real tool event", () => {
    const rounds = buildAgentRoundCards([
      roundStart,
      waiting,
      {
        kind: "tool",
        status: "completed",
        title: "工具兼容性调整",
        detail: "已移除 code_interpreter 后重试",
        timestamp: "2026-05-24T00:00:02.000Z",
        toolType: "agent_tool_compat",
      },
    ]);

    expect(rounds[0]?.tasks).toHaveLength(2);
    expect(rounds[0]?.tasks[0]).toMatchObject({
      toolType: "agent_round_request",
      status: "running",
    });
    expect(rounds[0]?.tasks[1]).toMatchObject({
      toolType: "agent_tool_compat",
      status: "completed",
    });
  });

  it("marks the waiting card complete when a real tool event arrives", () => {
    const rounds = buildAgentRoundCards([
      roundStart,
      waiting,
      {
        id: "search-1",
        kind: "web_search",
        status: "running",
        title: "联网搜索",
        detail: "浙江双元科技 官网",
        timestamp: "2026-05-24T00:00:03.000Z",
        toolType: "web_search_call",
      },
    ]);

    expect(rounds[0]?.tasks).toHaveLength(2);
    expect(rounds[0]?.tasks[0]).toMatchObject({
      toolType: "agent_round_request",
      status: "completed",
      detail: "已收到工具事件，继续展示实际执行步骤",
    });
    expect(rounds[0]?.tasks[1]).toMatchObject({
      kind: "web_search",
      status: "running",
    });
  });

  it("groups consecutive web search events like a single playground search block", () => {
    const rounds = buildAgentRoundCards([
      roundStart,
      waiting,
      {
        id: "search-1",
        kind: "web_search",
        status: "running",
        title: "联网搜索",
        detail: "浙江双元科技 官网",
        timestamp: "2026-05-24T00:00:03.000Z",
        toolType: "web_search_call",
      },
      {
        id: "search-2",
        kind: "web_search",
        status: "completed",
        title: "联网搜索完成",
        detail: "https://www.zjusy.com/about.html",
        timestamp: "2026-05-24T00:00:04.000Z",
        toolType: "web_search_call",
      },
    ]);

    expect(rounds[0]?.tasks).toHaveLength(2);
    expect(rounds[0]?.tasks[1]).toMatchObject({
      kind: "web_search",
      title: "联网搜索完成",
      status: "completed",
    });
    expect(rounds[0]?.tasks[1]?.events).toHaveLength(2);
    expect(rounds[0]?.tasks[1]?.detail).toContain("浙江双元科技 官网");
    expect(rounds[0]?.tasks[1]?.detail).toContain(
      "https://www.zjusy.com/about.html"
    );
  });

  it("starts a separate task after a web search group when another tool appears", () => {
    const rounds = buildAgentRoundCards([
      roundStart,
      waiting,
      {
        id: "search-1",
        kind: "web_search",
        status: "completed",
        title: "联网搜索完成",
        detail: "浙江双元科技 官网",
        timestamp: "2026-05-24T00:00:03.000Z",
        toolType: "web_search_call",
      },
      {
        id: "image-1",
        kind: "image_generation",
        status: "running",
        title: "图片生成",
        timestamp: "2026-05-24T00:00:04.000Z",
        toolType: "image_generation_call",
      },
      {
        id: "search-2",
        kind: "web_search",
        status: "completed",
        title: "联网搜索完成",
        detail: "688623 年报",
        timestamp: "2026-05-24T00:00:05.000Z",
        toolType: "web_search_call",
      },
    ]);

    expect(rounds[0]?.tasks.map((task) => task.kind)).toEqual([
      "tool",
      "web_search",
      "image_generation",
      "web_search",
    ]);
  });

  it("ignores raw upstream event cards to avoid noisy task lists", () => {
    const rounds = buildAgentRoundCards([
      roundStart,
      waiting,
      {
        id: "raw-upstream-response.output_item.added",
        kind: "tool",
        status: "started",
        title: "收到上游流式事件",
        detail: "response.output_item.added",
        timestamp: "2026-05-24T00:00:02.000Z",
        toolType: "responses_stream_event",
      },
    ]);

    expect(rounds[0]?.tasks).toHaveLength(1);
    expect(rounds[0]?.notes).toHaveLength(0);
  });

  it("marks the final Agent execution event as the completed round state", () => {
    const rounds = buildAgentRoundCards([
      roundStart,
      {
        kind: "message",
        status: "completed",
        title: "Agent 执行完成",
        detail: "已完成 2 轮 Agent 执行",
        timestamp: "2026-05-24T00:00:10.000Z",
      },
    ]);

    expect(rounds[0]?.status).toBe("completed");
    expect(rounds[0]?.detail).toBe("已完成 2 轮 Agent 执行");
  });

  it("deduplicates streamed partial images by partial image index", () => {
    const events = appendAgentRunEvent(
      [
        {
          kind: "image_partial",
          status: "completed",
          title: "流式预览已生成",
          imageUrl: "data:image/png;base64,old",
          partialImageIndex: 0,
        },
      ],
      {
        kind: "image_partial",
        status: "completed",
        title: "流式预览已生成",
        imageUrl: "data:image/png;base64,new",
        partialImageIndex: 0,
      }
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.imageUrl).toBe("data:image/png;base64,new");
  });
});
