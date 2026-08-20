/*
 * 文件说明: 验证成本分摊统计口径读取 usage_logs 成本基准的查询边界。
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Db } from "../src/server/db.js";
import { getUsageCostBasisReport } from "../src/shared/usage-costs.js";

test("系统余额口径不查询 usage_logs 费用基准", async () => {
  let queryCount = 0;
  const db = {
    pool: {
      async query() {
        queryCount += 1;
        return { rows: [] };
      }
    }
  } as unknown as Db;

  const report = await getUsageCostBasisReport({
    db,
    range: {
      start: new Date("2026-08-01T00:00:00.000+08:00"),
      end: new Date("2026-09-01T00:00:00.000+08:00")
    },
    basis: "balance",
    accountIds: [3, 1, 3]
  });

  assert.equal(queryCount, 0);
  assert.deepEqual(report, {
    rows: [],
    metric: null,
    accountIds: [1, 3]
  });
});
