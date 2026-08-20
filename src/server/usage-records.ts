/*
 * 文件说明: 查询 usage_logs 原始调用记录，并按数据库当前字段结构返回记录表数据。
 * 参考资料: Sub2API frontend/src/views/admin/UsageView.vue 与 components/admin/usage/UsageTable.vue。
 */

import type { DateRange } from "../shared/ranges.js";
import type { Db } from "./db.js";

type UsageRecord = Record<string, unknown>;

const hiddenRawIdentityColumns = new Set(["user_id", "api_key_id", "account_id", "group_id"]);
const recordDisplayColumns: Array<{ key: string; source: string[] }> = [
  { key: "user", source: ["user_id"] },
  { key: "api_key", source: ["api_key_id"] },
  { key: "account", source: ["account_id"] },
  { key: "model", source: ["model", "requested_model"] },
  { key: "inbound_endpoint", source: ["inbound_endpoint", "endpoint", "path"] },
  { key: "upstream_endpoint", source: ["upstream_endpoint"] },
  { key: "group", source: ["group_id"] },
  { key: "request_type", source: ["request_type"] },
  { key: "stream", source: ["stream"] },
  { key: "is_stream", source: ["is_stream"] },
  { key: "billing_mode", source: ["billing_mode"] },
  { key: "input_tokens", source: ["input_tokens"] },
  { key: "output_tokens", source: ["output_tokens"] },
  { key: "cache_read_tokens", source: ["cache_read_tokens"] },
  { key: "cache_creation_tokens", source: ["cache_creation_tokens"] },
  { key: "input_cost", source: ["input_cost"] },
  { key: "output_cost", source: ["output_cost"] },
  { key: "cache_read_cost", source: ["cache_read_cost"] },
  { key: "cache_creation_cost", source: ["cache_creation_cost"] },
  { key: "total_cost", source: ["total_cost"] },
  { key: "actual_cost", source: ["actual_cost"] },
  { key: "first_token_ms", source: ["first_token_ms"] },
  { key: "duration_ms", source: ["duration_ms"] },
  { key: "created_at", source: ["created_at"] },
  { key: "request_id", source: ["request_id"] },
  { key: "user_agent", source: ["user_agent"] },
  { key: "ip_address", source: ["ip_address"] }
];

function orderRecordColumns(discoveredColumns: string[]): string[] {
  const discovered = new Set(discoveredColumns);
  const columns = recordDisplayColumns
    .filter((column) => column.source.some((source) => discovered.has(source)))
    .map((column) => column.key);
  const displayColumns = new Set(columns);
  return [...columns, ...discoveredColumns.filter((column) => !hiddenRawIdentityColumns.has(column) && !displayColumns.has(column))];
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeLimit(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 10_000);
}

export async function getUsageRecords(params: {
  db: Db;
  range: DateRange;
  limit?: string;
  defaultLimit: number;
}): Promise<{ columns: string[]; rows: UsageRecord[]; total: number; limit: number; range: DateRange }> {
  const columnsResult = await params.db.pool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'usage_logs'
      ORDER BY ordinal_position
    `
  );
  const discoveredColumns = columnsResult.rows.map((row) => row.column_name);
  const columns = orderRecordColumns(discoveredColumns);
  const totalResult = await params.db.pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM usage_logs WHERE created_at >= $1 AND created_at < $2`,
    [params.range.start, params.range.end]
  );
  const total = Number(totalResult.rows[0]?.total || 0);
  if (columns.length === 0) {
    return { columns: [], rows: [], total, limit: normalizeLimit(params.limit, params.defaultLimit), range: params.range };
  }

  const limit = normalizeLimit(params.limit, params.defaultLimit);
  const orderColumn = columns.includes("created_at") ? "created_at" : columns[0];
  const result = await params.db.pool.query<{ record: UsageRecord }>(
    `
      SELECT to_jsonb(ul) || jsonb_build_object(
        'user', COALESCE(NULLIF(u.email, ''), NULLIF(u.username, ''), CONCAT('用户 #', ul.user_id)) ||
          CASE WHEN COALESCE(NULLIF(u.email, ''), NULLIF(u.username, '')) IS NULL THEN '' ELSE CONCAT(' #', ul.user_id) END,
        'api_key', COALESCE(NULLIF(ak.name, ''), CONCAT('API Key #', ul.api_key_id)),
        'account', COALESCE(NULLIF(a.name, ''), CONCAT('上游账号 #', ul.account_id)),
        'inbound_endpoint', COALESCE(NULLIF(to_jsonb(ul)->>'inbound_endpoint', ''), NULLIF(to_jsonb(ul)->>'endpoint', ''), NULLIF(to_jsonb(ul)->>'path', '')),
        'model', COALESCE(NULLIF(to_jsonb(ul)->>'requested_model', ''), NULLIF(to_jsonb(ul)->>'model', '')),
        'group', CASE WHEN ul.group_id IS NULL THEN NULL ELSE COALESCE(NULLIF(g.name, ''), CONCAT('分组 #', ul.group_id)) END
      ) AS record
      FROM usage_logs ul
      LEFT JOIN users u ON u.id = ul.user_id
      LEFT JOIN api_keys ak ON ak.id = ul.api_key_id
      LEFT JOIN accounts a ON a.id = ul.account_id
      LEFT JOIN "groups" g ON g.id = ul.group_id
      WHERE ul.created_at >= $1 AND ul.created_at < $2
      ORDER BY ul.${quoteIdentifier(orderColumn)} DESC NULLS LAST
      LIMIT $3
    `,
    [params.range.start, params.range.end, limit]
  );

  return { columns, rows: result.rows.map((row) => row.record), total, limit, range: params.range };
}

export type { UsageRecord };
