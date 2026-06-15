import { describe, expect, it } from "vitest";

import {
  buildGenerationBillingPolicy,
  getImageSuccessTargetCredits,
  getInitialGenerationCharge,
  getModerationFailureCharge,
  getTextChatSuccessTargetCredits,
} from "./billing-policy";

const creditCost = {
  totalCredits: 6,
  moderationOnlyCredits: 0.1,
};

describe("generation billing policy", () => {
  it("charges full image/chat credits when using site resources", () => {
    const policy = buildGenerationBillingPolicy({
      useSiteImageCredits: true,
      moderationEnabled: true,
    });

    expect(policy.mode).toBe("full");
    expect(
      getInitialGenerationCharge({
        policy,
        isChatInput: false,
        chatRoundCredits: 1,
        creditCost,
      })
    ).toBe(6);
    expect(
      getInitialGenerationCharge({
        policy,
        isChatInput: true,
        chatRoundCredits: 1,
        creditCost,
      })
    ).toBe(1);
    expect(
      getImageSuccessTargetCredits({
        policy,
        isChatInput: true,
        chatRoundCredits: 1,
        chatRoundCount: 3,
        actualImageCredits: 12,
        creditCost,
      })
    ).toBe(15);
  });

  it("charges only moderation when the upstream image API is user supplied", () => {
    const policy = buildGenerationBillingPolicy({
      useSiteImageCredits: false,
      moderationEnabled: true,
    });

    expect(policy.mode).toBe("moderation_only");
    expect(
      getInitialGenerationCharge({
        policy,
        isChatInput: false,
        chatRoundCredits: 1,
        creditCost,
      })
    ).toBe(0.1);
    expect(
      getTextChatSuccessTargetCredits({
        policy,
        chatRoundCredits: 1,
        chatRoundCount: 5,
        creditCost,
      })
    ).toBe(0.1);
    expect(
      getImageSuccessTargetCredits({
        policy,
        isChatInput: true,
        chatRoundCredits: 1,
        chatRoundCount: 5,
        actualImageCredits: 24,
        creditCost,
      })
    ).toBe(0.1);
  });

  it("charges nothing for user supplied upstreams when moderation is disabled", () => {
    const policy = buildGenerationBillingPolicy({
      useSiteImageCredits: false,
      moderationEnabled: false,
    });

    expect(policy.mode).toBe("none");
    expect(
      getInitialGenerationCharge({
        policy,
        isChatInput: false,
        chatRoundCredits: 1,
        creditCost,
      })
    ).toBe(0);
    expect(
      getImageSuccessTargetCredits({
        policy,
        isChatInput: false,
        chatRoundCredits: 1,
        chatRoundCount: 1,
        actualImageCredits: 24,
        creditCost,
      })
    ).toBe(0);
  });

  it("keeps moderation-only billing for moderation failures on user upstreams", () => {
    const policy = buildGenerationBillingPolicy({
      useSiteImageCredits: false,
      moderationEnabled: true,
    });

    expect(
      getModerationFailureCharge({
        policy,
        moderationOnlyFailureSettlement: false,
        isChatInput: false,
        chatRoundCredits: 1,
        chatModerationOnlyCredits: 0.04,
        creditCost,
        initialCreditCharge: 6,
      })
    ).toBe(0.1);
  });
});
