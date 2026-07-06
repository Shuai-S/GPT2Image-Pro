/**
 * IP 地址 SSRF 封堵表驱动测试。
 *
 * 覆盖 IPv4、IPv6 与 IPv4-mapped IPv6 的私有/保留地址段，避免
 * DNS pinning 与外部图片抓取路径漏放不可路由地址。
 */

import { describe, expect, it } from "vitest";

import { isBlockedIP, isPrivateIPv4, isPrivateIPv6 } from "./ip-validation";

describe("isPrivateIPv4", () => {
  it.each([
    ["0.0.0.0", true],
    ["10.1.2.3", true],
    ["100.64.0.1", true],
    ["100.127.255.255", true],
    ["100.128.0.1", false],
    ["127.0.0.1", true],
    ["169.254.169.254", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false],
    ["192.0.0.8", true],
    ["192.0.2.1", true],
    ["192.168.1.1", true],
    ["198.18.0.1", true],
    ["198.19.255.255", true],
    ["198.51.100.7", true],
    ["203.0.113.7", true],
    ["224.0.0.1", true],
    ["255.255.255.255", true],
    ["8.8.8.8", false],
    ["93.184.216.34", false],
  ])("classifies %s as blocked=%s", (ip, expected) => {
    expect(isPrivateIPv4(ip)).toBe(expected);
  });
});

describe("isPrivateIPv6", () => {
  it.each([
    ["::", true],
    ["::1", true],
    ["[::1]", true],
    ["fc00::1", true],
    ["fd12:3456::1", true],
    ["fe80::1", true],
    ["febf::1", true],
    ["fec0::1", false],
    ["ff02::1", true],
    ["2001:db8::1", true],
    ["2001:0::1", true],
    ["2002::1", true],
    ["2001:4860:4860::8888", false],
    ["2606:4700:4700::1111", false],
  ])("classifies %s as blocked=%s", (ip, expected) => {
    expect(isPrivateIPv6(ip)).toBe(expected);
  });

  it.each([
    ["::ffff:192.168.1.1", true],
    ["::ffff:8.8.8.8", false],
    ["::ffff:c0a8:0101", true],
    ["0:0:0:0:0:ffff:c0a8:0101", true],
    ["::ffff:0808:0808", false],
  ])("classifies IPv4-mapped %s as blocked=%s", (ip, expected) => {
    expect(isPrivateIPv6(ip)).toBe(expected);
  });
});

describe("isBlockedIP", () => {
  it.each([
    ["192.168.1.1", true],
    ["8.8.8.8", false],
    ["[::1]", true],
    ["::ffff:c0a8:0101", true],
    ["2606:4700:4700::1111", false],
  ])("dispatches %s to the correct IP family", (ip, expected) => {
    expect(isBlockedIP(ip)).toBe(expected);
  });
});
