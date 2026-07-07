/**
 * Google 图像协议适配器测试。
 *
 * 职责：覆盖 Google 请求构造、模型兜底与多种响应解析形态，确保 pool-api 的
 * google 协议不再误走 OpenAI Bearer/响应解析。
 */
import { describe, expect, it } from "vitest";
import {
  buildGoogleImageRequest,
  buildGoogleImageResponseFormat,
  buildGoogleImageUrl,
  getGoogleImageHeaders,
  getGoogleImageModel,
  parseGoogleImagePayload,
} from "./google-image-protocol";

describe("google image protocol", () => {
  it("构造 Interactions API 请求体与 x-goog-api-key 头", () => {
    const body = buildGoogleImageRequest({
      model: "gemini-2.5-flash-image",
      prompt: "生成一张红色圆形图标",
      size: "1536x1024",
      outputFormat: "jpeg",
      images: [
        {
          data: Buffer.from("image-bytes"),
          name: "input.png",
          type: "image/png",
        },
      ],
    });

    expect(
      buildGoogleImageUrl("https://generativelanguage.googleapis.com/v1beta")
    ).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(getGoogleImageHeaders("secret")).toEqual({
      "Content-Type": "application/json",
      "x-goog-api-key": "secret",
    });
    expect(body.response_format).toEqual({
      type: "image",
      mime_type: "image/jpeg",
      aspect_ratio: "3:2",
      image_size: "2K",
    });
    expect(body.input).toContainEqual({
      type: "image",
      mime_type: "image/png",
      data: Buffer.from("image-bytes").toString("base64"),
    });
  });

  it("Google 后端优先使用配置模型，避免把 gpt-image 请求名发给 Google", () => {
    expect(getGoogleImageModel("gpt-image-2", "gemini-3.1-flash-image")).toBe(
      "gemini-3.1-flash-image"
    );
    expect(getGoogleImageModel("gpt-image-2")).toBe("gemini-2.5-flash-image");
    expect(getGoogleImageModel("gemini-custom-image")).toBe(
      "gemini-custom-image"
    );
  });

  it("从 Interactions / generateContent / Imagen 响应解析图片", () => {
    expect(
      parseGoogleImagePayload({
        output_image: { data: "base64-a", mime_type: "image/png" },
      }).imageBase64
    ).toBe("base64-a");

    expect(
      parseGoogleImagePayload({
        candidates: [
          {
            content: {
              parts: [
                { text: "已生成" },
                { inlineData: { data: "base64-b", mimeType: "image/png" } },
              ],
            },
          },
        ],
      })
    ).toMatchObject({
      imageBase64: "base64-b",
      responseText: "已生成",
    });

    expect(
      parseGoogleImagePayload({
        predictions: [{ bytesBase64Encoded: "base64-c" }],
      }).imageBase64
    ).toBe("base64-c");
  });

  it("无法解析尺寸时保留安全默认响应格式", () => {
    expect(buildGoogleImageResponseFormat({ size: "auto" })).toEqual({
      type: "image",
      mime_type: "image/png",
    });
  });
});
