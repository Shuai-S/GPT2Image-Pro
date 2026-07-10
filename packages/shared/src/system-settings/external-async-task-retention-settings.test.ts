/**
 * 外部异步任务终态保留设置定义测试。
 *
 * 锁定后台设置面板所消费的默认值和写入范围；不访问数据库。
 */

import { describe, expect, it } from "vitest";

import { SETTING_DEFINITION_BY_KEY } from "./definitions";

describe("external async task retention settings", () => {
  it("声明安全默认、硬上限和调度间隔", () => {
    expect(
      SETTING_DEFINITION_BY_KEY.get("EXTERNAL_ASYNC_TASK_RETENTION_DAYS")
    ).toMatchObject({ defaultValue: 30, min: 1, max: 3650 });
    expect(
      SETTING_DEFINITION_BY_KEY.get("EXTERNAL_ASYNC_TASK_RETENTION_BATCH_SIZE")
    ).toMatchObject({ defaultValue: 500, min: 1, max: 5000 });
    expect(
      SETTING_DEFINITION_BY_KEY.get(
        "INTERNAL_JOB_EXTERNAL_ASYNC_TASK_RETENTION_INTERVAL_MINUTES"
      )
    ).toMatchObject({ defaultValue: 1440, min: 1, max: 10080 });
  });
});
