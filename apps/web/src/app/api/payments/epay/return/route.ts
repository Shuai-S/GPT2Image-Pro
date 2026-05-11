import { NextResponse } from "next/server";
import { getBaseUrl } from "@repo/shared/config/payment";
import {
  decodeEpayMetadata,
  EPAY_TRADE_SUCCESS,
  isEpayConfigured,
  parseEpayRequestParams,
  verifyEpayParams,
} from "@repo/shared/payment/epay";
import { logger, logError } from "@repo/shared/logger";
import { fulfillSuccessfulEpayPayment } from "@/features/payment/epay-fulfillment";

export async function GET(req: Request) {
  return handleReturn(req);
}

export async function POST(req: Request) {
  return handleReturn(req);
}

async function handleReturn(req: Request) {
  const baseUrl = getBaseUrl();

  if (!isEpayConfigured()) {
    return NextResponse.redirect(
      `${baseUrl}/dashboard/settings?tab=usage&pay=fail`
    );
  }

  const params = await parseEpayRequestParams(req);
  const verifyInfo = verifyEpayParams(params);
  const metadata = verifyInfo.verifyStatus
    ? decodeEpayMetadata(verifyInfo.param)
    : null;
  const redirectPath =
    metadata?.type === "subscription"
      ? "/dashboard"
      : "/dashboard/settings?tab=usage";
  const separator = redirectPath.includes("?") ? "&" : "?";

  if (!verifyInfo.verifyStatus) {
    logger.warn(
      { source: "epay-return", outTradeNo: verifyInfo.outTradeNo },
      "Invalid Epay return signature"
    );
    return NextResponse.redirect(
      `${baseUrl}${redirectPath}${separator}pay=fail`
    );
  }

  let payStatus = "pending";
  if (verifyInfo.tradeStatus === EPAY_TRADE_SUCCESS) {
    try {
      await fulfillSuccessfulEpayPayment(verifyInfo, "epay-return");
      payStatus = "success";
    } catch (error) {
      logError(error, {
        source: "epay-return",
        outTradeNo: verifyInfo.outTradeNo,
      });
      payStatus = "fail";
    }
  }

  return NextResponse.redirect(
    `${baseUrl}${redirectPath}${separator}pay=${payStatus}`
  );
}
