/*
 * 文件说明: 读取额度快照，以有效更新时间区间汇总各账号的上游模型 Token，返回窗口容量估算。
 */
import type { Db, LabDb } from "./db.js";
import { QuotaEstimator } from "../shared/QuotaEstimator.js";
import type { BillingGroup, EstimationHours, ModelTokens, QuotaEstimation, QuotaObservation, QuotaSample } from "../shared/quota-estimation.js";
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
    const result = await params.db.pool.query<ModelTokens & { id: number; groupId: number | null; groupName: string | null; channelName: string | null; inputPrice: number | null; outputPrice: number | null; cacheReadPrice: number | null; cacheCreationPrice: number | null }>(`
      WITH intervals AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(id int, "accountId" bigint, start timestamptz, "end" timestamptz)
      )
      SELECT i.id, COALESCE(NULLIF(ul.upstream_model, ''), NULLIF(ul.model, ''), NULLIF(ul.requested_model, ''), '未知模型') AS model,
        ul.group_id AS "groupId", COALESCE(g.name, '未分组') AS "groupName", COALESCE(ch.name, '未配置渠道') AS "channelName",
        cmp.input_price::float8 AS "inputPrice", cmp.output_price::float8 AS "outputPrice", cmp.cache_read_price::float8 AS "cacheReadPrice", cmp.cache_write_price::float8 AS "cacheCreationPrice",
        SUM(COALESCE(ul.input_tokens, 0))::float8 AS input,
        SUM(COALESCE(ul.output_tokens, 0))::float8 AS output,
        SUM(COALESCE(ul.cache_read_tokens, 0))::float8 AS "cacheRead",
        SUM(COALESCE(ul.cache_creation_tokens, 0))::float8 AS "cacheCreation"
      FROM intervals i JOIN usage_logs ul ON ul.account_id = i."accountId" AND ul.created_at >= i.start AND ul.created_at < i."end"
      LEFT JOIN groups g ON g.id = ul.group_id
      LEFT JOIN channel_groups cg ON cg.group_id = ul.group_id
      LEFT JOIN channels ch ON ch.id = cg.channel_id
      LEFT JOIN channel_model_pricing cmp ON cmp.channel_id = ch.id AND cmp.models ? COALESCE(NULLIF(ul.upstream_model, ''), NULLIF(ul.model, ''), NULLIF(ul.requested_model, ''), '未知模型')
      GROUP BY i.id, 2, 3, 4, 5, 6, 7, 8, 9
    `, [JSON.stringify(estimator.intervals)]);
    for (const row of result.rows) {
      const model = samples[row.id]!.models.find((item) => item.model === row.model);
      const billingGroup: BillingGroup = { groupId: row.groupId === null ? null : Number(row.groupId), groupName: row.groupName || "未分组", channelName: row.channelName || "未配置渠道", input: row.input, output: row.output, cacheRead: row.cacheRead, cacheCreation: row.cacheCreation, inputPrice: row.inputPrice, outputPrice: row.outputPrice, cacheReadPrice: row.cacheReadPrice, cacheCreationPrice: row.cacheCreationPrice };
      if (model) { model.input += row.input; model.output += row.output; model.cacheRead += row.cacheRead; model.cacheCreation += row.cacheCreation; model.billingGroups = [...(model.billingGroups || []), billingGroup]; }
      else samples[row.id]!.models.push({ model: row.model, input: row.input, output: row.output, cacheRead: row.cacheRead, cacheCreation: row.cacheCreation, billingGroups: [billingGroup] });
    }
  }
  return { hours: params.hours, start: start.toISOString(), end: params.now.toISOString(), timezone: params.timezone,
    accounts: estimator.estimate(samples, params.now, params.hours === 168) };
}
