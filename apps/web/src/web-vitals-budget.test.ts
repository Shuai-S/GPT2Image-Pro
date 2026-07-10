/**
 * Web Vitals 路由分组与预算边界测试。
 *
 * 覆盖 locale 路由、管理/创作/画布低基数分组、阈值等号边界和非法观测值。
 */

import { describe, expect, it } from "vitest";
import {
  classifyWebVitalRoute,
  evaluateWebVitalBudget,
} from "./web-vitals-budget";

describe("Web Vitals budgets", () => {
  it.each([
    ["/en", "public"],
    ["/zh/blog/post-slug", "public"],
    ["/en/docs/getting-started", "docs"],
    ["/en/dashboard", "dashboard"],
    ["/zh/dashboard/create", "create"],
    ["/en/dashboard/canvas/project-id", "canvas"],
    ["/en/dashboard/admin/settings", "admin"],
  ] as const)("把 %s 收敛为 %s", (pathname, expected) => {
    expect(classifyWebVitalRoute(pathname)).toBe(expected);
  });

  it("预算等号通过而更高值失败", () => {
    expect(evaluateWebVitalBudget("/en", "LCP", 3_000)).toMatchObject({
      valid: true,
      exceeded: false,
    });
    expect(evaluateWebVitalBudget("/en", "LCP", 3_001)).toMatchObject({
      valid: true,
      exceeded: true,
    });
    expect(
      evaluateWebVitalBudget("/en/dashboard/create", "INP", 251)
    ).toMatchObject({
      routeGroup: "create",
      budget: 250,
      exceeded: true,
    });
  });

  it("负数和非有限值无效且 fail-closed", () => {
    expect(evaluateWebVitalBudget("/en", "CLS", -1)).toMatchObject({
      valid: false,
      exceeded: true,
    });
    expect(evaluateWebVitalBudget("/en", "CLS", Number.NaN)).toMatchObject({
      valid: false,
      exceeded: true,
    });
  });
});
