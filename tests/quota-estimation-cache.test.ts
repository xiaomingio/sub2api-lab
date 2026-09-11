/*
 * 文件说明: 验证额度估算并发合并、输入复用、日志补写失效和查询失败后的重试。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getQuotaEstimation } from "../src/server/quota-estimation.js";
import { QuotaEstimator } from "../src/shared/QuotaEstimator.js";
import type { Db, LabDb } from "../src/server/db.js";
import type { QuotaInterval } from "../src/shared/quota-estimation.js";

const at = (hour: number) => new Date(Date.parse("2026-09-01T00:00:00Z") + hour * 3_600_000);

test("相同边界并发合并，输入不变复用拟合，日志补写及快照变化重新计算", async (t) => {
  const fit = t.mock.method(QuotaEstimator.prototype, "estimate");
  let snapshotReads = 0;
  let tokens = 1e6;
  let percent = 1;
  let fail = false;
  const labDb = { pool: { async query() {
    snapshotReads++;
    if (fail) throw new Error("快照读取失败");
    return { rows: Array.from({ length: 40 }, (_, i) => ({ accountId: 1, accountName: "A",
      sampledAt: at(i + 1).toISOString(), updatedAt: at(i + 1).toISOString(), resetAt: at(168).toISOString(), percent: (i + 1) * percent })) };
  } } } as unknown as LabDb;
  const db = { pool: { async query(_sql: string, values?: unknown[]) {
    if (!values) return { rows: [{ id: 1, name: "A" }] };
    const intervals = JSON.parse(values[0] as string) as QuotaInterval[];
    return { rows: intervals.map((row) => ({ id: row.id, model: "M", input: tokens, output: 0, cacheRead: 0, cacheCreation: 0 })) };
  } } } as unknown as Db;
  const params = { db, labDb, hours: 72 as const, now: at(48), timezone: "UTC", sub2apiBaseUrl: "" };
  const [first, concurrent] = await Promise.all([getQuotaEstimation(params), getQuotaEstimation(params)]);
  assert.deepEqual(first, concurrent);
  assert.equal(snapshotReads, 1);
  assert.equal(fit.mock.callCount(), 1);
  const later = await getQuotaEstimation({ ...params, now: at(48.01) });
  assert.equal(later.end, at(48.01).toISOString());
  assert.equal(fit.mock.callCount(), 1);
  tokens *= 2;
  const backfilled = await getQuotaEstimation(params);
  assert.equal(fit.mock.callCount(), 2);
  assert.ok(Math.abs(backfilled.accounts[0]!.models[0]!.capacity! / first.accounts[0]!.models[0]!.capacity! - 2) < 1e-6);
  percent *= 2;
  const changed = await getQuotaEstimation(params);
  assert.equal(fit.mock.callCount(), 3);
  assert.ok(Math.abs(changed.accounts[0]!.models[0]!.capacity! / first.accounts[0]!.models[0]!.capacity! - 1) < 1e-6);
  fail = true;
  await assert.rejects(getQuotaEstimation(params), /快照读取失败/);
  fail = false;
  assert.deepEqual(await getQuotaEstimation(params), changed);
});
