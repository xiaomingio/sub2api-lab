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

test("传入当前时间时使用固定时间计算默认范围", () => {
  const range = resolveDateRange({
    timezone: "Asia/Shanghai",
    defaultPreset: "last_14_days",
    now: new Date("2025-01-15T02:30:00.000Z")
  });

  assert.equal(range.startDate, "2025-01-02");
  assert.equal(range.endDate, "2025-01-15");
  assert.equal(range.end.toISOString(), "2025-01-15T16:00:00.000Z");
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


test("夏令时切换日按本地自然日统计 23 或 25 小时", () => {
  for (const [now, expectedStart, expectedEnd] of [
    ["2026-03-08T12:00:00Z", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"],
    ["2026-11-01T12:00:00Z", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"]
  ]) {
    const range = resolveDateRange({ preset: "today", timezone: "America/New_York", defaultPreset: "today", now: new Date(now!) });
    assert.equal(range.start.toISOString(), expectedStart);
    assert.equal(range.end.toISOString(), expectedEnd);
    assert.equal(range.startDate, range.endDate);
  }
});

test("自定义日期和跨夏令时的近七天均以本地零点为界", () => {
  const base = { timezone: "America/New_York", defaultPreset: "today", now: new Date("2026-03-10T12:00:00Z") };
  const custom = resolveDateRange({ ...base, preset: "custom", startDate: "2026-03-08", endDate: "2026-03-08" });
  assert.equal(custom.end.toISOString(), "2026-03-09T04:00:00.000Z");
  const week = resolveDateRange({ ...base, preset: "last_7_days" });
  assert.equal(week.start.toISOString(), "2026-03-04T05:00:00.000Z");
});
