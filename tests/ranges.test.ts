/*
 * 文件说明: 验证仪表盘日期和日期时间范围解析的业务默认值。
 */

import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { resolveDateTimeRange } from "../src/ranges.js";

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
