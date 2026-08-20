/*
 * 文件说明: 查询 usage_logs 原始调用记录，并返回独立的全量预筛选选项。
 * 参考资料: docs/prototypes/usage-filters.html 与 Sub2API usage_logs 表结构。
 */

import { billingTypeLabel } from "../shared/billing-type.js";
import type { DateRange } from "../shared/ranges.js";
import type { Db } from "./db.js";

type UsageRecord = Record<string, unknown>;
type FilterOption = { value: string; label: string; hint?: string };
type FilterOptions = { users: FilterOption[]; accounts: FilterOption[]; inboundEndpoints: FilterOption[]; groups: FilterOption[]; billingTypes: FilterOption[] };

const hiddenRawIdentityColumns = new Set(["user_id", "api_key_id", "account_id", "group_id", "billing_mode"]);
const recordDisplayColumns: Array<{ key: string; source: string[] }> = [
  { key: "created_at", source: ["created_at"] },
  { key: "user", source: ["user_id"] }, { key: "api_key", source: ["api_key_id"] }, { key: "account", source: ["account_id"] },
  { key: "model", source: ["model", "requested_model"] }, { key: "inbound_endpoint", source: ["inbound_endpoint", "endpoint", "path"] },
  { key: "upstream_endpoint", source: ["upstream_endpoint"] }, { key: "group", source: ["group_id"] }, { key: "request_type", source: ["request_type"] },
  { key: "stream", source: ["stream"] }, { key: "is_stream", source: ["is_stream"] }, { key: "billing_type", source: ["billing_type", "billing_mode"] },
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

async function getFilterOptions(db: Db, hasBillingType: boolean): Promise<FilterOptions> {
  const billingExpression = hasBillingType ? "to_jsonb(ul)->>'billing_type'" : "to_jsonb(ul)->>'billing_mode'";
  const [users, accounts, endpoints, groups, billingTypes] = await Promise.all([
    db.pool.query<{ value: string; label: string; hint: string }>(`SELECT DISTINCT ul.user_id::text AS value, COALESCE(NULLIF(u.email, ''), NULLIF(u.username, ''), CONCAT('用户 #', ul.user_id)) AS label, CONCAT('用户 #', ul.user_id) AS hint FROM usage_logs ul LEFT JOIN users u ON u.id = ul.user_id WHERE ul.user_id IS NOT NULL ORDER BY label`),
    db.pool.query<{ value: string; label: string; hint: string }>(`SELECT DISTINCT ul.account_id::text AS value, COALESCE(NULLIF(a.name, ''), CONCAT('上游账号 #', ul.account_id)) AS label, CONCAT('账号 #', ul.account_id) AS hint FROM usage_logs ul LEFT JOIN accounts a ON a.id = ul.account_id WHERE ul.account_id IS NOT NULL ORDER BY label`),
    db.pool.query<{ value: string; label: string }>(`SELECT DISTINCT COALESCE(NULLIF(to_jsonb(ul)->>'inbound_endpoint', ''), NULLIF(to_jsonb(ul)->>'endpoint', ''), NULLIF(to_jsonb(ul)->>'path', '')) AS value, COALESCE(NULLIF(to_jsonb(ul)->>'inbound_endpoint', ''), NULLIF(to_jsonb(ul)->>'endpoint', ''), NULLIF(to_jsonb(ul)->>'path', '')) AS label FROM usage_logs ul WHERE COALESCE(NULLIF(to_jsonb(ul)->>'inbound_endpoint', ''), NULLIF(to_jsonb(ul)->>'endpoint', ''), NULLIF(to_jsonb(ul)->>'path', '')) IS NOT NULL ORDER BY label`),
    db.pool.query<{ value: string; label: string; hint: string }>(`SELECT DISTINCT COALESCE(ul.group_id::text, '__null__') AS value, CASE WHEN ul.group_id IS NULL THEN '未分组' ELSE COALESCE(NULLIF(g.name, ''), CONCAT('分组 #', ul.group_id)) END AS label, CASE WHEN ul.group_id IS NULL THEN 'group_id = NULL' ELSE CONCAT('分组 #', ul.group_id) END AS hint FROM usage_logs ul LEFT JOIN "groups" g ON g.id = ul.group_id ORDER BY label`),
    db.pool.query<{ value: string; label: string }>(`SELECT DISTINCT ${billingExpression} AS value, ${billingExpression} AS label FROM usage_logs ul WHERE ${billingExpression} IS NOT NULL ORDER BY value`)
  ]);
  return { users: optionRows(users.rows), accounts: optionRows(accounts.rows), inboundEndpoints: optionRows(endpoints.rows), groups: optionRows(groups.rows), billingTypes: billingTypes.rows.map((row) => ({ value: row.value, label: billingTypeLabel(row.value), hint: row.value })) };
}

export async function getUsageRecordFilterOptions(db: Db): Promise<FilterOptions> {
  const columnsResult = await db.pool.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_logs' ORDER BY ordinal_position`);
  return getFilterOptions(db, columnsResult.rows.some((row) => row.column_name === "billing_type"));
}

export async function getUsageRecords(params: { db: Db; range: DateRange; limit?: string; page?: string; defaultLimit: number; userIds?: string[]; accountIds?: string[]; inboundEndpoints?: string[]; groupIds?: string[]; billingTypes?: string[] }): Promise<{ columns: string[]; rows: UsageRecord[]; total: number; limit: number; page: number; pageCount: number; range: DateRange }> {
  const columnsResult = await params.db.pool.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_logs' ORDER BY ordinal_position`);
  const discoveredColumns = columnsResult.rows.map((row) => row.column_name);
  const columns = orderRecordColumns(discoveredColumns);
  const hasBillingType = discoveredColumns.includes("billing_type");
  const billingExpression = hasBillingType ? "to_jsonb(ul)->>'billing_type'" : "to_jsonb(ul)->>'billing_mode'";
  const values: unknown[] = [params.range.start, params.range.end];
  const conditions = ["ul.created_at >= $1", "ul.created_at < $2"];
  const addArrayFilter = (filterValues: string[] | undefined, expression: string, cast = "text") => { if (!filterValues?.length) return; values.push(filterValues); conditions.push(`${expression} = ANY($${values.length}::${cast}[])`); };
  addArrayFilter(params.userIds, "ul.user_id", "bigint"); addArrayFilter(params.accountIds, "ul.account_id", "bigint");
  addArrayFilter(params.inboundEndpoints, "COALESCE(NULLIF(to_jsonb(ul)->>'inbound_endpoint', ''), NULLIF(to_jsonb(ul)->>'endpoint', ''), NULLIF(to_jsonb(ul)->>'path', ''))");
  if (params.groupIds?.length) { values.push(params.groupIds); conditions.push(`(ul.group_id::text = ANY($${values.length}::text[]) OR (ul.group_id IS NULL AND '__null__' = ANY($${values.length}::text[])))`); }
  addArrayFilter(params.billingTypes, billingExpression);
  const whereClause = conditions.join(" AND ");
  const totalResult = await params.db.pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM usage_logs ul WHERE ${whereClause}`, values);
  const total = Number(totalResult.rows[0]?.total || 0); const limit = normalizeLimit(params.limit, params.defaultLimit); const pageCount = Math.max(1, Math.ceil(total / limit)); const page = Math.min(normalizePage(params.page), pageCount); const offset = (page - 1) * limit;
  if (columns.length === 0) return { columns: [], rows: [], total, limit, page, pageCount, range: params.range };
  const orderColumn = columns.includes("created_at") ? "created_at" : columns[0]; const rowValues = [...values, limit];
  rowValues.push(offset);
  const result = await params.db.pool.query<{ record: UsageRecord }>(`SELECT to_jsonb(ul) || jsonb_build_object('user', COALESCE(NULLIF(u.email, ''), NULLIF(u.username, ''), CONCAT('用户 #', ul.user_id)) || CASE WHEN COALESCE(NULLIF(u.email, ''), NULLIF(u.username, '')) IS NULL THEN '' ELSE CONCAT(' #', ul.user_id) END, 'api_key', COALESCE(NULLIF(ak.name, ''), CONCAT('API Key #', ul.api_key_id)), 'account', COALESCE(NULLIF(a.name, ''), CONCAT('上游账号 #', ul.account_id)), 'inbound_endpoint', COALESCE(NULLIF(to_jsonb(ul)->>'inbound_endpoint', ''), NULLIF(to_jsonb(ul)->>'endpoint', ''), NULLIF(to_jsonb(ul)->>'path', '')), 'model', COALESCE(NULLIF(to_jsonb(ul)->>'requested_model', ''), NULLIF(to_jsonb(ul)->>'model', '')), 'group', CASE WHEN ul.group_id IS NULL THEN NULL ELSE COALESCE(NULLIF(g.name, ''), CONCAT('分组 #', ul.group_id)) END, 'billing_type', ${billingExpression}) AS record FROM usage_logs ul LEFT JOIN users u ON u.id = ul.user_id LEFT JOIN api_keys ak ON ak.id = ul.api_key_id LEFT JOIN accounts a ON a.id = ul.account_id LEFT JOIN "groups" g ON g.id = ul.group_id WHERE ${whereClause} ORDER BY ul.${quoteIdentifier(orderColumn)} DESC NULLS LAST LIMIT $${rowValues.length - 1} OFFSET $${rowValues.length}`, rowValues);
  return { columns, rows: result.rows.map((row) => row.record), total, limit, page, pageCount, range: params.range };
}

export type { FilterOption, FilterOptions, UsageRecord };
