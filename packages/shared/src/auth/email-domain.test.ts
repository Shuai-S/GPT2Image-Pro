import { describe, expect, it } from "vitest";

import {
  canonicalizeEmailForIdentity,
  isAllowedRegistrationEmail,
  normalizeEmail,
} from "./email-domain";

// 守护审计 C-M23（A8 防薅羊毛归一化）：同一真实邮箱的各种别名必须落到同一
// 身份键，否则一邮箱多注册重复领新人积分的口子会在回归时重开。
describe("canonicalizeEmailForIdentity", () => {
  it("Gmail 去点号并去 +tag，大小写无关", () => {
    expect(canonicalizeEmailForIdentity("V.I.C.T.I.M+promo@Gmail.com")).toBe(
      "victim@gmail.com"
    );
  });

  it("Googlemail 同样去点号（视作 Gmail 别名）", () => {
    expect(canonicalizeEmailForIdentity("a.b@googlemail.com")).toBe(
      "ab@googlemail.com"
    );
  });

  it("非 Gmail 域仅去 +tag，保留点号", () => {
    expect(canonicalizeEmailForIdentity("a.b+x@qq.com")).toBe("a.b@qq.com");
  });

  it("local 去标签后为空时回退原归一化地址", () => {
    expect(canonicalizeEmailForIdentity("+tag@qq.com")).toBe("+tag@qq.com");
  });

  it("无 @ 或 @ 在首位时原样返回归一化地址", () => {
    expect(canonicalizeEmailForIdentity("noat")).toBe("noat");
    expect(canonicalizeEmailForIdentity("@x.com")).toBe("@x.com");
  });

  it("先 trim/toLowerCase 再归一", () => {
    expect(canonicalizeEmailForIdentity("  Foo.Bar@GMAIL.com  ")).toBe(
      "foobar@gmail.com"
    );
  });
});

describe("normalizeEmail", () => {
  it("去首尾空白并转小写", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });
});

describe("isAllowedRegistrationEmail", () => {
  it("放行白名单域", () => {
    expect(isAllowedRegistrationEmail("a@gmail.com")).toBe(true);
    expect(isAllowedRegistrationEmail("a@qq.com")).toBe(true);
    expect(isAllowedRegistrationEmail("a@163.com")).toBe(true);
    expect(isAllowedRegistrationEmail("a@126.com")).toBe(true);
  });

  it("拒绝非白名单域与缺失域", () => {
    expect(isAllowedRegistrationEmail("a@outlook.com")).toBe(false);
    expect(isAllowedRegistrationEmail("a@googlemail.com")).toBe(false);
    expect(isAllowedRegistrationEmail("noat")).toBe(false);
    expect(isAllowedRegistrationEmail("")).toBe(false);
  });
});
