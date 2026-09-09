/*
 * 文件说明: 读取额度快照，以有效更新时间区间汇总各账号的上游模型 Token，返回窗口容量估算。
 */
import type { Db, LabDb } from "./db.js";
import { QuotaEstimator } from "../shared/QuotaEstimator.js";
import type { EstimationHours, ModelTokens, QuotaEstimation, QuotaObservation, QuotaSample } from "../shared/quota-estimation.js";
import { hourBucketStart } from "./quota-snapshot-scheduler.js";

export async function getQuotaEstimation(params: { db: Db; labDb: LabDb; hours: EstimationHours; now: Date; timezone: string }): Promise<QuotaEstimation> {
  const start = new Date(params.now.getTime() - params.hours * 3_600_000);
  const [snapshotResult, accountResult] = await Promise.all([
    params.labDb.pool.query<QuotaObservation>(`
      SELECT account_id AS "accountId", account_name AS "accountName", sampled_at::text AS "sampledAt",
        sub2api_usage_updated_at::text AS "updatedAt", seven_day_reset_at::text AS "resetAt",
        seven_day_used_percent::float8 AS percent
      FROM quota_snapshots WHERE sampled_at >= $1 AND sampled_at <= $2 ORDER BY sampled_at, account_id
    `, [new Date(start.getTime() - 6 * 3_600_000), params.now]),
    params.db.pool.query<{ id: number; name: string }>("SELECT id, name FROM accounts WHERE deleted_at IS NULL ORDER BY id")
  ]);
  const observations = snapshotResult.rows.map((r) => ({ ...r, accountId: Number(r.accountId) }));
  const hourOffset = -hourBucketStart(params.now, params.timezone).getTime() % 3_600_000;
  const estimator = new QuotaEstimator(observations, start, params.now, hourOffset, accountResult.rows.map((a) => ({ accountId: Number(a.id), accountName: a.name })));
  const samples: QuotaSample[] = estimator.intervals.map((r) => ({ ...r, models: [] }));
  if (samples.length) {
    const result = await params.db.pool.query<ModelTokens & { id: number }>(`
      WITH intervals AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(id int, "accountId" bigint, start timestamptz, "end" timestamptz)
      )
      SELECT i.id, COALESCE(NULLIF(ul.upstream_model, ''), NULLIF(ul.model, ''), NULLIF(ul.requested_model, ''), '未知模型') AS model,
        SUM(COALESCE(ul.input_tokens, 0))::float8 AS input,
        SUM(COALESCE(ul.output_tokens, 0))::float8 AS output,
        SUM(COALESCE(ul.cache_read_tokens, 0))::float8 AS "cacheRead",
        SUM(COALESCE(ul.cache_creation_tokens, 0))::float8 AS "cacheCreation"
      FROM intervals i JOIN usage_logs ul ON ul.account_id = i."accountId" AND ul.created_at >= i.start AND ul.created_at < i."end"
      GROUP BY i.id, 2
    `, [JSON.stringify(estimator.intervals)]);
    for (const row of result.rows) samples[row.id]!.models.push({ model: row.model, input: row.input, output: row.output, cacheRead: row.cacheRead, cacheCreation: row.cacheCreation });
  }
  return { hours: params.hours, start: start.toISOString(), end: params.now.toISOString(), timezone: params.timezone,
    accounts: estimator.estimate(samples, params.now, params.hours === 168) };
}
