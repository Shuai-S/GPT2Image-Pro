/**
 * 普通 generation HTTP 幂等纯协议测试。
 *
 * 锁定 Idempotency-Key 边界，以及请求哈希只覆盖业务标量、callback 和媒体真实内容，
 * 不受服务端生成的 generation ID 与创建时间影响。
 */

import { describe, expect, it } from "vitest";
import {
  GenerationTaskIdempotencyKeyError,
  hashGenerationTaskRequest,
  readGenerationIdempotencyKey,
} from "./generation-task-idempotency";
import type { GenerationTaskInputObject } from "./generation-task-input";

const request = {
  kind: "image_edit" as const,
  generationIds: ["generation-1", "generation-2"],
  createdAtEpochSeconds: 1_788_000_000,
  responseFormat: "url" as const,
  input: {
    prompt: "remove background",
    model: "gpt-image-2",
    size: "1024x1024",
  },
};

const sourceMediaInput: GenerationTaskInputObject = {
  data: Buffer.from("source-bytes"),
  name: "source.png",
  contentType: "image/png",
  role: "source",
};
const mediaInputs: readonly GenerationTaskInputObject[] = [sourceMediaInput];

describe("generation task idempotency", () => {
  it("未提供 header 时保持非幂等行为，提供时 trim", () => {
    expect(
      readGenerationIdempotencyKey(
        new Request("https://api.example.test/v1/images/generations")
      )
    ).toBeUndefined();
    expect(
      readGenerationIdempotencyKey(
        new Request("https://api.example.test/v1/images/generations", {
          headers: { "Idempotency-Key": "  request-1  " },
        })
      )
    ).toBe("request-1");
    expect(
      readGenerationIdempotencyKey(
        new Request("https://api.example.test/v1/images/generations", {
          headers: { "Idempotency-Key": "x".repeat(255) },
        })
      )
    ).toHaveLength(255);
  });

  it("拒绝 trim 后为空或超过 255 字符的 key", () => {
    for (const value of ["   ", "x".repeat(256)]) {
      expect(() =>
        readGenerationIdempotencyKey(
          new Request("https://api.example.test/v1/images/generations", {
            headers: { "Idempotency-Key": value },
          })
        )
      ).toThrow(GenerationTaskIdempotencyKeyError);
    }
  });

  it("服务端 generation IDs 与创建时间变化不影响稳定哈希", () => {
    const first = hashGenerationTaskRequest({
      request,
      callbackUrl: "https://callback.example.test/result",
      mediaInputs,
    });
    const replay = hashGenerationTaskRequest({
      request: {
        ...request,
        generationIds: ["other-1", "other-2"],
        createdAtEpochSeconds: 1_788_999_999,
      },
      callbackUrl: "https://callback.example.test/result",
      mediaInputs,
    });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(replay).toBe(first);
  });

  it("媒体真实字节变化会改变哈希，文件名变化不会", () => {
    const baseline = hashGenerationTaskRequest({
      request,
      mediaInputs,
    });
    expect(
      hashGenerationTaskRequest({
        request,
        mediaInputs: [{ ...sourceMediaInput, name: "renamed.png" }],
      })
    ).toBe(baseline);
    expect(
      hashGenerationTaskRequest({
        request,
        mediaInputs: [
          { ...sourceMediaInput, data: Buffer.from("different-bytes") },
        ],
      })
    ).not.toBe(baseline);
  });

  it("callback、MIME、role 与批量数量均属于业务语义", () => {
    const baseline = hashGenerationTaskRequest({ request, mediaInputs });
    expect(
      hashGenerationTaskRequest({
        request,
        callbackUrl: "https://callback.example.test/result",
        mediaInputs,
      })
    ).not.toBe(baseline);
    expect(
      hashGenerationTaskRequest({
        request,
        mediaInputs: [{ ...sourceMediaInput, contentType: "image/webp" }],
      })
    ).not.toBe(baseline);
    expect(
      hashGenerationTaskRequest({
        request,
        mediaInputs: [{ ...sourceMediaInput, role: "mask" }],
      })
    ).not.toBe(baseline);
    expect(
      hashGenerationTaskRequest({
        request: { ...request, generationIds: ["generation-1"] },
        mediaInputs,
      })
    ).not.toBe(baseline);
  });
});
