import { withApiLogging } from "@repo/shared/api-logger";

import { openAIImageError } from "@/features/external-api/images";

export const postUnsupportedChatCompletions = withApiLogging(async () =>
  openAIImageError(
    "GPT2Image does not support /v1/chat/completions. Use /v1/responses for Responses image models, or /v1/images/generations and /v1/images/edits for image models.",
    400,
    "unsupported_endpoint"
  )
);
