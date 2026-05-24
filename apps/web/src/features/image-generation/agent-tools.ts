export const DEFAULT_RESPONSES_IMAGE_INSTRUCTIONS =
  "You are a multimodal assistant. Use web_search when current or external information is needed, and use image_generation when the user asks for an image, edit, or visual output. Uploaded text/code files are already provided in the request context when available. For image tasks, do not stop after research or a plan; either call image_generation or clearly ask for missing required input.";

export const ORIGINAL_PROMPT_RESPONSES_IMAGE_INSTRUCTIONS =
  "You are a multimodal assistant. Use web_search when current or external information is needed. Uploaded text/code files are already provided in the request context when available. When calling image_generation, use the user's original image prompt exactly as written. Do not rewrite, expand, translate, polish, or optimize the latest user prompt before image generation. For image tasks, do not stop after research or a plan; either call image_generation or clearly ask for missing required input.";

export const AGENT_CONTINUE_INSTRUCTIONS =
  "Continue the same Agent run. Review the previous assistant notes, tool outputs, and generated draft images in this conversation. If the user asked for image creation or iterative refinement and the task is not complete, continue autonomously: call image_generation for the next concrete version, or stop only when no further useful iteration is needed. Keep visible progress notes brief.";

export const AGENT_CONTINUE_TOOL = {
  type: "function",
  name: "continue_generation",
  description:
    "Request another Agent loop round after producing a prerequisite image or after research/planning when more concrete generation work remains. Do not call this when the task is complete.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description:
          "Brief reason why another round is needed and what should happen next.",
      },
    },
    required: ["reason"],
    additionalProperties: false,
  },
  strict: true,
} as const;

export const DEFAULT_AGENT_IMAGE_ROUNDS = 3;

export function createDefaultAgentAdditionalTools() {
  return [{ type: "web_search" } as const, AGENT_CONTINUE_TOOL];
}
