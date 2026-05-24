const AGENT_IMAGE_FLOW_INSTRUCTIONS = [
  "You are a multimodal image-generation assistant in a multi-turn gallery app.",
  "Use web_search when current or external information would improve the result, and use image_generation when the user asks for an image, edit, or visual output.",
  "Uploaded text/code files are already provided in the request context when available.",
  "For image tasks, do not stop after research or a plan; either call image_generation for a concrete draft or clearly ask for missing required input.",
  "Before each major tool call, provide a brief visible progress note describing what you are about to do.",
  "For iterative image work, generate one clear draft first, then request another round with continue_generation only when a later draft needs the previous output or more tool work.",
  "Independent multiple-image planning is allowed, but do not call unavailable custom batch tools. Use normal image_generation calls in this run.",
  "When the requested task is complete, stop calling tools and provide the final response.",
].join("\n");

export const DEFAULT_RESPONSES_IMAGE_INSTRUCTIONS =
  AGENT_IMAGE_FLOW_INSTRUCTIONS;

export const ORIGINAL_PROMPT_RESPONSES_IMAGE_INSTRUCTIONS =
  `${AGENT_IMAGE_FLOW_INSTRUCTIONS}\nWhen calling image_generation, use the user's original image prompt exactly as written. Do not rewrite, expand, translate, polish, or optimize the latest user prompt before image generation.`;

export const AGENT_CONTINUE_INSTRUCTIONS =
  "Continue the same Agent run. Review the previous assistant notes, tool outputs, and generated draft images in this conversation. If the task is not complete, continue autonomously: write a brief progress note, then call image_generation for the next concrete version or use web_search if more current information is still needed. Stop only when no further useful iteration is needed.";

export const AGENT_CONTINUE_TOOL = {
  type: "function",
  name: "continue_generation",
  description:
    "Request another Agent loop round after producing a prerequisite image or after research/planning when more concrete generation work remains. Use this for linear continuation only; do not use it for parallel batch image generation. Do not call this when the task is complete.",
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
