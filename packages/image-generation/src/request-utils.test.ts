import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeSettingMock = vi.hoisted(() => vi.fn());
const storageMocks = vi.hoisted(() => {
  const putObject = vi.fn();
  const getSignedUrl = vi.fn();
  return {
    putObject,
    getSignedUrl,
    getStorageProvider: vi.fn(async () => ({
      putObject,
      getSignedUrl,
    })),
  };
});

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: runtimeSettingMock,
}));

vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: storageMocks.getStorageProvider,
}));

import { uploadTemporaryImageUrls } from "./request-utils";

beforeEach(() => {
  storageMocks.putObject.mockReset();
  storageMocks.getSignedUrl.mockReset();
  storageMocks.getStorageProvider.mockClear();
  runtimeSettingMock.mockReset();
});

describe("uploadTemporaryImageUrls", () => {
  it("returns absolute signed URLs for temporary images", async () => {
    runtimeSettingMock.mockImplementation(async (key: string) => {
      if (key === "CONTENT_MODERATION_PUBLIC_BASE_URL") {
        return "https://app.example.test";
      }
      if (key === "NEXT_PUBLIC_GENERATIONS_BUCKET_NAME") {
        return "generations";
      }
      return "";
    });
    storageMocks.getSignedUrl.mockResolvedValue(
      "/api/storage/generations/user-1/requests/gen-1-0.png?sig=abc&exp=123"
    );

    const result = await uploadTemporaryImageUrls("user-1", "gen-1", [
      new File([new Uint8Array([1, 2, 3])], "source.png", {
        type: "image/png",
      }),
    ]);

    expect(storageMocks.putObject).toHaveBeenCalledWith(
      "user-1/requests/gen-1-0.png",
      "generations",
      Buffer.from([1, 2, 3]),
      "image/png"
    );
    expect(storageMocks.getSignedUrl).toHaveBeenCalledWith(
      "user-1/requests/gen-1-0.png",
      "generations",
      15 * 60
    );
    expect(result).toEqual([
      {
        bucket: "generations",
        key: "user-1/requests/gen-1-0.png",
        url: "https://app.example.test/api/storage/generations/user-1/requests/gen-1-0.png?sig=abc&exp=123",
      },
    ]);
  });

  it("keeps external presigned storage URLs unchanged", async () => {
    runtimeSettingMock.mockImplementation(async (key: string) => {
      if (key === "STORAGE_ENDPOINT") return "https://r2.example.test";
      if (key === "NEXT_PUBLIC_GENERATIONS_BUCKET_NAME") {
        return "generations";
      }
      return "";
    });
    storageMocks.getSignedUrl.mockResolvedValue(
      "https://r2.example.test/generations/user-1/requests/gen-1-0.jpg?X-Amz-Signature=abc"
    );

    const result = await uploadTemporaryImageUrls("user-1", "gen-1", [
      new File([new Uint8Array([1])], "source.jpg", {
        type: "image/jpeg",
      }),
    ]);

    expect(result?.[0]?.url).toBe(
      "https://r2.example.test/generations/user-1/requests/gen-1-0.jpg?X-Amz-Signature=abc"
    );
  });
});
