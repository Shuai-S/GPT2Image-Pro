import { withApiLogging } from "@repo/shared/api-logger";
import { sendRegistrationVerificationCode } from "@repo/shared/auth/registration-verification";
import { logError } from "@repo/shared/logger";
import { type NextRequest, NextResponse } from "next/server";

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email : "";

    await sendRegistrationVerificationCode(email);

    return NextResponse.json({ success: true });
  } catch (error) {
    logError(error, { source: "registration-verification" });
    return NextResponse.json(
      { error: "Failed to send verification code" },
      { status: 400 }
    );
  }
}

export const POST = withApiLogging(handlePost);
