/**
 * 支付宝官方同步回跳页。
 *
 * 浏览器回跳参数可被用户重放，因此这里仅验签并展示本地订单状态，
 * 绝不触发积分/订阅履约。真正履约只由 /api/webhooks/alipay 的异步通知完成。
 */

import { getRuntimeSiteUrl } from "@repo/shared/config/site-runtime";
import { logger } from "@repo/shared/logger";
import {
  ALIPAY_TRADE_FINISHED,
  ALIPAY_TRADE_SUCCESS,
  isRuntimeAlipayConfigured,
  parseAlipayRequestParams,
  verifyRuntimeAlipayParams,
} from "@repo/shared/payment/alipay";
import {
  getEpayOrderMetadata,
  getEpayOrderStatus,
} from "@repo/shared/payment/epay";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  return handleReturn(req);
}

export async function POST(req: Request) {
  return handleReturn(req);
}

async function handleReturn(req: Request) {
  const baseUrl = await getRuntimeSiteUrl();

  if (!(await isRuntimeAlipayConfigured())) {
    return NextResponse.redirect(`${baseUrl}/dashboard/billing?pay=fail`);
  }

  const params = await parseAlipayRequestParams(req);
  const verifyInfo = await verifyRuntimeAlipayParams(params);
  const metadata = verifyInfo.verifyStatus
    ? await getEpayOrderMetadata(verifyInfo.outTradeNo)
    : null;
  const isProviderMatch = metadata?.provider === "alipay";
  const redirectPath =
    metadata?.type === "subscription" ? "/dashboard" : "/dashboard/billing";
  const separator = redirectPath.includes("?") ? "&" : "?";

  if (!verifyInfo.verifyStatus || !isProviderMatch) {
    logger.warn(
      {
        source: "alipay-return",
        outTradeNo: verifyInfo.outTradeNo,
        provider: metadata?.provider ?? "unknown",
      },
      "Invalid Alipay return"
    );
    return NextResponse.redirect(
      `${baseUrl}${redirectPath}${separator}pay=fail`
    );
  }

  const orderStatus = await getEpayOrderStatus(verifyInfo.outTradeNo);
  let payStatus: "success" | "processing" | "pending" | "fail" = "pending";
  if (orderStatus === "success") {
    payStatus = "success";
  } else if (orderStatus === "failed") {
    payStatus = "fail";
  } else if (
    verifyInfo.tradeStatus === ALIPAY_TRADE_SUCCESS ||
    verifyInfo.tradeStatus === ALIPAY_TRADE_FINISHED
  ) {
    payStatus = "processing";
  }

  return NextResponse.redirect(
    `${baseUrl}${redirectPath}${separator}pay=${payStatus}`
  );
}
