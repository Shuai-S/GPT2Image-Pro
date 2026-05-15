import { withApiLogging } from "@repo/shared/api-logger";
import { type NextRequest, NextResponse } from "next/server";

import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import { getExternalModelsForUser } from "@/features/external-api/models";

function openAIError(message: string, status = 400, code?: string) {
  return NextResponse.json(
    {
      error: {
        message,
        type: "invalid_request_error",
        code: code || null,
      },
    },
    { status }
  );
}

export const GET = withApiLogging(async (request: NextRequest) => {
  const auth = await authenticateExternalApiRequest(request);
  if (!auth) {
    return openAIError("Invalid or missing API key", 401, "invalid_api_key");
  }

  return NextResponse.json(await getExternalModelsForUser(auth.userId), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
});
