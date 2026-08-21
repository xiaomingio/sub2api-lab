/*
 * 文件说明: 验证数据库查询任务的并发上限，避免页面批量查询占满连接池。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { runWithConcurrency } from "../src/server/db.js";

test("数据库查询任务遵守并发上限并保留任务顺序", async () => {
  let running = 0;
  let peak = 0;
  const results = await runWithConcurrency(
    Array.from({ length: 6 }, (_, index) => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return index;
    }),
    2
  );

  assert.equal(peak, 2);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
});
