import { describe, expect, it } from "vitest";
import { getApiRateLimitType } from "./rate-limit-routing";

describe("API rate-limit routing", () => {
  it("keeps page image routes on AI request rate limiting", () => {
    expect(getApiRateLimitType("/api/images/generate")).toBe("ai");
    expect(getApiRateLimitType("/api/images/edit")).toBe("ai");
    expect(getApiRateLimitType("/api/images/chat")).toBe("ai");
  });

  it("lets external OpenAI-compatible routes enter their own queues", () => {
    expect(getApiRateLimitType("/v1/images/generations")).toBeNull();
    expect(getApiRateLimitType("/v1/images/edits")).toBeNull();
    expect(getApiRateLimitType("/v1/chat/completions")).toBeNull();
    expect(getApiRateLimitType("/v1/responses")).toBeNull();
    expect(getApiRateLimitType("/v1/agents/images")).toBeNull();
    expect(getApiRateLimitType("/api/v1/images/generations")).toBeNull();
  });
});
