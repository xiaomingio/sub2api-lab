/*
 * 文件说明: 验证仪表盘日期和日期时间范围解析的业务默认值。
 */

import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { resolveDateRange, resolveDateTimeRange } from "../src/shared/ranges.js";

test("未指定时间范围时默认使用最近 14 天", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-17T05:46:00.000Z") });
  try {
    const range = resolveDateRange({ timezone: "Asia/Shanghai", defaultPreset: "last_14_days" });

    assert.equal(range.preset, "last_14_days");
    assert.equal(range.startDate, "2026-08-04");
    assert.equal(range.endDate, "2026-08-17");
  } finally {
    mock.timers.reset();
  }
});

test("成本分摊开始时间默认是 30 天前的本地 0 点", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-17T05:46:00.000Z") });
  try {
    const range = resolveDateTimeRange({
      timezone: "Asia/Shanghai",
      fallback: {
        start: new Date("2026-08-16T05:46:00.000Z"),
        end: new Date("2026-08-17T05:46:00.000Z")
      }
    });

    assert.equal(range.startAt, "2026-07-18T00:00");
    assert.equal(range.start.toISOString(), "2026-07-17T16:00:00.000Z");
    assert.equal(range.endAt, "2026-08-17T13:46");
  } finally {
    mock.timers.reset();
  }
});
