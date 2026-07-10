/**
 * S3 对象正文有限读取测试。
 *
 * 直接构造 Web ReadableStream，覆盖正常拼接、边界值与超限 cancel；不初始化 AWS
 * 客户端或数据库，保证 shared 测试保持 DB-free。
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../../system-settings", () => ({
  getRuntimeSettingString: vi.fn(),
}));

import { readWebStreamWithLimit } from "./s3";

/** 根据字节块构造可观察 cancel 的流；keepOpen 用于验证超限主动中止。 */
function chunkStream(
  chunks: number[][],
  onCancel = vi.fn(),
  keepOpen = false
) {
  let index = 0;
  return {
    stream: new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index];
        index += 1;
        if (chunk) {
          controller.enqueue(Uint8Array.from(chunk));
          return;
        }
        if (keepOpen) {
          controller.enqueue(Uint8Array.from([0]));
        } else {
          controller.close();
        }
      },
      cancel: onCancel,
    }),
    onCancel,
  };
}

describe("readWebStreamWithLimit", () => {
  it("在上限内拼接全部字节", async () => {
    const { stream, onCancel } = chunkStream([
      [1, 2],
      [3, 4],
    ]);

    await expect(readWebStreamWithLimit(stream, 4)).resolves.toEqual(
      Buffer.from([1, 2, 3, 4])
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("累计字节超过上限时取消剩余读取", async () => {
    const { stream, onCancel } = chunkStream(
      [
        [1, 2],
        [3, 4],
      ],
      vi.fn(),
      true
    );

    await expect(readWebStreamWithLimit(stream, 3)).rejects.toThrow(
      "Stored object exceeds the configured read limit"
    );
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("拒绝非法上限", async () => {
    const { stream } = chunkStream([[1]]);

    await expect(readWebStreamWithLimit(stream, -1)).rejects.toThrow(
      "Invalid stored object read limit"
    );
  });
});
