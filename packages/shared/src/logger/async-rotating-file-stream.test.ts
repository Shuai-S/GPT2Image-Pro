/**
 * 异步轮转文件日志流测试
 *
 * 验证系统运行日志超过阈值时会轮转为带时间戳的 gzip 文件，且 write 调用只负责
 * 入队，不等待文件 I/O 完成。
 */

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createAsyncRotatingFileStream } from "./async-rotating-file-stream";

const gunzipAsync = promisify(gunzip);

const tempDirs: string[] = [];

/**
 * 创建临时测试目录
 *
 * @returns 新建的临时目录路径。
 */
async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gpt2image-log-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("createAsyncRotatingFileStream", () => {
  it("异步写入日志并在超过阈值时按时间点 gzip 保存旧文件", async () => {
    const directory = await createTempDir();
    const filePath = join(directory, "system.log");
    const stream = createAsyncRotatingFileStream({
      filePath,
      maxBytes: 32,
    });

    stream.write("first log line\n");
    stream.write("second log line\n");
    stream.write("third log line\n");
    await stream.flush();

    const files = await readdir(directory);
    const archiveName = files.find((file) =>
      /^system-\d{4}-\d{2}-\d{2}T.*\.log\.gz$/.test(file)
    );

    expect(archiveName).toBeDefined();
    expect(files).toContain("system.log");

    const archiveBuffer = await readFile(join(directory, archiveName ?? ""));
    const archiveContent = (await gunzipAsync(archiveBuffer)).toString("utf8");
    const activeContent = await readFile(filePath, "utf8");

    expect(archiveContent).toBe("first log line\nsecond log line\n");
    expect(activeContent).toBe("third log line\n");
  });
});
