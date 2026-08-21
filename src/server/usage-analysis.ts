/*
 * 文件说明: 汇总使用记录分布和额度分析所需的本地数据库数据。
 * 额度窗口由 Sub2API 写入 accounts.extra，这里只读该快照，不调用上游账号。
 */

import type { DateRange } from "../shared/ranges.js";
import type { QueryResult } from "pg";
import { runWithConcurrency } from "./db.js";
import type { Db } from "./db.js";

type DistributionItem = { label: string; value: number };
type AnalysisFilters = { userIds?: string[]; accountIds?: string[]; models?: string[]; upstreamEndpoints?: string[]; billingModes?: string[]; requestTypes?: string[]; apiKeyIds?: string[]; upstreamModelMismatch?: string[]; inboundEndpoints?: string[]; groupIds?: string[]; billingTypes?: string[] };
type UsageAnalysis = {
  range: { preset: DateRange["preset"]; label: string; start: string; end: string; startDate: string; endDate: string };
  records: { model: DistributionItem[]; group: DistributionItem[]; endpoint: DistributionItem[]; user: DistributionItem[] };
  quota: {
    accounts: Array<{
      accountId: number;
      name: string;
      platform: string;
      tokens: number;
      actualCost: number;
      standardCost: number;
      fiveHourUsedPercent: number | null;
      sevenDayUsedPercent: number | null;
      fiveHourWindowStart: string | null;
      sevenDayWindowStart: string | null;
      fiveHourResetAt: string | null;
      sevenDayResetAt: string | null;
      usageUpdatedAt: string | null;
    }>;
    users: Array<{ label: string; tokens: number; actualCost: number; standardCost: number }>;
    userSeries: Array<{ bucket: string; accountId: number | null; label: string; tokens: number; actualCost: number; standardCost: number }>;
    buckets: string[];
    series: Array<{ bucket: string; accountId: number | null; model: string; tokenType: string; tokens: number; actualCost: number; standardCost: number }>;
  };
};

type CountRow = { label: string | null; value: string };
type AccountRow = {
  account_id: number | string | null;
  name: string | null;
  platform: string | null;
  tokens: string;
  actual_cost: string;
  standard_cost: string;
  five_hour_used_percent: string | null;
  seven_day_used_percent: string | null;
  five_hour_window_start: string | null;
  seven_day_window_start: string | null;
  five_hour_reset_at: string | null;
  seven_day_reset_at: string | null;
  usage_updated_at: string | null;
};
type UserRow = { label: string | null; tokens: string; actual_cost: string; standard_cost: string };
type UserSeriesRow = { bucket: string; account_id: number | string | null; label: string | null; tokens: string; actual_cost: string; standard_cost: string };
type BucketRow = { bucket: string };
type SeriesRow = { bucket: string; account_id: number | string | null; model: string | null; token_type: string; tokens: string; actual_cost: string; standard_cost: string };

function number(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function label(value: unknown, fallback: string): string { const text = String(value || "").trim(); return text || fallback; }
function top(rows: CountRow[], limit = 10): DistributionItem[] { return rows.slice(0, limit).map((row) => ({ label: label(row.label, "未标记"), value: number(row.value) })); }
function topWithOther(rows: CountRow[], limit = 10): DistributionItem[] {
  const items = rows.map((row) => ({ label: label(row.label, "未标记"), value: number(row.value) }));
  const leading = items.slice(0, limit);
  const other = items.slice(limit).reduce((sum, item) => sum + item.value, 0);
  return other > 0 ? [...leading, { label: "其他", value: other }] : leading;
}

function buildConditions(filters: AnalysisFilters, values: unknown[]): string[] {
  const conditions = ["ul.created_at >= $1", "ul.created_at < $2"];
  const add = (items: string[] | undefined, expression: string, cast = "text") => { if (!items?.length) return; values.push(items); conditions.push(`${expression} = ANY($${values.length}::${cast}[])`); };
  add(filters.userIds, "ul.user_id", "bigint");
  add(filters.accountIds, "ul.account_id", "bigint");
  add(filters.models, "COALESCE(NULLIF(ul.requested_model, ''), NULLIF(ul.model, ''))");
  add(filters.upstreamEndpoints, "NULLIF(ul.upstream_endpoint, '')");
  add(filters.billingModes, "NULLIF(ul.billing_mode, '')");
  add(filters.requestTypes, "ul.request_type", "smallint");
  add(filters.apiKeyIds, "ul.api_key_id", "bigint");
  add(filters.upstreamModelMismatch, "ul.upstream_model_mismatch::text");
  add(filters.inboundEndpoints, "NULLIF(ul.inbound_endpoint, '')");
  if (filters.groupIds?.length) { values.push(filters.groupIds); conditions.push(`(ul.group_id::text = ANY($${values.length}::text[]) OR (ul.group_id IS NULL AND '__null__' = ANY($${values.length}::text[])))`); }
  add(filters.billingTypes, "COALESCE(NULLIF(ul.billing_type::text, ''), NULLIF(ul.billing_mode::text, ''))");
  return conditions;
}

export async function getUsageAnalysis(params: { db: Db; range: DateRange; filters?: AnalysisFilters; timezone: string; granularity: "hour" | "day" }): Promise<UsageAnalysis> {
  const values: unknown[] = [params.range.start, params.range.end];
  const conditions = buildConditions(params.filters || {}, values).join(" AND ");
  const modelExpression = "COALESCE(NULLIF(ul.requested_model, ''), NULLIF(ul.model, ''), '未知模型')";
  const endpointExpression = "COALESCE(NULLIF(ul.inbound_endpoint, ''), '未知端点')";
  const tokenExpression = "COALESCE(ul.input_tokens, 0) + COALESCE(ul.output_tokens, 0) + COALESCE(ul.cache_creation_tokens, 0) + COALESCE(ul.cache_read_tokens, 0)";
  const bucketFormat = params.granularity === "day" ? "YYYY-MM-DD" : "YYYY-MM-DD HH24:00";
  const seriesBucket = `to_char(date_trunc('${params.granularity}', ul.created_at AT TIME ZONE $${values.length + 1}), '${bucketFormat}')`;
  const baseParams = [...values, params.timezone];
  const bucketInterval = params.granularity === "day" ? "1 day" : "1 hour";
  const queryResults = await runWithConcurrency<unknown>([
    () => params.db.pool.query<CountRow>(`SELECT ${modelExpression} AS label, COUNT(*)::text AS value FROM usage_logs ul WHERE ${conditions} GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 12`, values),
    () => params.db.pool.query<CountRow>(`SELECT COALESCE(g.name, '未分组') AS label, COUNT(*)::text AS value FROM usage_logs ul LEFT JOIN "groups" g ON g.id = ul.group_id WHERE ${conditions} GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 12`, values),
    () => params.db.pool.query<CountRow>(`SELECT ${endpointExpression} AS label, COUNT(*)::text AS value FROM usage_logs ul WHERE ${conditions} GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 12`, values),
    () => params.db.pool.query<CountRow>(`SELECT COALESCE(NULLIF(u.email, ''), NULLIF(u.username, ''), '用户 #' || ul.user_id::text) AS label, COUNT(*)::text AS value FROM usage_logs ul LEFT JOIN users u ON u.id = ul.user_id WHERE ${conditions} GROUP BY 1 ORDER BY COUNT(*) DESC`, values),
    () => params.db.pool.query<AccountRow>(`WITH usage_by_account AS (SELECT ul.account_id, SUM(${tokenExpression}) AS tokens, COALESCE(SUM(ul.actual_cost), 0) AS actual_cost, COALESCE(SUM(ul.total_cost), 0) AS standard_cost FROM usage_logs ul WHERE ${conditions} GROUP BY ul.account_id) SELECT a.id AS account_id, COALESCE(a.name, '上游账号 #' || a.id::text) AS name, COALESCE(a.platform, '') AS platform, COALESCE(u.tokens, 0)::text AS tokens, COALESCE(u.actual_cost, 0)::text AS actual_cost, COALESCE(u.standard_cost, 0)::text AS standard_cost, NULLIF(a.extra->>'codex_5h_used_percent', '') AS five_hour_used_percent, NULLIF(a.extra->>'codex_7d_used_percent', '') AS seven_day_used_percent, CASE WHEN NULLIF(a.extra->>'codex_5h_reset_at', '') IS NULL THEN NULL ELSE (a.extra->>'codex_5h_reset_at')::timestamptz - make_interval(mins => COALESCE(NULLIF(a.extra->>'codex_5h_window_minutes', '')::int, 300)) END AS five_hour_window_start, CASE WHEN NULLIF(a.extra->>'codex_7d_reset_at', '') IS NULL THEN NULL ELSE (a.extra->>'codex_7d_reset_at')::timestamptz - make_interval(mins => COALESCE(NULLIF(a.extra->>'codex_7d_window_minutes', '')::int, 10080)) END AS seven_day_window_start, NULLIF(a.extra->>'codex_5h_reset_at', '') AS five_hour_reset_at, NULLIF(a.extra->>'codex_7d_reset_at', '') AS seven_day_reset_at, NULLIF(a.extra->>'codex_usage_updated_at', '') AS usage_updated_at FROM accounts a LEFT JOIN usage_by_account u ON u.account_id = a.id WHERE a.deleted_at IS NULL ORDER BY COALESCE(u.tokens, 0) DESC, a.id`, values),
    () => params.db.pool.query<UserRow>(`SELECT COALESCE(NULLIF(u.email, ''), NULLIF(u.username, ''), '用户 #' || ul.user_id::text) AS label, SUM(${tokenExpression})::text AS tokens, COALESCE(SUM(ul.actual_cost), 0)::text AS actual_cost, COALESCE(SUM(ul.total_cost), 0)::text AS standard_cost FROM usage_logs ul LEFT JOIN users u ON u.id = ul.user_id WHERE ${conditions} GROUP BY 1 ORDER BY SUM(${tokenExpression}) DESC LIMIT 11`, values),
    () => params.db.pool.query<UserSeriesRow>(`SELECT ${seriesBucket} AS bucket, ul.account_id, COALESCE(NULLIF(u.email, ''), NULLIF(u.username, ''), '用户 #' || ul.user_id::text) AS label, SUM(${tokenExpression})::text AS tokens, COALESCE(SUM(ul.actual_cost), 0)::text AS actual_cost, COALESCE(SUM(ul.total_cost), 0)::text AS standard_cost FROM usage_logs ul LEFT JOIN users u ON u.id = ul.user_id WHERE ${conditions} GROUP BY 1, 2, 3 ORDER BY 1`, baseParams),
    () => params.db.pool.query<BucketRow>(`SELECT to_char(bucket, '${bucketFormat}') AS bucket FROM generate_series(date_trunc('${params.granularity}', $1::timestamptz AT TIME ZONE $3), date_trunc('${params.granularity}', ($2::timestamptz - interval '1 microsecond') AT TIME ZONE $3), interval '${bucketInterval}') AS bucket ORDER BY bucket`, [values[0], values[1], params.timezone]),
    () => params.db.pool.query<SeriesRow>(`SELECT ${seriesBucket} AS bucket, ul.account_id, ${modelExpression} AS model, token_type, SUM(tokens)::text AS tokens, COALESCE(SUM(token_actual_cost), 0)::text AS actual_cost, COALESCE(SUM(token_standard_cost), 0)::text AS standard_cost FROM usage_logs ul CROSS JOIN LATERAL (VALUES ('输入', COALESCE(ul.input_tokens, 0), COALESCE(ul.input_cost, 0), COALESCE(ul.input_cost, 0)), ('输出', COALESCE(ul.output_tokens, 0), COALESCE(ul.output_cost, 0), COALESCE(ul.output_cost, 0)), ('Cache Read', COALESCE(ul.cache_read_tokens, 0), COALESCE(ul.cache_read_cost, 0), COALESCE(ul.cache_read_cost, 0)), ('Cache Creation', COALESCE(ul.cache_creation_tokens, 0), COALESCE(ul.cache_creation_cost, 0), COALESCE(ul.cache_creation_cost, 0))) AS token(token_type, tokens, token_actual_cost, token_standard_cost) WHERE ${conditions} GROUP BY 1, 2, 3, token_type ORDER BY 1`, baseParams)
  ], 3);
  const [models, groups, endpoints, userDistribution, accounts, users, userSeries, buckets, series] = queryResults as [
    QueryResult<CountRow>,
    QueryResult<CountRow>,
    QueryResult<CountRow>,
    QueryResult<CountRow>,
    QueryResult<AccountRow>,
    QueryResult<UserRow>,
    QueryResult<UserSeriesRow>,
    QueryResult<BucketRow>,
    QueryResult<SeriesRow>
  ];
  return {
    range: { preset: params.range.preset, label: params.range.label, start: params.range.start.toISOString(), end: params.range.end.toISOString(), startDate: params.range.startDate, endDate: params.range.endDate },
    records: { model: top(models.rows), group: top(groups.rows), endpoint: top(endpoints.rows), user: topWithOther(userDistribution.rows) },
    quota: {
      accounts: accounts.rows.map((row) => ({
        accountId: number(row.account_id),
        name: label(row.name, `上游账号 #${row.account_id}`),
        platform: label(row.platform, ""),
        tokens: number(row.tokens),
        actualCost: number(row.actual_cost),
        standardCost: number(row.standard_cost),
        fiveHourUsedPercent: row.five_hour_used_percent === null ? null : number(row.five_hour_used_percent),
        sevenDayUsedPercent: row.seven_day_used_percent === null ? null : number(row.seven_day_used_percent),
        fiveHourWindowStart: row.five_hour_window_start,
        sevenDayWindowStart: row.seven_day_window_start,
        fiveHourResetAt: row.five_hour_reset_at,
        sevenDayResetAt: row.seven_day_reset_at,
        usageUpdatedAt: row.usage_updated_at
      })),
      users: users.rows.map((row) => ({ label: label(row.label, "未知用户"), tokens: number(row.tokens), actualCost: number(row.actual_cost), standardCost: number(row.standard_cost) })),
      userSeries: userSeries.rows.map((row) => ({ bucket: row.bucket, accountId: row.account_id === null ? null : number(row.account_id), label: label(row.label, "未知用户"), tokens: number(row.tokens), actualCost: number(row.actual_cost), standardCost: number(row.standard_cost) })),
      buckets: buckets.rows.map((row) => row.bucket),
      series: series.rows.map((row) => ({ bucket: row.bucket, accountId: row.account_id === null ? null : number(row.account_id), model: label(row.model, "未知模型"), tokenType: row.token_type, tokens: number(row.tokens), actualCost: number(row.actual_cost), standardCost: number(row.standard_cost) }))
    }
  };
}

export type { AnalysisFilters, DistributionItem, UsageAnalysis };
