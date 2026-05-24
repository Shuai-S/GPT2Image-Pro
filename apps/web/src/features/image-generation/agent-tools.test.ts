import { describe, expect, it } from "vitest";
import {
  createDefaultAgentAdditionalTools,
  DEFAULT_RESPONSES_IMAGE_INSTRUCTIONS,
  ORIGINAL_PROMPT_RESPONSES_IMAGE_INSTRUCTIONS,
} from "./agent-tools";

describe("Agent default tools", () => {
  it("aligns default Agent tools with the playground-style flow", () => {
    const tools = createDefaultAgentAdditionalTools();

    expect(tools.map((tool) => tool.type)).toEqual(["web_search", "function"]);
    expect(tools).toContainEqual(
      expect.objectContaining({
        type: "function",
        name: "continue_generation",
      })
    );
    expect(tools).not.toContainEqual(
      expect.objectContaining({ type: "code_interpreter" })
    );
  });

  it("does not tell the model to use code_interpreter by default", () => {
    expect(DEFAULT_RESPONSES_IMAGE_INSTRUCTIONS).not.toContain(
      "code_interpreter"
    );
    expect(ORIGINAL_PROMPT_RESPONSES_IMAGE_INSTRUCTIONS).not.toContain(
      "code_interpreter"
    );
  });

  it("keeps Agent flow linear and avoids runtime batch-tool assumptions", () => {
    expect(DEFAULT_RESPONSES_IMAGE_INSTRUCTIONS).toContain(
      "provide a brief visible progress note"
    );
    expect(DEFAULT_RESPONSES_IMAGE_INSTRUCTIONS).toContain(
      "do not call unavailable custom batch tools"
    );
    expect(DEFAULT_RESPONSES_IMAGE_INSTRUCTIONS).not.toContain(
      "generate_image_batch"
    );
  });
});
