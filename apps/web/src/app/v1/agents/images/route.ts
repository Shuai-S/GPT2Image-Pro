import { corsPreflight, corsRoute } from "@/features/external-api/cors";
import { postExternalAgentImages } from "@/features/external-api/handlers/agent-images";

export const POST = corsRoute(postExternalAgentImages);
export const OPTIONS = corsPreflight;
