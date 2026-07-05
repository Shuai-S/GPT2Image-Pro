import { describe, expect, it } from "vitest";

import {
  canonicalizeEmailForIdentity,
  DEFAULT_REGISTRATION_EMAIL_DOMAIN_LIST,
  formatRegistrationEmailDomains,
  isAllowedRegistrationEmail,
  normalizeEmail,
  normalizeRegistrationEmailDomains,
  parseRegistrationEmailDomains,
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

  it("支持调用方传入运行时邮箱后缀白名单", () => {
    expect(isAllowedRegistrationEmail("a@outlook.com", ["outlook.com"])).toBe(
      true
    );
    expect(isAllowedRegistrationEmail("a@gmail.com", ["outlook.com"])).toBe(
      false
    );
  });
});

describe("normalizeRegistrationEmailDomains", () => {
  it("解析多种分隔符、去重、去 @ 前缀并转小写", () => {
    expect(
      normalizeRegistrationEmailDomains(" @GMAIL.com, qq.com；163.com\nqq.com ")
    ).toEqual({
      domains: ["gmail.com", "qq.com", "163.com"],
      invalidDomains: [],
    });
  });

  it("返回无效域名列表供系统设置写入时报错", () => {
    expect(normalizeRegistrationEmailDomains("gmail.com, bad_domain")).toEqual({
      domains: ["gmail.com"],
      invalidDomains: ["bad_domain"],
    });
  });
});

describe("parseRegistrationEmailDomains", () => {
  it("空配置或全无有效项时回退默认注册邮箱后缀", () => {
    expect(parseRegistrationEmailDomains("")).toEqual(
      DEFAULT_REGISTRATION_EMAIL_DOMAIN_LIST
    );
    expect(parseRegistrationEmailDomains("bad_domain")).toEqual(
      DEFAULT_REGISTRATION_EMAIL_DOMAIN_LIST
    );
  });

  it("有有效项时返回规范化后的有效域名", () => {
    expect(parseRegistrationEmailDomains("@Outlook.com, bad_domain")).toEqual([
      "outlook.com",
    ]);
  });
});

describe("formatRegistrationEmailDomains", () => {
  it("按逗号格式化邮箱后缀用于存储", () => {
    expect(formatRegistrationEmailDomains(["gmail.com", "qq.com"])).toBe(
      "gmail.com,qq.com"
    );
  });
});
