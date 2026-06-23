import { corsPreflight, corsRoute } from "@/features/external-api/cors";
import { getExternalModels } from "@/features/external-api/handlers/models";

export const GET = corsRoute(getExternalModels);
export const OPTIONS = corsPreflight;
