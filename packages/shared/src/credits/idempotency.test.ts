import { describe, expect, it } from "vitest";

import {
  assertIdempotentCreditAmount,
  isUniqueConstraintViolation,
  readConsumedBatchesFromMetadata,
} from "./idempotency";

describe("assertIdempotentCreditAmount", () => {
  it("允许等价的两位小数金额", () => {
    expect(() => assertIdempotentCreditAmount(12.3, 12.3)).not.toThrow();
    expect(() => assertIdempotentCreditAmount(12.304, 12.3)).not.toThrow();
  });

  it("拒绝同一幂等键的金额漂移与非法金额", () => {
    expect(() => assertIdempotentCreditAmount(12.3, 12.31)).toThrow(
      "同一积分幂等键的金额不一致"
    );
    expect(() => assertIdempotentCreditAmount(Number.NaN, 12.3)).toThrow(
      "同一积分幂等键的金额不一致"
    );
  });
});

describe("readConsumedBatchesFromMetadata", () => {
  it("returns batches from valid metadata", () => {
    expect(
      readConsumedBatchesFromMetadata({
        serviceName: "image-generation",
        consumedBatches: [
          { batchId: "b1", consumedFromBatch: 2 },
          { batchId: "b2", consumedFromBatch: 1.5 },
        ],
      })
    ).toEqual([
      { batchId: "b1", consumedFromBatch: 2 },
      { batchId: "b2", consumedFromBatch: 1.5 },
    ]);
  });

  it("filters out malformed entries", () => {
    expect(
      readConsumedBatchesFromMetadata({
        consumedBatches: [
          { batchId: "ok", consumedFromBatch: 1 },
          { batchId: 123, consumedFromBatch: 1 },
          { batchId: "missing-amount" },
          { consumedFromBatch: 5 },
          null,
          "nope",
          { batchId: "bad-amount", consumedFromBatch: "x" },
        ],
      })
    ).toEqual([{ batchId: "ok", consumedFromBatch: 1 }]);
  });

  it("returns empty for missing / non-array / non-object inputs", () => {
    expect(readConsumedBatchesFromMetadata(undefined)).toEqual([]);
    expect(readConsumedBatchesFromMetadata(null)).toEqual([]);
    expect(readConsumedBatchesFromMetadata("string")).toEqual([]);
    expect(readConsumedBatchesFromMetadata({})).toEqual([]);
    expect(
      readConsumedBatchesFromMetadata({ consumedBatches: "not-array" })
    ).toEqual([]);
    expect(readConsumedBatchesFromMetadata({ consumedBatches: {} })).toEqual(
      []
    );
  });
});

describe("isUniqueConstraintViolation", () => {
  it("detects Postgres 23505 errors", () => {
    expect(isUniqueConstraintViolation({ code: "23505" })).toBe(true);
    expect(
      isUniqueConstraintViolation(
        Object.assign(new Error("dup"), { code: "23505" })
      )
    ).toBe(true);
  });

  it("rejects other errors / shapes", () => {
    expect(isUniqueConstraintViolation({ code: "23503" })).toBe(false);
    expect(isUniqueConstraintViolation(new Error("boom"))).toBe(false);
    expect(isUniqueConstraintViolation(null)).toBe(false);
    expect(isUniqueConstraintViolation("23505")).toBe(false);
    expect(isUniqueConstraintViolation({ code: 23505 })).toBe(false);
  });
});
