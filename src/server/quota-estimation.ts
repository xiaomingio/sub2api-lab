/*
 * 文件说明: 读取额度快照，以有效更新时间区间汇总各账号的上游模型 Token，返回窗口容量估算。
 */
import type { Db, LabDb } from "./db.js";
import { QuotaEstimator } from "../shared/QuotaEstimator.js";
import type { EstimationHours, ModelTokens, OfficialPricing, QuotaEstimation, QuotaObservation, QuotaSample } from "../shared/quota-estimation.js";
import { hourBucketStart } from "./quota-snapshot-scheduler.js";

type ModelPlazaResponse = { data?: { groups?: Array<{ models?: Array<{ name?: string; official_pricing?: { input_price?: number | null; output_price?: number | null; cache_write_price?: number | null; cache_read_price?: number | null } | null }> }> }; groups?: Array<{ models?: Array<{ name?: string; official_pricing?: { input_price?: number | null; output_price?: number | null; cache_write_price?: number | null; cache_read_price?: number | null } | null }> }> };

async function fetchOfficialPricing(baseUrl: string): Promise<Map<string, OfficialPricing>> {
  try {
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    const endpoint = normalizedBaseUrl.endsWith("/api/v1") ? `${normalizedBaseUrl}/model-plaza` : `${normalizedBaseUrl}/api/v1/model-plaza`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return new Map();
    const body = await response.json() as ModelPlazaResponse;
    const groups = body.data?.groups || body.groups || [];
    const pricing = new Map<string, OfficialPricing>();
    for (const group of groups) for (const model of group.models || []) {
      const official = model.official_pricing;
      if (model.name && official) {
        const value = {
        inputPrice: official.input_price ?? null, outputPrice: official.output_price ?? null,
        cacheWritePrice: official.cache_write_price ?? null, cacheReadPrice: official.cache_read_price ?? null
        };
        for (const alias of modelAliases(model.name)) if (!pricing.has(alias)) pricing.set(alias, value);
      }
    }
    return pricing;
  } catch {
    return new Map();
  }
}

function modelAliases(model: string): string[] {
  const lower = model.trim().toLowerCase();
  const withoutPrefix = lower.replace(/^.*\/models\//, "").replace(/^models\//, "");
  const withoutDate = withoutPrefix.replace(/-\d{8}$/, "");
  return [...new Set([lower, withoutPrefix, withoutDate])];
}

function findOfficialPricing(pricing: Map<string, OfficialPricing>, model: string): OfficialPricing | null {
  return modelAliases(model).map((alias) => pricing.get(alias)).find(Boolean) || null;
}

export async function getQuotaEstimation(params: { db: Db; labDb: LabDb; hours: EstimationHours; now: Date; timezone: string; sub2apiBaseUrl: string }): Promise<QuotaEstimation> {
  const start = new Date(params.now.getTime() - params.hours * 3_600_000);
  const [snapshotResult, accountResult, officialPricing] = await Promise.all([
    params.labDb.pool.query<QuotaObservation>(`
      SELECT account_id AS "accountId", account_name AS "accountName", sampled_at::text AS "sampledAt",
        sub2api_usage_updated_at::text AS "updatedAt", seven_day_reset_at::text AS "resetAt",
        seven_day_used_percent::float8 AS percent
      FROM quota_snapshots WHERE sampled_at >= $1 AND sampled_at <= $2 ORDER BY sampled_at, account_id
    `, [new Date(start.getTime() - 6 * 3_600_000), params.now]),
    params.db.pool.query<{ id: number; name: string }>("SELECT id, name FROM accounts WHERE deleted_at IS NULL ORDER BY id"),
    fetchOfficialPricing(params.sub2apiBaseUrl)
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
    for (const row of result.rows) {
      const model = samples[row.id]!.models.find((item) => item.model === row.model);
      if (model) { model.input += row.input; model.output += row.output; model.cacheRead += row.cacheRead; model.cacheCreation += row.cacheCreation; }
      else samples[row.id]!.models.push({ model: row.model, input: row.input, output: row.output, cacheRead: row.cacheRead, cacheCreation: row.cacheCreation, officialPricing: findOfficialPricing(officialPricing, row.model) });
    }
  }
  return { hours: params.hours, start: start.toISOString(), end: params.now.toISOString(), timezone: params.timezone,
    accounts: estimator.estimate(samples, params.now, params.hours === 168) };
}
