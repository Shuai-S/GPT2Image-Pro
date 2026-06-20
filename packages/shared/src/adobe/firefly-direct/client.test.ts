import { describe, expect, it } from "vitest";
import { AdobeFireflyClient, extractResultLink } from "./client";
import { AuthError, QuotaExhaustedError } from "./errors";
import type {
  FireflyTransport,
  FireflyTransportRequest,
  FireflyTransportResponse,
} from "./transport";

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): FireflyTransportResponse {
  const buf = Buffer.from(JSON.stringify(body), "utf-8");
  return {
    status,
    headers,
    bytes: async () => buf,
    text: async () => buf.toString("utf-8"),
    json: async () => JSON.parse(buf.toString("utf-8")),
  };
}

function bytesResponse(status: number, data: Buffer): FireflyTransportResponse {
  return {
    status,
    headers: {},
    bytes: async () => data,
    text: async () => data.toString("utf-8"),
    json: async () => JSON.parse(data.toString("utf-8")),
  };
}

class MockTransport implements FireflyTransport {
  calls: FireflyTransportRequest[] = [];
  constructor(
    private readonly handler: (
      req: FireflyTransportRequest,
      index: number
    ) => FireflyTransportResponse
  ) {}
  async request(
    req: FireflyTransportRequest
  ): Promise<FireflyTransportResponse> {
    const res = this.handler(req, this.calls.length);
    this.calls.push(req);
    return res;
  }
}

const FAKE_TOKEN = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(
  '{"user_id":"u1"}'
).toString("base64url")}.sig`;

describe("extractResultLink", () => {
  it("优先响应头 x-override-status-link", () => {
    expect(
      extractResultLink(
        { "x-override-status-link": "https://poll/1" },
        { links: { result: "https://poll/2" } }
      )
    ).toBe("https://poll/1");
  });
  it("回落 body.links.result（字符串/对象）", () => {
    expect(extractResultLink({}, { links: { result: "https://poll/2" } })).toBe(
      "https://poll/2"
    );
    expect(
      extractResultLink({}, { links: { result: { href: "https://poll/3" } } })
    ).toBe("https://poll/3");
  });
  it("无则返回空", () => {
    expect(extractResultLink({}, {})).toBe("");
  });
});

describe("AdobeFireflyClient.generateImage", () => {
  it("提交→轮询→下载 闭环", async () => {
    const imgBytes = Buffer.from("PNGDATA");
    const api = new MockTransport((req, index) => {
      if (index === 0) {
        // submit
        expect(req.url).toContain("/v2/3p-images/generate-async");
        expect(req.headers["x-arp-session-id"]).toBeTruthy();
        expect(req.headers["x-nonce"]).toBeTruthy();
        return jsonResponse(
          200,
          { links: { result: "https://poll/abc" } },
          { "x-override-status-link": "https://poll/abc" }
        );
      }
      // poll
      return jsonResponse(200, {
        status: "COMPLETED",
        outputs: [{ image: { presignedUrl: "https://cdn/img.png" } }],
      });
    });
    const download = new MockTransport(() => bytesResponse(200, imgBytes));
    const client = new AdobeFireflyClient({
      transport: api,
      downloadTransport: download,
    });

    const out = await client.generateImage({
      token: FAKE_TOKEN,
      prompt: "a cat",
      aspectRatio: "16:9",
      outputResolution: "2K",
      upstreamModelId: "gpt-image",
      upstreamModelVersion: "2",
      pollIntervalMs: 1,
    });
    expect(out.bytes.toString("utf-8")).toBe("PNGDATA");
    expect(download.calls[0]?.url).toBe("https://cdn/img.png");
  });

  it("401 taste_exhausted → QuotaExhaustedError", async () => {
    const api = new MockTransport(() =>
      jsonResponse(401, {}, { "x-access-error": "taste_exhausted" })
    );
    const client = new AdobeFireflyClient({ transport: api });
    await expect(
      client.generateImage({
        token: FAKE_TOKEN,
        prompt: "x",
        aspectRatio: "1:1",
        outputResolution: "2K",
        upstreamModelId: "gpt-image",
        upstreamModelVersion: "2",
      })
    ).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it("401 普通 → AuthError", async () => {
    const api = new MockTransport(() => jsonResponse(401, {}));
    const client = new AdobeFireflyClient({ transport: api });
    await expect(
      client.generateImage({
        token: FAKE_TOKEN,
        prompt: "x",
        aspectRatio: "1:1",
        outputResolution: "2K",
        upstreamModelId: "gpt-image",
        upstreamModelVersion: "2",
      })
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("gpt-image 图生图：首候选 400 时回退下一候选", async () => {
    const api = new MockTransport((req, index) => {
      if (req.url.includes("generate-async")) {
        // 第一次 submit 候选 400，第二次 200
        if (index === 0) return jsonResponse(400, { error: "bad" });
        return jsonResponse(
          200,
          {},
          { "x-override-status-link": "https://poll/x" }
        );
      }
      return jsonResponse(200, {
        outputs: [{ image: { presignedUrl: "https://cdn/y.png" } }],
      });
    });
    const download = new MockTransport(() =>
      bytesResponse(200, Buffer.from("Y"))
    );
    const client = new AdobeFireflyClient({
      transport: api,
      downloadTransport: download,
    });
    const out = await client.generateImage({
      token: FAKE_TOKEN,
      prompt: "edit",
      aspectRatio: "1:1",
      outputResolution: "2K",
      upstreamModelId: "gpt-image",
      upstreamModelVersion: "2",
      sourceImageIds: ["img1"],
      pollIntervalMs: 1,
    });
    expect(out.bytes.toString("utf-8")).toBe("Y");
    // 至少两次 submit 候选 + 一次 poll
    const submits = api.calls.filter((c) => c.url.includes("generate-async"));
    expect(submits.length).toBeGreaterThanOrEqual(2);
  });
});
