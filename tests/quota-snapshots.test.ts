/*
 * 文件说明: 验证额度快照的时区整点归属和下降重置判定。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { hourBucketStart, isOnTheHour } from "../src/server/quota-snapshot-scheduler.js";
import { recordQuotaSnapshot } from "../src/server/quota-snapshots.js";
import type { Db, LabDb } from "../src/server/db.js";

test("整点桶按配置时区转换为正确的 UTC 时间", () => {
  const now = new Date("2026-08-27T03:00:20.000Z");
  assert.equal(isOnTheHour(now, "Asia/Shanghai"), true);
  assert.equal(hourBucketStart(now, "Asia/Shanghai").toISOString(), "2026-08-27T03:00:00.000Z");
  assert.equal(isOnTheHour(new Date("2026-08-27T03:01:00.000Z"), "Asia/Shanghai"), false);
});

test("7 天使用率下降时记录重置及重置前使用率", async () => {
  const targetQueries: Array<{ text: string; values?: unknown[] }> = [];
  const sourceDb = {
    pool: {
      async query() {
        return {
          rows: [{ account_id: "42", account_name: "账号 42", platform: "openai", five_hour_used_percent: "10", seven_day_used_percent: "12", five_hour_reset_at: null, seven_day_reset_at: null, sub2api_usage_updated_at: "2026-08-27T02:59:00.000Z" }]
        };
      }
    }
  } as unknown as Db;
  const client = {
    async query(text: string, values?: unknown[]) {
      targetQueries.push({ text, values });
      if (text.startsWith("SELECT seven_day_used_percent")) return { rows: [{ seven_day_used_percent: "88" }] };
      if (text.startsWith("INSERT")) return { rowCount: 1, rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const labDb = { pool: { connect: async () => client } } as unknown as LabDb;

  const result = await recordQuotaSnapshot({ sourceDb, labDb, sampledAt: new Date("2026-08-27T03:00:00.000Z") });

  assert.equal(result.inserted, 1);
  const insert = targetQueries.find((query) => query.text.startsWith("INSERT"));
  assert.ok(insert);
  assert.equal(insert.values?.[10], true);
  assert.equal(insert.values?.[9], "88");
});
