import { describe, expect, it } from "vitest";

import {
  decodeBase64DataUrl,
  editableFileExtension,
  editableFileServiceName,
  NO_WEB_ACCOUNT_ERROR,
} from "./editable-file-util";

describe("decodeBase64DataUrl", () => {
  it("解 data URL:取出 mime + 二进制", () => {
    const r = decodeBase64DataUrl("data:image/png;base64,aGVsbG8=", 1);
    expect(r.type).toBe("image/png");
    expect(r.data.toString("utf-8")).toBe("hello");
    expect(r.name).toBe("input_1.png");
  });

  it("解裸 base64:mime 回退 image/png", () => {
    const r = decodeBase64DataUrl("aGVsbG8=", 2);
    expect(r.type).toBe("image/png");
    expect(r.data.toString("utf-8")).toBe("hello");
    expect(r.name).toBe("input_2.png");
  });

  it("data URL 的 image/svg+xml → 扩展名取 svg", () => {
    const r = decodeBase64DataUrl(
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      3
    );
    expect(r.type).toBe("image/svg+xml");
    expect(r.name).toBe("input_3.svg");
  });
});

describe("editableFileExtension / serviceName", () => {
  it("主文件按 kind、zip 恒 zip", () => {
    expect(editableFileExtension("ppt", false)).toBe("pptx");
    expect(editableFileExtension("psd", false)).toBe("psd");
    expect(editableFileExtension("ppt", true)).toBe("zip");
    expect(editableFileExtension("psd", true)).toBe("zip");
  });

  it("服务名区分 ppt/psd", () => {
    expect(editableFileServiceName("ppt")).toBe("editable_file_ppt");
    expect(editableFileServiceName("psd")).toBe("editable_file_psd");
  });
});

describe("NO_WEB_ACCOUNT_ERROR", () => {
  // 该消息必须含 "no available backend",否则 external-api 会把"无 web 账号"误判成
  // 502 upstream_error(可疯狂重试)而非 503 no_available_image_backend。改文案勿动此子串。
  it("含 503 分类所需子串", () => {
    expect(NO_WEB_ACCOUNT_ERROR.toLowerCase()).toContain("no available backend");
  });
});
