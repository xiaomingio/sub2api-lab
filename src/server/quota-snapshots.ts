/*
 * 文件说明: 从 Sub2API accounts.extra 读取额度快照，记录小时数据并查询重置历史。
 */

import type pg from "pg";
import type { Db, LabDb } from "./db.js";

type SnapshotRow = {
  id: string;
  sampled_at: string;
  account_id: string;
  account_name: string;
  platform: string;
  five_hour_used_percent: string | null;
  seven_day_used_percent: string | null;
  five_hour_reset_at: string | null;
  seven_day_reset_at: string | null;
  sub2api_usage_updated_at: string | null;
  previous_seven_day_used_percent: string | null;
  is_reset: boolean;
};

type QuotaSnapshot = {
  id: number;
  sampledAt: string;
  accountId: number;
  accountName: string;
  platform: string;
  fiveHourUsedPercent: number | null;
  sevenDayUsedPercent: number | null;
  fiveHourResetAt: string | null;
  sevenDayResetAt: string | null;
  sub2apiUsageUpdatedAt: string | null;
  previousSevenDayUsedPercent: number | null;
  isReset: boolean;
};

function numberOrNull(value: string | null): number | null { return value === null ? null : Number(value); }
function snapshot(row: SnapshotRow): QuotaSnapshot {
  return { id: Number(row.id), sampledAt: row.sampled_at, accountId: Number(row.account_id), accountName: row.account_name, platform: row.platform, fiveHourUsedPercent: numberOrNull(row.five_hour_used_percent), sevenDayUsedPercent: numberOrNull(row.seven_day_used_percent), fiveHourResetAt: row.five_hour_reset_at, sevenDayResetAt: row.seven_day_reset_at, sub2apiUsageUpdatedAt: row.sub2api_usage_updated_at, previousSevenDayUsedPercent: numberOrNull(row.previous_seven_day_used_percent), isReset: row.is_reset };
}

export async function recordQuotaSnapshot(params: { sourceDb: Db; labDb: LabDb; sampledAt: Date }): Promise<{ inserted: number }> {
  const source = await params.sourceDb.pool.query<{
    account_id: string;
    account_name: string;
    platform: string;
    five_hour_used_percent: string | null;
    seven_day_used_percent: string | null;
    five_hour_reset_at: string | null;
    seven_day_reset_at: string | null;
    sub2api_usage_updated_at: string | null;
  }>(`
    SELECT id AS account_id,
      COALESCE(NULLIF(name, ''), '上游账号 #' || id::text) AS account_name,
      COALESCE(platform, '') AS platform,
      NULLIF(extra->>'codex_5h_used_percent', '') AS five_hour_used_percent,
      NULLIF(extra->>'codex_7d_used_percent', '') AS seven_day_used_percent,
      NULLIF(extra->>'codex_5h_reset_at', '')::timestamptz AS five_hour_reset_at,
      NULLIF(extra->>'codex_7d_reset_at', '')::timestamptz AS seven_day_reset_at,
      NULLIF(extra->>'codex_usage_updated_at', '')::timestamptz AS sub2api_usage_updated_at
    FROM accounts
    WHERE deleted_at IS NULL
    ORDER BY id
  `);
  const client = await params.labDb.pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const row of source.rows) {
      const previous = await client.query<{ seven_day_used_percent: string | null }>(
        "SELECT seven_day_used_percent FROM sub2api_lab_quota_snapshots WHERE account_id = $1 AND sampled_at < $2 ORDER BY sampled_at DESC LIMIT 1",
        [row.account_id, params.sampledAt]
      );
      const previousPercent = previous.rows[0]?.seven_day_used_percent ?? null;
      const isReset = row.seven_day_used_percent !== null && previousPercent !== null && Number(row.seven_day_used_percent) < Number(previousPercent);
      const result = await client.query(
        `INSERT INTO sub2api_lab_quota_snapshots (sampled_at, account_id, account_name, platform, five_hour_used_percent, seven_day_used_percent, five_hour_reset_at, seven_day_reset_at, sub2api_usage_updated_at, previous_seven_day_used_percent, is_reset)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (sampled_at, account_id) DO NOTHING`,
        [params.sampledAt, row.account_id, row.account_name, row.platform, row.five_hour_used_percent, row.seven_day_used_percent, row.five_hour_reset_at, row.seven_day_reset_at, row.sub2api_usage_updated_at, previousPercent, isReset]
      );
      inserted += result.rowCount || 0;
    }
    await client.query("COMMIT");
    return { inserted };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listQuotaSnapshots(params: { labDb: LabDb; start: Date; end: Date; accountIds?: number[]; resetsOnly?: boolean; limit?: number }): Promise<QuotaSnapshot[]> {
  const values: unknown[] = [params.start, params.end];
  const conditions = ["sampled_at >= $1", "sampled_at < $2"];
  if (params.accountIds?.length) { values.push(params.accountIds); conditions.push(`account_id = ANY($${values.length}::bigint[])`); }
  if (params.resetsOnly) conditions.push("is_reset = true");
  values.push(Math.min(Math.max(params.limit || 1000, 1), 10_000));
  const result = await params.labDb.pool.query<SnapshotRow>(`SELECT id, sampled_at, account_id, account_name, platform, five_hour_used_percent, seven_day_used_percent, five_hour_reset_at, seven_day_reset_at, sub2api_usage_updated_at, previous_seven_day_used_percent, is_reset FROM sub2api_lab_quota_snapshots WHERE ${conditions.join(" AND ")} ORDER BY sampled_at DESC, account_id LIMIT $${values.length}`, values);
  return result.rows.map(snapshot);
}

export async function withLabJobLock<T>(labDb: LabDb, jobKey: number, task: () => Promise<T>): Promise<T | null> {
  const client = await labDb.pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [jobKey]);
    if (!lock.rows[0]?.locked) return null;
    try { return await task(); } finally { await client.query("SELECT pg_advisory_unlock($1)", [jobKey]); }
  } finally { client.release(); }
}

export type { QuotaSnapshot };
