/*
 * 文件说明: 查询 usage_logs 原始调用记录，并返回独立的全量预筛选选项。
 * 参考资料: docs/prototypes/usage-filters.html 与 Sub2API usage_logs 表结构。
 */

import { billingTypeLabel } from "../shared/billing-type.js";
import { billingModeLabel } from "../shared/billing-mode.js";
import { requestTypeLabel } from "../shared/request-type.js";
import type { QueryResult } from "pg";
import type { DateRange } from "../shared/ranges.js";
import { runWithConcurrency } from "./db.js";
import type { Db } from "./db.js";

type UsageRecord = Record<string, unknown>;
type FilterOption = { value: string; label: string; hint?: string };
type FilterOptions = { users: FilterOption[]; accounts: FilterOption[]; models: FilterOption[]; upstreamEndpoints: FilterOption[]; billingModes: FilterOption[]; requestTypes: FilterOption[]; apiKeys: FilterOption[]; upstreamModelMismatch: FilterOption[]; inboundEndpoints: FilterOption[]; groups: FilterOption[]; billingTypes: FilterOption[] };
type FilterOptionRow = { value: string | null; label: string | null; hint?: string | null };

const hiddenRawIdentityColumns = new Set(["user_id", "api_key_id", "account_id", "group_id"]);
const recordDisplayColumns: Array<{ key: string; source: string[] }> = [
  { key: "created_at", source: ["created_at"] },
  { key: "user", source: ["user_id"] }, { key: "api_key", source: ["api_key_id"] }, { key: "account", source: ["account_id"] },
  { key: "model", source: ["model", "requested_model"] }, { key: "inbound_endpoint", source: ["inbound_endpoint", "endpoint", "path"] },
  { key: "upstream_endpoint", source: ["upstream_endpoint"] }, { key: "group", source: ["group_id"] }, { key: "request_type", source: ["request_type"] },
  { key: "stream", source: ["stream"] }, { key: "is_stream", source: ["is_stream"] }, { key: "billing_mode", source: ["billing_mode"] }, { key: "billing_type", source: ["billing_type", "billing_mode"] },
  { key: "input_tokens", source: ["input_tokens"] }, { key: "output_tokens", source: ["output_tokens"] }, { key: "cache_read_tokens", source: ["cache_read_tokens"] },
  { key: "cache_creation_tokens", source: ["cache_creation_tokens"] }, { key: "input_cost", source: ["input_cost"] }, { key: "output_cost", source: ["output_cost"] },
  { key: "cache_read_cost", source: ["cache_read_cost"] }, { key: "cache_creation_cost", source: ["cache_creation_cost"] }, { key: "total_cost", source: ["total_cost"] },
  { key: "actual_cost", source: ["actual_cost"] }, { key: "first_token_ms", source: ["first_token_ms"] }, { key: "duration_ms", source: ["duration_ms"] },
  { key: "request_id", source: ["request_id"] }, { key: "user_agent", source: ["user_agent"] }, { key: "ip_address", source: ["ip_address"] }
];

function orderRecordColumns(discoveredColumns: string[]): string[] {
  const discovered = new Set(discoveredColumns);
  const columns = recordDisplayColumns.filter((column) => column.source.some((source) => discovered.has(source))).map((column) => column.key);
  const displayColumns = new Set(columns);
  return [...columns, ...discoveredColumns.filter((column) => !hiddenRawIdentityColumns.has(column) && !displayColumns.has(column))];
}

function quoteIdentifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function normalizeLimit(value: string | undefined, fallback: number): number { const parsed = Number.parseInt(value || "", 10); return !Number.isFinite(parsed) || parsed <= 0 ? fallback : Math.min(parsed, 10_000); }
function normalizePage(value: string | undefined): number { const parsed = Number.parseInt(value || "", 10); return !Number.isFinite(parsed) || parsed <= 0 ? 1 : parsed; }
function optionRows(rows: Array<{ value: string | null; label: string | null; hint?: string | null }>): FilterOption[] {
  return rows.filter((row) => row.value !== null).map((row) => ({ value: row.value as string, label: row.label || row.value as string, ...(row.hint ? { hint: row.hint } : {}) }));
}

async function getFilterOptions(db: Db, range: DateRange, hasBillingType: boolean): Promise<FilterOptions> {
  const billingExpression = hasBillingType ? "NULLIF(ul.billing_type::text, '')" : "NULLIF(ul.billing_mode::text, '')";
  const modelExpression = "COALESCE(NULLIF(ul.requested_model, ''), NULLIF(ul.model, ''))";
  const upstreamEndpointExpression = "NULLIF(ul.upstream_endpoint, '')";
  const billingModeExpression = "NULLIF(ul.billing_mode, '')";
  const values = [range.start, range.end];
  const rangeClause = "ul.created_at >= $1 AND ul.created_at < $2";
  const [users, accounts, models, upstreamEndpoints, billingModes, requestTypes, apiKeys, endpoints, groups, billingTypes] = await runWithConcurrency<QueryResult<FilterOptionRow>>([
    () => db.pool.query<FilterOptionRow>(`SELECT DISTINCT ul.user_id::text AS value, COALESCE(NULLIF(u.email, ''), NULLIF(u.username, ''), CONCAT('用户 #', ul.user_id)) AS label, CONCAT('用户 #', ul.user_id) AS hint FROM usage_logs ul LEFT JOIN users u ON u.id = ul.user_id WHERE ${rangeClause} AND ul.user_id IS NOT NULL ORDER BY label`, values),
    () => db.pool.query<FilterOptionRow>(`SELECT DISTINCT ul.account_id::text AS value, COALESCE(NULLIF(a.name, ''), CONCAT('上游账号 #', ul.account_id)) AS label, CONCAT('账号 #', ul.account_id) AS hint FROM usage_logs ul LEFT JOIN accounts a ON a.id = ul.account_id WHERE ${rangeClause} AND ul.account_id IS NOT NULL ORDER BY label`, values),
    () => db.pool.query<FilterOptionRow>(`SELECT DISTINCT ${modelExpression} AS value, ${modelExpression} AS label FROM usage_logs ul WHERE ${rangeClause} AND ${modelExpression} IS NOT NULL ORDER BY label`, values),
    () => db.pool.query<FilterOptionRow>(`SELECT DISTINCT ${upstreamEndpointExpression} AS value, ${upstreamEndpointExpression} AS label FROM usage_logs ul WHERE ${rangeClause} AND ${upstreamEndpointExpression} IS NOT NULL ORDER BY label`, values),
    () => db.pool.query<FilterOptionRow>(`SELECT DISTINCT ${billingModeExpression} AS value, ${billingModeExpression} AS label FROM usage_logs ul WHERE ${rangeClause} AND ${billingModeExpression} IS NOT NULL ORDER BY label`, values),
    () => db.pool.query<FilterOptionRow>(`SELECT DISTINCT ul.request_type::text AS value, ul.request_type::text AS label FROM usage_logs ul WHERE ${rangeClause} AND ul.request_type IS NOT NULL ORDER BY label`, values),
    () => db.pool.query<FilterOptionRow>(`SELECT DISTINCT ul.api_key_id::text AS value, COALESCE(NULLIF(ak.name, ''), CONCAT('API Key #', ul.api_key_id)) AS label, CONCAT('API Key #', ul.api_key_id) AS hint FROM usage_logs ul LEFT JOIN api_keys ak ON ak.id = ul.api_key_id WHERE ${rangeClause} AND ul.api_key_id IS NOT NULL ORDER BY label`, values),
    () => db.pool.query<FilterOptionRow>(`SELECT DISTINCT NULLIF(ul.inbound_endpoint, '') AS value, NULLIF(ul.inbound_endpoint, '') AS label FROM usage_logs ul WHERE ${rangeClause} AND NULLIF(ul.inbound_endpoint, '') IS NOT NULL ORDER BY label`, values),
    () => db.pool.query<FilterOptionRow>(`SELECT DISTINCT COALESCE(ul.group_id::text, '__null__') AS value, CASE WHEN ul.group_id IS NULL THEN '未分组' ELSE COALESCE(NULLIF(g.name, ''), CONCAT('分组 #', ul.group_id)) END AS label, CASE WHEN ul.group_id IS NULL THEN 'group_id = NULL' ELSE CONCAT('分组 #', ul.group_id) END AS hint FROM usage_logs ul LEFT JOIN "groups" g ON g.id = ul.group_id WHERE ${rangeClause} ORDER BY label`, values),
    () => db.pool.query<FilterOptionRow>(`SELECT DISTINCT ${billingExpression} AS value, ${billingExpression} AS label FROM usage_logs ul WHERE ${rangeClause} AND ${billingExpression} IS NOT NULL ORDER BY value`, values)
  ], 3);
  const nonNullValue = (row: FilterOptionRow): row is FilterOptionRow & { value: string } => row.value !== null;
  return { users: optionRows(users.rows), accounts: optionRows(accounts.rows), models: optionRows(models.rows), upstreamEndpoints: optionRows(upstreamEndpoints.rows), billingModes: billingModes.rows.filter(nonNullValue).map((row) => ({ value: row.value, label: billingModeLabel(row.value), hint: row.value })), requestTypes: requestTypes.rows.filter(nonNullValue).map((row) => ({ value: row.value, label: requestTypeLabel(row.value) || row.value, hint: row.value })), apiKeys: optionRows(apiKeys.rows), upstreamModelMismatch: [{ value: "true", label: "模型不匹配" }, { value: "false", label: "模型匹配" }], inboundEndpoints: optionRows(endpoints.rows), groups: optionRows(groups.rows), billingTypes: billingTypes.rows.filter(nonNullValue).map((row) => ({ value: row.value, label: billingTypeLabel(row.value), hint: row.value })) };
}

export async function getUsageRecordFilterOptions(db: Db, range: DateRange): Promise<FilterOptions> {
  const columnsResult = await db.pool.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_logs' ORDER BY ordinal_position`);
  return getFilterOptions(db, range, columnsResult.rows.some((row) => row.column_name === "billing_type"));
}

export async function getUsageRecords(params: { db: Db; range: DateRange; limit?: string; page?: string; defaultLimit: number; userIds?: string[]; accountIds?: string[]; models?: string[]; upstreamEndpoints?: string[]; billingModes?: string[]; requestTypes?: string[]; apiKeyIds?: string[]; upstreamModelMismatch?: string[]; inboundEndpoints?: string[]; groupIds?: string[]; billingTypes?: string[] }): Promise<{ columns: string[]; rows: UsageRecord[]; total: number; limit: number; page: number; pageCount: number; range: DateRange }> {
  const columnsResult = await params.db.pool.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_logs' ORDER BY ordinal_position`);
  const discoveredColumns = columnsResult.rows.map((row) => row.column_name);
  const columns = orderRecordColumns(discoveredColumns);
  const hasBillingType = discoveredColumns.includes("billing_type");
  const billingExpression = hasBillingType ? "NULLIF(ul.billing_type::text, '')" : "NULLIF(ul.billing_mode::text, '')";
  const modelExpression = "COALESCE(NULLIF(ul.requested_model, ''), NULLIF(ul.model, ''))";
  const upstreamEndpointExpression = "NULLIF(ul.upstream_endpoint, '')";
  const billingModeExpression = "NULLIF(ul.billing_mode, '')";
  const upstreamModelMismatchExpression = "ul.upstream_model_mismatch::text";
  const values: unknown[] = [params.range.start, params.range.end];
  const conditions = ["ul.created_at >= $1", "ul.created_at < $2"];
  const addArrayFilter = (filterValues: string[] | undefined, expression: string, cast = "text") => { if (!filterValues?.length) return; values.push(filterValues); conditions.push(`${expression} = ANY($${values.length}::${cast}[])`); };
  addArrayFilter(params.userIds, "ul.user_id", "bigint"); addArrayFilter(params.accountIds, "ul.account_id", "bigint");
  addArrayFilter(params.models, modelExpression);
  addArrayFilter(params.upstreamEndpoints, upstreamEndpointExpression);
  addArrayFilter(params.billingModes, billingModeExpression);
  addArrayFilter(params.requestTypes, "ul.request_type", "smallint");
  addArrayFilter(params.apiKeyIds, "ul.api_key_id", "bigint");
  addArrayFilter(params.upstreamModelMismatch, upstreamModelMismatchExpression);
  addArrayFilter(params.inboundEndpoints, "NULLIF(ul.inbound_endpoint, '')");
  if (params.groupIds?.length) { values.push(params.groupIds); conditions.push(`(ul.group_id::text = ANY($${values.length}::text[]) OR (ul.group_id IS NULL AND '__null__' = ANY($${values.length}::text[])))`); }
  addArrayFilter(params.billingTypes, billingExpression);
  const whereClause = conditions.join(" AND ");
  const totalResult = await params.db.pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM usage_logs ul WHERE ${whereClause}`, values);
  const total = Number(totalResult.rows[0]?.total || 0); const limit = normalizeLimit(params.limit, params.defaultLimit); const pageCount = Math.max(1, Math.ceil(total / limit)); const page = Math.min(normalizePage(params.page), pageCount); const offset = (page - 1) * limit;
  if (columns.length === 0) return { columns: [], rows: [], total, limit, page, pageCount, range: params.range };
  const orderColumn = columns.includes("created_at") ? "created_at" : columns[0]; const rowValues = [...values, limit];
  rowValues.push(offset);
  const result = await params.db.pool.query<{ record: UsageRecord }>(`SELECT to_jsonb(ul) || jsonb_build_object('user', COALESCE(NULLIF(u.email, ''), NULLIF(u.username, ''), CONCAT('用户 #', ul.user_id)) || CASE WHEN COALESCE(NULLIF(u.email, ''), NULLIF(u.username, '')) IS NULL THEN '' ELSE CONCAT(' #', ul.user_id) END, 'api_key', COALESCE(NULLIF(ak.name, ''), CONCAT('API Key #', ul.api_key_id)), 'account', COALESCE(NULLIF(a.name, ''), CONCAT('上游账号 #', ul.account_id)), 'inbound_endpoint', NULLIF(ul.inbound_endpoint, ''), 'model', COALESCE(NULLIF(ul.requested_model, ''), NULLIF(ul.model, '')), 'group', CASE WHEN ul.group_id IS NULL THEN NULL ELSE COALESCE(NULLIF(g.name, ''), CONCAT('分组 #', ul.group_id)) END, 'billing_type', ${billingExpression}) AS record FROM usage_logs ul LEFT JOIN users u ON u.id = ul.user_id LEFT JOIN api_keys ak ON ak.id = ul.api_key_id LEFT JOIN accounts a ON a.id = ul.account_id LEFT JOIN "groups" g ON g.id = ul.group_id WHERE ${whereClause} ORDER BY ul.${quoteIdentifier(orderColumn)} DESC NULLS LAST LIMIT $${rowValues.length - 1} OFFSET $${rowValues.length}`, rowValues);
  return { columns, rows: result.rows.map((row) => row.record), total, limit, page, pageCount, range: params.range };
}

export type { FilterOption, FilterOptions, UsageRecord };
