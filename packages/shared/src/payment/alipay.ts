/**
 * 支付宝官方支付客户端辅助函数。
 *
 * 使用支付宝开放平台 RSA2 协议生成电脑网站支付 / 手机网站支付表单，
 * 并验证异步通知签名后归一为现有 Epay 履约结构。调用方是支付
 * server action、支付宝 webhook 与同步回跳路由；订单元数据继续复用
 * epay_order，保证财务发放只走同一套幂等门闩。
 */

import crypto from "node:crypto";
import { getBaseUrl } from "../config/payment";
import {
  getRuntimeSettingSelect,
  getRuntimeSettingString,
} from "../system-settings";
import {
  type EpayPurchaseInput,
  type EpayPurchaseResult,
  type EpayVerifyResult,
  formatEpayMoney,
  parseEpayRequestParams,
} from "./epay";

export const ALIPAY_TRADE_SUCCESS = "TRADE_SUCCESS";
export const ALIPAY_TRADE_FINISHED = "TRADE_FINISHED";
export const ALIPAY_GATEWAY_URL = "https://openapi.alipay.com/gateway.do";
export const ALIPAY_SANDBOX_GATEWAY_URL =
  "https://openapi-sandbox.dl.alipaydev.com/gateway.do";

type AlipayMode = "precreate" | "page" | "wap";

interface AlipayConfig {
  appId: string;
  appPrivateKey: string;
  alipayPublicKey: string;
  gatewayUrl: string;
  charset: string;
}

function getEnvValue(key: string): string {
  return process.env[key]?.trim() ?? "";
}

function normalizePemKey(key: string, kind: "private" | "public"): string {
  const trimmed = key.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("-----BEGIN")) return trimmed;

  const label = kind === "private" ? "PRIVATE KEY" : "PUBLIC KEY";
  const body = trimmed
    .replace(/\s+/g, "")
    .match(/.{1,64}/g)
    ?.join("\n");
  return `-----BEGIN ${label}-----\n${body ?? trimmed}\n-----END ${label}-----`;
}

function getAlipayConfig(): AlipayConfig {
  const appId = getEnvValue("ALIPAY_APP_ID");
  const appPrivateKey = getEnvValue("ALIPAY_APP_PRIVATE_KEY");
  const alipayPublicKey = getEnvValue("ALIPAY_PUBLIC_KEY");
  const gatewayUrl = getEnvValue("ALIPAY_GATEWAY_URL") || ALIPAY_GATEWAY_URL;
  const charset = getEnvValue("ALIPAY_CHARSET") || "utf-8";

  if (!appId || !appPrivateKey || !alipayPublicKey) {
    throw new Error(
      "ALIPAY_APP_ID, ALIPAY_APP_PRIVATE_KEY and ALIPAY_PUBLIC_KEY must be configured"
    );
  }

  return { appId, appPrivateKey, alipayPublicKey, gatewayUrl, charset };
}

async function getRuntimeAlipayConfig(): Promise<AlipayConfig> {
  const appId = (await getRuntimeSettingString("ALIPAY_APP_ID")) ?? "";
  const appPrivateKey =
    (await getRuntimeSettingString("ALIPAY_APP_PRIVATE_KEY")) ?? "";
  const alipayPublicKey =
    (await getRuntimeSettingString("ALIPAY_PUBLIC_KEY")) ?? "";
  const gatewayUrl =
    (await getRuntimeSettingString("ALIPAY_GATEWAY_URL")) ?? ALIPAY_GATEWAY_URL;
  const charset = (await getRuntimeSettingString("ALIPAY_CHARSET")) ?? "utf-8";

  if (!appId || !appPrivateKey || !alipayPublicKey) {
    throw new Error(
      "ALIPAY_APP_ID, ALIPAY_APP_PRIVATE_KEY and ALIPAY_PUBLIC_KEY must be configured"
    );
  }

  return { appId, appPrivateKey, alipayPublicKey, gatewayUrl, charset };
}

export function isAlipayConfigured(): boolean {
  return Boolean(
    getEnvValue("ALIPAY_APP_ID") &&
      getEnvValue("ALIPAY_APP_PRIVATE_KEY") &&
      getEnvValue("ALIPAY_PUBLIC_KEY")
  );
}

export async function isRuntimeAlipayConfigured(): Promise<boolean> {
  return Boolean(
    (await getRuntimeSettingString("ALIPAY_APP_ID")) &&
      (await getRuntimeSettingString("ALIPAY_APP_PRIVATE_KEY")) &&
      (await getRuntimeSettingString("ALIPAY_PUBLIC_KEY"))
  );
}

async function getRuntimeAlipayMode(): Promise<AlipayMode> {
  return getRuntimeSettingSelect(
    "ALIPAY_PAYMENT_MODE",
    ["precreate", "page", "wap"] as const,
    "precreate"
  );
}

function getAlipayReturnUrl(baseUrl: string): string {
  return (
    getEnvValue("ALIPAY_RETURN_URL") || `${baseUrl}/api/payments/alipay/return`
  );
}

function getAlipayNotifyUrl(baseUrl: string): string {
  return getEnvValue("ALIPAY_NOTIFY_URL") || `${baseUrl}/api/webhooks/alipay`;
}

async function getRuntimeAlipayNotifyUrl(baseUrl: string): Promise<string> {
  return (
    (await getRuntimeSettingString("ALIPAY_NOTIFY_URL")) ??
    `${baseUrl}/api/webhooks/alipay`
  );
}

async function getRuntimeAlipayReturnUrl(baseUrl: string): Promise<string> {
  return (
    (await getRuntimeSettingString("ALIPAY_RETURN_URL")) ??
    getAlipayReturnUrl(baseUrl)
  );
}

function buildAlipaySignPayload(
  params: Record<string, string>,
  options?: { includeSignType?: boolean }
): string {
  return Object.keys(params)
    .filter(
      (key) =>
        key !== "sign" &&
        (options?.includeSignType || key !== "sign_type") &&
        params[key] !== ""
    )
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

export function signAlipayParams(
  params: Record<string, string>,
  appPrivateKey?: string,
  options?: { includeSignType?: boolean }
): string {
  const privateKey = normalizePemKey(
    appPrivateKey ?? getAlipayConfig().appPrivateKey,
    "private"
  );
  return crypto
    .createSign("RSA-SHA256")
    .update(buildAlipaySignPayload(params, options), "utf8")
    .sign(privateKey, "base64");
}

function verifyAlipayParamsWithPublicKey(
  params: Record<string, string>,
  publicKey: string
): boolean {
  const sign = params.sign ?? "";
  if (!sign) return false;

  try {
    return crypto
      .createVerify("RSA-SHA256")
      .update(buildAlipaySignPayload(params), "utf8")
      .verify(normalizePemKey(publicKey, "public"), sign, "base64");
  } catch {
    return false;
  }
}

export function verifyAlipayParams(params: Record<string, string>): boolean {
  return verifyAlipayParamsWithPublicKey(
    params,
    getAlipayConfig().alipayPublicKey
  );
}

async function verifyRuntimeAlipaySignature(
  params: Record<string, string>
): Promise<boolean> {
  const { alipayPublicKey, appId } = await getRuntimeAlipayConfig();
  if (params.app_id && params.app_id !== appId) return false;
  if (params.sign_type && params.sign_type !== "RSA2") return false;
  return verifyAlipayParamsWithPublicKey(params, alipayPublicKey);
}

function createAlipayRequestParams(input: {
  config: AlipayConfig;
  outTradeNo: string;
  subject: string;
  totalAmount: string;
  notifyUrl: string;
  returnUrl: string;
  mode: AlipayMode;
}): Record<string, string> {
  const method =
    input.mode === "precreate"
      ? "alipay.trade.precreate"
      : input.mode === "wap"
        ? "alipay.trade.wap.pay"
        : "alipay.trade.page.pay";
  const productCode =
    input.mode === "precreate"
      ? "FACE_TO_FACE_PAYMENT"
      : input.mode === "wap"
        ? "QUICK_WAP_WAY"
        : "FAST_INSTANT_TRADE_PAY";
  const bizContent = JSON.stringify({
    out_trade_no: input.outTradeNo,
    total_amount: input.totalAmount,
    subject: input.subject,
    product_code: productCode,
  });

  const params: Record<string, string> = {
    app_id: input.config.appId,
    method,
    charset: input.config.charset,
    sign_type: "RSA2",
    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    version: "1.0",
    notify_url: input.notifyUrl,
    biz_content: bizContent,
  };
  if (input.mode !== "precreate") {
    params.return_url = input.returnUrl;
  }

  return {
    ...params,
    // 支付宝网关对发起支付请求验签时会把 sign_type 放入待签名串；
    // 回跳/异步通知的验签仍沿用 verify 分支排除 sign_type，避免混淆两种口径。
    sign: signAlipayParams(params, input.config.appPrivateKey, {
      includeSignType: true,
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

async function requestAlipayPrecreatePayment(input: {
  purchase: EpayPurchaseInput;
  config: AlipayConfig;
  notifyUrl: string;
}): Promise<EpayPurchaseResult> {
  const params = createAlipayRequestParams({
    config: input.config,
    outTradeNo: input.purchase.outTradeNo,
    subject: input.purchase.name,
    totalAmount: formatEpayMoney(input.purchase.money),
    notifyUrl: input.notifyUrl,
    returnUrl: "",
    mode: "precreate",
  });
  const response = await fetch(input.config.gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!response.ok) {
    throw new Error(`Alipay precreate request failed: ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new Error("Alipay precreate response must be an object");
  }
  const result = payload.alipay_trade_precreate_response;
  if (!isRecord(result)) {
    throw new Error("Alipay precreate response is missing result body");
  }

  const code = getStringField(result, "code");
  const msg = getStringField(result, "msg");
  const subCode = getStringField(result, "sub_code");
  const subMsg = getStringField(result, "sub_msg");
  if (code !== "10000") {
    throw new Error(
      `Alipay precreate failed: ${subCode || code} ${subMsg || msg}`.trim()
    );
  }

  const qrCode = getStringField(result, "qr_code");
  if (!qrCode) {
    throw new Error("Alipay precreate response is missing qr_code");
  }

  return { url: qrCode, method: "QR", qrCode };
}

function buildAlipaySubmitUrl(
  gatewayUrl: string,
  params: Record<string, string>
): string {
  const submitUrl = new URL(gatewayUrl);
  for (const [key, value] of Object.entries(params)) {
    if (key !== "biz_content") {
      submitUrl.searchParams.set(key, value);
    }
  }
  return submitUrl.toString();
}

function createAlipayPurchaseWithConfig(
  input: EpayPurchaseInput,
  config: AlipayConfig,
  mode: AlipayMode,
  notifyUrl: string,
  returnUrl: string
): EpayPurchaseResult {
  if (mode === "precreate") {
    throw new Error("Alipay precreate mode requires runtime purchase creation");
  }

  const params = createAlipayRequestParams({
    config,
    outTradeNo: input.outTradeNo,
    subject: input.name,
    totalAmount: formatEpayMoney(input.money),
    notifyUrl,
    returnUrl,
    mode,
  });
  const bizContent = params.biz_content;
  if (!bizContent) {
    throw new Error("Alipay biz_content must be generated before signing");
  }

  return {
    url: buildAlipaySubmitUrl(config.gatewayUrl, params),
    params: { biz_content: bizContent },
  };
}

export function createAlipayPurchase(
  input: EpayPurchaseInput,
  mode: AlipayMode = "page"
): EpayPurchaseResult {
  const baseUrl = getBaseUrl();
  return createAlipayPurchaseWithConfig(
    input,
    getAlipayConfig(),
    mode,
    input.notifyUrl ?? getAlipayNotifyUrl(baseUrl),
    input.returnUrl ?? getAlipayReturnUrl(baseUrl)
  );
}

export async function createRuntimeAlipayPurchase(
  input: EpayPurchaseInput
): Promise<EpayPurchaseResult> {
  const baseUrl = getBaseUrl();
  const config = await getRuntimeAlipayConfig();
  const mode = await getRuntimeAlipayMode();
  const notifyUrl =
    input.notifyUrl ?? (await getRuntimeAlipayNotifyUrl(baseUrl));
  if (mode === "precreate") {
    return requestAlipayPrecreatePayment({
      purchase: input,
      config,
      notifyUrl,
    });
  }

  return createAlipayPurchaseWithConfig(
    input,
    config,
    mode,
    notifyUrl,
    input.returnUrl ?? (await getRuntimeAlipayReturnUrl(baseUrl))
  );
}

export function buildAlipayVerifyResult(
  params: Record<string, string>,
  verifyStatus: boolean
): EpayVerifyResult {
  return {
    verifyStatus,
    type: "alipay",
    tradeNo: params.trade_no ?? "",
    outTradeNo: params.out_trade_no ?? "",
    name: params.subject ?? "",
    money: params.total_amount ?? params.receipt_amount ?? "",
    tradeStatus: params.trade_status ?? "",
    raw: params,
  };
}

export async function verifyRuntimeAlipayParams(
  params: Record<string, string>
): Promise<EpayVerifyResult> {
  return buildAlipayVerifyResult(
    params,
    await verifyRuntimeAlipaySignature(params)
  );
}

export async function parseAlipayRequestParams(
  req: Request
): Promise<Record<string, string>> {
  return parseEpayRequestParams(req);
}
