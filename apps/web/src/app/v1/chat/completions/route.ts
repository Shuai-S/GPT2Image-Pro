import { corsPreflight, corsRoute } from "@/features/external-api/cors";
import { postExternalChatCompletions } from "@/features/external-api/handlers/chat-completions";

export const POST = corsRoute(postExternalChatCompletions);
export const OPTIONS = corsPreflight;
