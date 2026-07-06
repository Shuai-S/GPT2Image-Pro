/**
 * 本地图片缓存键测试
 *
 * 验证签名 URL 在本地缓存层会归一化为稳定键，避免刷新页面后因 sig/exp
 * 变化重新下载同一张图片。运行于 DB-free vitest node 环境。
 */

import { describe, expect, it } from "vitest";
import { normalizeImageCacheKey } from "./local-image-cache";

describe("normalizeImageCacheKey", () => {
  it("移除同源存储图片的 sig/exp 参数并保留路径宽度段", () => {
    const result = normalizeImageCacheKey(
      "/api/storage/generations/w640/user/a.png?sig=one&exp=123",
      "https://example.com/dashboard"
    );

    expect(result).toBe(
      "https://example.com/api/storage/generations/w640/user/a.png"
    );
  });

  it("保留非签名业务参数并按键值排序", () => {
    const result = normalizeImageCacheKey(
      "/api/storage/generations/a.png?b=2&sig=x&a=1&exp=9",
      "https://example.com/dashboard"
    );

    expect(result).toBe(
      "https://example.com/api/storage/generations/a.png?a=1&b=2"
    );
  });

  it("同一图片不同签名得到同一个缓存键", () => {
    const left = normalizeImageCacheKey(
      "/api/storage/generations/a.png?sig=left&exp=1",
      "https://example.com/dashboard"
    );
    const right = normalizeImageCacheKey(
      "/api/storage/generations/a.png?sig=right&exp=2",
      "https://example.com/dashboard"
    );

    expect(left).toBe(right);
  });

  it("拒绝 data/blob 与跨源 URL，避免缓存不可控来源", () => {
    expect(
      normalizeImageCacheKey("data:image/png;base64,aaa", "https://e.com")
    ).toBeNull();
    expect(
      normalizeImageCacheKey("blob:https://e.com/a", "https://e.com")
    ).toBeNull();
    expect(
      normalizeImageCacheKey(
        "https://cdn.example.com/a.png",
        "https://example.com"
      )
    ).toBeNull();
  });
});
