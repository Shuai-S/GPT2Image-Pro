import { describe, expect, it } from "vitest";

import {
  buildChatCompletionAssistantContent,
  chatCompletionMessagesToChatParams,
} from "./chat-completions-utils";

describe("chat completions adapter utilities", () => {
  it("maps system, history, final user text, and image_url into chat params", () => {
    const params = chatCompletionMessagesToChatParams([
      { role: "system", content: "Use a clean poster style." },
      { role: "user", content: "Create a first draft." },
      {
        role: "assistant",
        content: "First draft created.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Refine this into a 4K hero image." },
          {
            type: "image_url",
            image_url: { url: "https://example.com/reference.png" },
          },
        ],
      },
    ]);

    expect(params.apiPrompt).toBe("Use a clean poster style.");
    expect(params.prompt).toBe("Refine this into a 4K hero image.");
    expect(params.promptImageUrls).toEqual([
      "https://example.com/reference.png",
    ]);
    expect(params.history).toEqual([
      { role: "user", text: "Create a first draft.", imageUrls: undefined },
      { role: "assistant", text: "First draft created.", imageUrls: undefined },
    ]);
  });

  it("adds generated image URLs to assistant content", () => {
    expect(
      buildChatCompletionAssistantContent({
        text: "Here is the result.",
        images: [{ url: "https://example.com/out.png" }],
      })
    ).toBe(
      "Here is the result.\n\n![generated image 1](https://example.com/out.png)"
    );
  });
});
