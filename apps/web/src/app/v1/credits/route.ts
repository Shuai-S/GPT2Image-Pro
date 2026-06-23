import { corsPreflight, corsRoute } from "@/features/external-api/cors";
import { getExternalCredits } from "@/features/external-api/handlers/credits";

export const GET = corsRoute(getExternalCredits);
export const OPTIONS = corsPreflight;
