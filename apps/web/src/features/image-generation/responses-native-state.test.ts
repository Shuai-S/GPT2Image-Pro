import { describe, expect, it } from "vitest";
import {
  buildResponsesImageEditRequest,
  buildResponsesImageGenerationRequest,
} from "./responses-image";
import {
  buildPreviousResponseFallbackRequestBody,
  buildCurrentResponsesContent,
  buildContinueGenerationFunctionCallItems,
  buildResponsesInput,
  getContinueGenerationFunctionCalls,
  isPreviousResponseStateError,
  resolvePromptImageReferences,
  resolveResponsesNativeState,
  shouldEnableResponsesPreviousResponse,
} from "./responses-native-state";
import { normalizeResponsesImageRequestBody } from "./responses-request-normalizer";
import type {
  ApiConfig,
  ChatHistoryMessage,
  ImageInputFile,
  StickyBackendMemberState,
} from "./types";

const accountA: StickyBackendMemberState = {
  type: "account",
  id: "acct-a",
  groupId: "group-a",
  accountBackend: "responses",
};

const accountB: StickyBackendMemberState = {
  type: "account",
  id: "acct-b",
  groupId: "group-a",
  accountBackend: "responses",
};

const webAccount: StickyBackendMemberState = {
  type: "account",
  id: "web-a",
  groupId: "group-web",
  accountBackend: "web",
};

const assistantWithNativeState: ChatHistoryMessage = {
  role: "assistant",
  variants: [
    {
      text: "done",
      responsesPreviousResponse: {
        responseId: "resp_previous",
        backendMember: accountA,
        store: true,
      },
    },
  ],
  activeVariant: 0,
};

const testImage: ImageInputFile = {
  data: Buffer.from("image-bytes"),
  name: "reference.png",
  type: "image/png",
};

function responsesConfig(): ApiConfig {
  return {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test",
    backend: {
      type: "pool-account",
      id: "acct-a",
      groupId: "group-a",
      accountBackend: "responses",
    },
  };
}

describe("Responses native state request planning", () => {
  it("uses previous_response_id for the same Responses account", () => {
    const state = resolveResponsesNativeState({
      enabled: true,
      currentBackendMember: accountA,
      history: [assistantWithNativeState],
    });

    expect(state.canUsePreviousResponseId).toBe(true);
    expect(state.previousResponseId).toBe("resp_previous");
  });

  it("does not reuse previous_response_id after account pool rotation", () => {
    const state = resolveResponsesNativeState({
      enabled: true,
      currentBackendMember: accountB,
      history: [assistantWithNativeState],
    });

    expect(state.canUsePreviousResponseId).toBe(false);
    expect(state.previousResponseId).toBeUndefined();
  });

  it("recognizes invalid previous response errors for manual-history fallback", () => {
    expect(
      isPreviousResponseStateError(
        "Upstream Responses API returned HTTP 400: Invalid previous_response_id"
      )
    ).toBe(true);
    expect(isPreviousResponseStateError("response not found")).toBe(true);
    expect(isPreviousResponseStateError("quota exceeded")).toBe(false);
  });

  it("plans fallback by switching from current-only input to manual history", () => {
    const currentOnly = [
      {
        role: "user" as const,
        content: buildCurrentResponsesContent("make it brighter", [testImage]),
      },
    ];
    const manualHistory = buildResponsesInput(
      "make it brighter",
      [testImage],
      undefined,
      [
        {
          role: "user",
          text: "make a poster",
        },
        assistantWithNativeState,
      ]
    );

    expect(currentOnly).toHaveLength(1);
    expect(manualHistory.length).toBeGreaterThan(1);
    expect(
      manualHistory.some(
        (message) =>
          "role" in message &&
          message.role === "user" &&
          message.content.some(
            (part) => part.type === "input_text" && part.text === "make a poster"
          )
      )
    ).toBe(true);
  });

  it("builds fallback request by clearing previous_response_id", () => {
    const fallbackInput = buildResponsesInput("retry with history", undefined, undefined, [
      { role: "user", text: "original request" },
    ]);
    const request = buildPreviousResponseFallbackRequestBody(
      {
        model: "gpt-5.4",
        input: [{ role: "user", content: [{ type: "input_text", text: "retry" }] }],
        previous_response_id: "resp_invalid",
        store: true,
      },
      fallbackInput
    );

    expect(request.previous_response_id).toBeUndefined();
    expect(request.input).toBe(fallbackInput);
    expect(request.store).toBe(true);
  });
});

describe("Responses image references", () => {
  it("turns current <ref id> references into real input_image content", () => {
    const content = buildCurrentResponsesContent("use this <ref id=\"hero\" />", [
      testImage,
    ]);

    expect(content).toContainEqual({
      type: "input_image",
      image_url: "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
    });
    expect(
      content.some(
        (part) =>
          part.type === "input_text" &&
          part.text.includes('<ref id="current-reference-1"')
      )
    ).toBe(true);
  });

  it("uses image file IDs as real input_image references", () => {
    const content = buildCurrentResponsesContent("edit <ref id=\"file\" />", [
      {
        ...testImage,
        imageFileId: "file_image_123",
      },
    ]);

    expect(content).toContainEqual({
      type: "input_image",
      file_id: "file_image_123",
    });
  });

  it("adds historical generated images as real image inputs in the next turn", () => {
    const input = buildResponsesInput("add a moon", undefined, undefined, [
      {
        role: "assistant",
        variants: [
          {
            text: "Generated image",
            imageUrl: "https://cdn.example.com/starry.png",
          },
        ],
      },
    ]);

    expect(
      input.some((message) =>
        "content" in message &&
        message.content.some(
          (part) =>
            part.type === "input_image" &&
            part.image_url === "https://cdn.example.com/starry.png"
        )
      )
    ).toBe(true);
  });

  it("rewrites @图 mentions to current reference tags", () => {
    const resolved = resolvePromptImageReferences({
      prompt: "参考 @图1 做一版海报",
      images: [testImage],
    });

    expect(resolved.prompt).toContain('<ref id="current-reference-1"');
    expect(resolved.historyImageReferences).toEqual([]);
  });

  it("rewrites @第N轮图M mentions and attaches the referenced history image", () => {
    const history: ChatHistoryMessage[] = [
      {
        role: "assistant",
        variants: [
          {
            text: "first",
            imageUrl: "https://cdn.example.com/one.png",
          },
          {
            text: "second",
            imageUrl: "https://cdn.example.com/two.png",
          },
        ],
      },
    ];
    const resolved = resolvePromptImageReferences({
      prompt: "参考 @第1轮图2 继续",
      history,
    });
    const content = buildCurrentResponsesContent(
      resolved.prompt,
      undefined,
      undefined,
      {
        extraImageReferences: resolved.historyImageReferences,
      }
    );

    expect(resolved.prompt).toContain('<ref id="history-round-1-image-2"');
    expect(content).toContainEqual({
      type: "input_image",
      image_url: "https://cdn.example.com/two.png",
    });
  });

  it("passes PDF attachments as input_file for Responses", () => {
    const content = buildCurrentResponsesContent(
      "summarize then make an image",
      undefined,
      [
        {
          data: Buffer.from("%PDF-1.7"),
          name: "brief.pdf",
          type: "application/pdf",
        },
      ]
    );

    expect(content).toContainEqual({
      type: "input_file",
      filename: "brief.pdf",
      file_data: "data:application/pdf;base64,JVBERi0xLjc=",
    });
  });
});

describe("Agent continue_generation tool", () => {
  it("extracts continue_generation function calls", () => {
    const calls = getContinueGenerationFunctionCalls([
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "continue_generation",
        arguments: JSON.stringify({ reason: "Need a polished second draft" }),
      },
    ]);

    expect(calls).toEqual([
      {
        id: "fc_1",
        callId: "call_1",
        name: "continue_generation",
        arguments: JSON.stringify({ reason: "Need a polished second draft" }),
        reason: "Need a polished second draft",
      },
    ]);
  });

  it("builds function call outputs for the next manual-history Agent round", () => {
    const items = buildContinueGenerationFunctionCallItems({
      includeFunctionCallInputs: true,
      outputItems: [
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "continue_generation",
          arguments: JSON.stringify({ reason: "Need another version" }),
        },
      ],
    });

    expect(items).toEqual([
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "continue_generation",
        arguments: JSON.stringify({ reason: "Need another version" }),
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: JSON.stringify({
          ok: true,
          continue: true,
          reason: "Need another version",
        }),
      },
    ]);
  });
});

describe("backend isolation", () => {
  it("enables store only for internal Chat/Agent Responses backend", () => {
    expect(
      shouldEnableResponsesPreviousResponse({
        settingEnabled: true,
        currentBackendMember: accountA,
      })
    ).toBe(true);
    expect(
      shouldEnableResponsesPreviousResponse({
        settingEnabled: true,
        rawResponsesBody: { input: "external" },
        currentBackendMember: accountA,
      })
    ).toBe(false);
    expect(
      shouldEnableResponsesPreviousResponse({
        settingEnabled: true,
        currentBackendMember: webAccount,
      })
    ).toBe(false);
  });

  it("does not enable Responses native state for Web backend state", () => {
    const state = resolveResponsesNativeState({
      enabled: false,
      currentBackendMember: webAccount,
      history: [assistantWithNativeState],
    });

    expect(state.canUsePreviousResponseId).toBe(false);
    expect(state.previousResponseId).toBeUndefined();
  });

  it("keeps external raw Responses pass-through store disabled", () => {
    const body = normalizeResponsesImageRequestBody(
      {
        model: "gpt-5.4",
        input: "draw",
        previous_response_id: "resp_external",
        store: true,
        tools: [{ type: "web_search" }],
        size: "1024x1024",
      },
      {
        fallbackTool: { type: "image_generation", model: "gpt-image-2" },
        instructions: "test",
        stream: false,
      }
    );

    expect(body.store).toBe(false);
    expect(body.previous_response_id).toBe("resp_external");
    expect(body.size).toBeUndefined();
    expect(body.tools).toEqual([
      { type: "web_search" },
      { type: "image_generation", model: "gpt-image-2" },
    ]);
  });

  it("keeps ordinary single image generation store disabled", () => {
    const request = buildResponsesImageGenerationRequest(responsesConfig(), {
      prompt: "draw a cat",
    });

    expect(request.store).toBe(false);
    expect("previous_response_id" in request).toBe(false);
  });

  it("rewrites direct image edit @图 mentions to edit reference tags", () => {
    const request = buildResponsesImageEditRequest(responsesConfig(), {
      prompt: "把 @图1 改成蓝色背景",
      images: [testImage],
    });

    const textPart = request.input[0]?.content.find(
      (part) => part.type === "input_text"
    );
    expect(textPart?.text).toContain('<ref id="edit-reference-1"');
    expect(request.input[0]?.content).toContainEqual({
      type: "input_image",
      image_url: "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
    });
  });
});
