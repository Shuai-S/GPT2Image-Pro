/**
 * 支付宝官方异步通知入口。
 *
 * 本路由只做请求解析、RSA2 验签和成功状态过滤；实际积分/订阅履约委托给
 * epay-fulfillment 的同一本地订单状态机，复用 pending -> success 原子领取
 * 与 credits_batch 幂等约束，避免官方支付宝渠道产生第二套财务路径。
 */

import { withApiLogging } from "@repo/shared/api-logger";
import { logError, logger } from "@repo/shared/logger";
import {
  ALIPAY_TRADE_FINISHED,
  ALIPAY_TRADE_SUCCESS,
  isRuntimeAlipayConfigured,
  parseAlipayRequestParams,
  verifyRuntimeAlipayParams,
} from "@repo/shared/payment/alipay";
import { fulfillSuccessfulEpayPayment } from "@/features/payment/epay-fulfillment";

export const GET = withApiLogging(handleAlipayWebhook);
export const POST = withApiLogging(handleAlipayWebhook);

async function handleAlipayWebhook(req: Request) {
  if (!(await isRuntimeAlipayConfigured())) {
    logger.warn({ source: "alipay-webhook" }, "Alipay is not configured");
    return new Response("fail", { status: 200 });
  }

  const params = await parseAlipayRequestParams(req);
  const verifyInfo = await verifyRuntimeAlipayParams(params);

  if (!verifyInfo.verifyStatus) {
    logger.warn(
      { source: "alipay-webhook", outTradeNo: verifyInfo.outTradeNo },
      "Invalid Alipay signature"
    );
    return new Response("fail", { status: 200 });
  }

  if (
    verifyInfo.tradeStatus !== ALIPAY_TRADE_SUCCESS &&
    verifyInfo.tradeStatus !== ALIPAY_TRADE_FINISHED
  ) {
    logger.info(
      {
        source: "alipay-webhook",
        outTradeNo: verifyInfo.outTradeNo,
        tradeStatus: verifyInfo.tradeStatus,
      },
      "Ignoring non-success Alipay event"
    );
    return new Response("success", { status: 200 });
  }

  try {
    await fulfillSuccessfulEpayPayment(verifyInfo, "alipay-webhook");
  } catch (error) {
    logError(error, {
      source: "alipay-webhook",
      outTradeNo: verifyInfo.outTradeNo,
    });
    return new Response("fail", { status: 200 });
  }

  return new Response("success", { status: 200 });
}
