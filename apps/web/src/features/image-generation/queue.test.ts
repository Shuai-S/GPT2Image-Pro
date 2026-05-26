import { describe, expect, it, vi } from "vitest";

const runtimeSettings = vi.hoisted(() => ({
  globalConcurrency: 500,
}));

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingNumber: vi.fn(async () => runtimeSettings.globalConcurrency),
}));

import { withImageGenerationQueue } from "./queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function flushTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("withImageGenerationQueue", () => {
  it("limits running tasks by the configured global concurrency", async () => {
    runtimeSettings.globalConcurrency = 1;
    const first = deferred<string>();
    const started: string[] = [];

    const firstRun = withImageGenerationQueue(
      {
        userId: "user-a",
        priority: "normal",
        userConcurrency: 10,
      },
      async () => {
        started.push("first");
        return await first.promise;
      }
    );
    const secondRun = withImageGenerationQueue(
      {
        userId: "user-b",
        priority: "normal",
        userConcurrency: 10,
      },
      async () => {
        started.push("second");
        return "second";
      }
    );

    await flushTasks();
    expect(started).toEqual(["first"]);

    first.resolve("first");
    await firstRun;
    await flushTasks();

    expect(started).toEqual(["first", "second"]);
    await expect(secondRun).resolves.toBe("second");
  });
});
