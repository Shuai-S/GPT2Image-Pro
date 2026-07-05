/**
 * 支付宝官方支付纯逻辑回归测试。
 *
 * 覆盖 RSA2 签名/验签、支付表单构造和异步通知字段归一。这里 mock
 * system-settings 与数据库依赖，确保测试只锁定协议层纯逻辑，不触达真实
 * 支付宝、数据库或运行时配置。
 */

import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({ db: {} }));
vi.mock("@repo/database/schema", () => ({ epayOrder: {} }));
vi.mock("../system-settings", () => ({
  getRuntimeSettingSelect: vi.fn(),
  getRuntimeSettingString: vi.fn(),
}));

import {
  getRuntimeSettingSelect,
  getRuntimeSettingString,
} from "../system-settings";
import {
  ALIPAY_TRADE_SUCCESS,
  buildAlipayVerifyResult,
  createAlipayPurchase,
  createRuntimeAlipayPurchase,
  signAlipayParams,
  verifyAlipayParams,
} from "./alipay";

const keyPair = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function configureAlipayEnv() {
  process.env.ALIPAY_APP_ID = "2026000000000001";
  process.env.ALIPAY_APP_PRIVATE_KEY = keyPair.privateKey;
  process.env.ALIPAY_PUBLIC_KEY = keyPair.publicKey;
  process.env.ALIPAY_GATEWAY_URL = "https://openapi.alipay.test/gateway.do";
  process.env.ALIPAY_NOTIFY_URL = "";
  process.env.ALIPAY_RETURN_URL = "";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
}

function mergeAlipaySubmitParams(result: {
  url: string;
  params: Record<string, string>;
}) {
  const url = new URL(result.url);
  const merged = Object.fromEntries(url.searchParams.entries());
  return {
    ...merged,
    ...result.params,
  };
}

function verifyAlipayRequestParams(params: Record<string, string>) {
  const sign = params.sign ?? "";
  const payload = Object.keys(params)
    .filter((key) => key !== "sign" && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto
    .createVerify("RSA-SHA256")
    .update(payload, "utf8")
    .verify(keyPair.publicKey, sign, "base64");
}

describe("signAlipayParams / verifyAlipayParams", () => {
  it("signs and verifies RSA2 parameters while excluding sign fields", () => {
    configureAlipayEnv();
    const params = {
      app_id: "2026000000000001",
      method: "alipay.trade.page.pay",
      biz_content: JSON.stringify({ out_trade_no: "T1" }),
      sign_type: "RSA2",
    };
    const signed = { ...params, sign: signAlipayParams(params) };

    expect(verifyAlipayParams(signed)).toBe(true);
    expect(verifyAlipayParams({ ...signed, biz_content: "{}" })).toBe(false);
  });

  it("accepts PEM keys stored with escaped newlines", () => {
    configureAlipayEnv();
    const params = {
      app_id: "2026000000000001",
      method: "alipay.trade.page.pay",
      biz_content: JSON.stringify({ out_trade_no: "T1" }),
      sign_type: "RSA2",
    };

    process.env.ALIPAY_APP_PRIVATE_KEY = keyPair.privateKey.replace(
      /\n/g,
      "\\n"
    );
    process.env.ALIPAY_PUBLIC_KEY = keyPair.publicKey.replace(/\n/g, "\\n");

    const signed = { ...params, sign: signAlipayParams(params) };
    expect(verifyAlipayParams(signed)).toBe(true);
  });
});

describe("createAlipayPurchase", () => {
  it("creates page pay form params with signed biz_content", () => {
    configureAlipayEnv();

    const result = createAlipayPurchase({
      outTradeNo: "SUB123",
      name: "GPT2IMAGE Pro monthly",
      money: 60,
    });

    const submitParams = mergeAlipaySubmitParams(result);

    expect(new URL(result.url).origin).toBe("https://openapi.alipay.test");
    expect(submitParams.method).toBe("alipay.trade.page.pay");
    expect(submitParams.charset).toBe("utf-8");
    expect(new URL(result.url).searchParams.get("charset")).toBe("utf-8");
    expect(result.params).toEqual({ biz_content: submitParams.biz_content });
    expect(submitParams.notify_url).toBe(
      "https://app.example.com/api/webhooks/alipay"
    );
    expect(submitParams.return_url).toBe(
      "https://app.example.com/api/payments/alipay/return"
    );
    expect(verifyAlipayRequestParams(submitParams)).toBe(true);
    const bizContent = submitParams.biz_content;
    expect(bizContent).toBeDefined();
    if (!bizContent) return;
    expect(JSON.parse(bizContent)).toMatchObject({
      out_trade_no: "SUB123",
      total_amount: "60.00",
      product_code: "FAST_INSTANT_TRADE_PAY",
    });
  });

  it("uses configured synchronous return URL from env", () => {
    configureAlipayEnv();
    process.env.ALIPAY_RETURN_URL = "https://pay.example.com/payment/result";

    const result = createAlipayPurchase({
      outTradeNo: "SUB_RETURN_ENV",
      name: "GPT2IMAGE Pro monthly",
      money: 60,
    });

    const submitParams = mergeAlipaySubmitParams(result);

    expect(submitParams.return_url).toBe(
      "https://pay.example.com/payment/result"
    );
    expect(verifyAlipayRequestParams(submitParams)).toBe(true);
  });

  it("uses configured synchronous return URL from runtime settings", async () => {
    configureAlipayEnv();
    const runtimeValues: Record<string, string> = {
      ALIPAY_APP_ID: "2026000000000001",
      ALIPAY_APP_PRIVATE_KEY: keyPair.privateKey,
      ALIPAY_PUBLIC_KEY: keyPair.publicKey,
      ALIPAY_GATEWAY_URL: "https://openapi.alipay.test/gateway.do",
      ALIPAY_RETURN_URL: "https://admin.example.com/payment/result",
    };
    vi.mocked(getRuntimeSettingString).mockImplementation(async (key) => {
      return runtimeValues[key] ?? undefined;
    });
    vi.mocked(getRuntimeSettingSelect).mockImplementation(
      async (_key, _options, fallback) => fallback
    );

    const result = await createRuntimeAlipayPurchase({
      outTradeNo: "SUB_RETURN_RUNTIME",
      name: "GPT2IMAGE Pro monthly",
      money: 60,
    });

    const submitParams = mergeAlipaySubmitParams(result);

    expect(submitParams.notify_url).toBe(
      "https://app.example.com/api/webhooks/alipay"
    );
    expect(submitParams.return_url).toBe(
      "https://admin.example.com/payment/result"
    );
    expect(verifyAlipayRequestParams(submitParams)).toBe(true);
  });

  it("creates wap pay params when requested", () => {
    configureAlipayEnv();

    const result = createAlipayPurchase(
      { outTradeNo: "CR123", name: "Credits", money: "20.50" },
      "wap"
    );

    const submitParams = mergeAlipaySubmitParams(result);

    expect(submitParams.method).toBe("alipay.trade.wap.pay");
    const bizContent = submitParams.biz_content;
    expect(bizContent).toBeDefined();
    if (!bizContent) return;
    expect(JSON.parse(bizContent)).toMatchObject({
      out_trade_no: "CR123",
      total_amount: "20.50",
      product_code: "QUICK_WAP_WAY",
    });
  });
});

describe("buildAlipayVerifyResult", () => {
  it("maps Alipay notification fields into local fulfillment shape", () => {
    const result = buildAlipayVerifyResult(
      {
        trade_no: "2026070322001",
        out_trade_no: "SUB123",
        subject: "GPT2IMAGE Pro monthly",
        total_amount: "60.00",
        trade_status: ALIPAY_TRADE_SUCCESS,
      },
      true
    );

    expect(result).toMatchObject({
      verifyStatus: true,
      type: "alipay",
      tradeNo: "2026070322001",
      outTradeNo: "SUB123",
      name: "GPT2IMAGE Pro monthly",
      money: "60.00",
      tradeStatus: "TRADE_SUCCESS",
    });
  });
});
