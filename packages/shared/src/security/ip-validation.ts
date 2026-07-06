/**
 * IP 地址安全校验工具函数。
 *
 * 纯函数，零依赖。用于 SSRF 防护中判定解析出的 IP 是否属于私有/保留地址段。
 * 被 dns-pin.ts 与 safe-image-fetch.ts 共同复用。
 *
 * 覆盖段（RFC 1918 / RFC 4193 / RFC 5737 等）：
 * - IPv4: 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10 (CGNAT), 127.0.0.0/8,
 *   169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.168.0.0/16,
 *   198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0+
 * - IPv6: ::1, ::, fc00::/7 (ULA), fe80::/10 (link-local),
 *   ff00::/8 (multicast), 2001:db8::/32 (documentation), ::ffff:mapped
 */

/**
 * 判定 IPv4 地址是否为私有/保留/不可路由地址。
 *
 * @param ip 点分十进制 IPv4 字符串，如 "10.0.0.1"
 * @returns true 表示该地址不应被外部请求访问
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;

  const octets = parts.map(Number);
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;

  const [a, b] = octets as [number, number, number, number];

  // 0.0.0.0/8 - "this" network
  if (a === 0) return true;
  // 10.0.0.0/8 - RFC 1918
  if (a === 10) return true;
  // 100.64.0.0/10 - CGNAT (含阿里云元数据 100.100.x.x)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 - loopback
  if (a === 127) return true;
  // 169.254.0.0/16 - link-local / 云元数据
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 - RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 - IETF protocol assignments / reserved
  if (a === 192 && b === 0 && octets[2] === 0) return true;
  // 192.0.2.0/24 - TEST-NET-1
  if (a === 192 && b === 0 && octets[2] === 2) return true;
  // 192.168.0.0/16 - RFC 1918
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 - 基准测试
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 - TEST-NET-2
  if (a === 198 && b === 51 && octets[2] === 100) return true;
  // 203.0.113.0/24 - TEST-NET-3
  if (a === 203 && b === 0 && octets[2] === 113) return true;
  // 224.0.0.0+ - 组播与保留
  if (a >= 224) return true;

  return false;
}

/**
 * 从 IPv4-mapped IPv6 中提取内嵌 IPv4。
 *
 * @param ip 已清理和小写后的 IPv6 字符串。
 * @returns 点分十进制 IPv4；非 mapped 格式时返回 null。
 */
function extractMappedIPv4(ip: string): string | null {
  const dottedPrefix = "::ffff:";
  if (ip.startsWith(dottedPrefix)) {
    const embedded = ip.slice(dottedPrefix.length);
    if (embedded.includes(".")) return embedded;

    const parts = embedded.split(":");
    if (parts.length === 2) {
      const high = Number.parseInt(parts[0] ?? "", 16);
      const low = Number.parseInt(parts[1] ?? "", 16);
      if (
        Number.isInteger(high) &&
        Number.isInteger(low) &&
        high >= 0 &&
        high <= 0xffff &&
        low >= 0 &&
        low <= 0xffff
      ) {
        return [
          high >> 8,
          high & 0xff,
          low >> 8,
          low & 0xff,
        ].join(".");
      }
    }
  }

  const expandedPrefix = "0:0:0:0:0:ffff:";
  if (ip.startsWith(expandedPrefix)) {
    return extractMappedIPv4(`::ffff:${ip.slice(expandedPrefix.length)}`);
  }

  return null;
}

/**
 * 判定 IPv6 地址是否为私有/保留/不可路由地址。
 *
 * @param ip 标准化后的 IPv6 字符串（含或不含方括号均可）
 * @returns true 表示该地址不应被外部请求访问
 */
export function isPrivateIPv6(ip: string): boolean {
  // 去除可能的方括号
  const cleaned = ip.replace(/^\[|\]$/g, "").toLowerCase();
  const [first = "", second = ""] = cleaned.split(":");
  const secondValue = Number.parseInt(second || "0", 16);

  // ::1 loopback
  if (cleaned === "::1" || cleaned === "0:0:0:0:0:0:0:1") return true;
  // :: 未指定地址
  if (cleaned === "::") return true;
  // fe80::/10 link-local (fe80 ~ febf)
  if (/^fe[89ab]/.test(first)) return true;
  // fc00::/7 - ULA (fc00:: ~ fdff::)
  if (cleaned.startsWith("fc") || cleaned.startsWith("fd")) return true;
  // ff00::/8 - multicast
  if (first.startsWith("ff")) return true;
  // 2001:db8::/32 - documentation
  if (first === "2001" && second === "db8") return true;
  // 2001::/32 - Teredo / special-purpose
  if (first === "2001" && secondValue === 0) return true;
  // 2002::/16 - 6to4, may tunnel private IPv4 destinations
  if (first === "2002") return true;

  // ::ffff:x.x.x.x / ::ffff:hhhh:hhhh - IPv4-mapped IPv6
  const mappedIPv4 = extractMappedIPv4(cleaned);
  if (mappedIPv4) {
    return isPrivateIPv4(mappedIPv4);
  }

  return false;
}

/**
 * 综合判定任意 IP（v4 或 v6）是否属于被封堵的私有/保留地址。
 *
 * @param ip IP 地址字符串
 * @returns true 表示该 IP 应被 SSRF 防护阻断
 */
export function isBlockedIP(ip: string): boolean {
  const cleaned = ip.replace(/^\[|\]$/g, "");

  // 判断是否为 IPv4（含点分十进制）
  if (cleaned.includes(".") && !cleaned.includes(":")) {
    return isPrivateIPv4(cleaned);
  }

  // IPv6（含 IPv4-mapped）
  return isPrivateIPv6(cleaned);
}
