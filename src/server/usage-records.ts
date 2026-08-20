/*
 * 文件说明: 查询 usage_logs 原始调用记录，并按数据库当前字段结构返回记录表数据。
 */

import type { DateRange } from "../shared/ranges.js";
import type { Db } from "./db.js";

type UsageRecord = Record<string, unknown>;

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
  const columns = discoveredColumns.includes("created_at")
    ? ["created_at", ...discoveredColumns.filter((column) => column !== "created_at")]
    : discoveredColumns;
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
      SELECT to_jsonb(ul) AS record
      FROM usage_logs ul
      WHERE ul.created_at >= $1 AND ul.created_at < $2
      ORDER BY ul.${quoteIdentifier(orderColumn)} DESC NULLS LAST
      LIMIT $3
    `,
    [params.range.start, params.range.end, limit]
  );

  return { columns, rows: result.rows.map((row) => row.record), total, limit, range: params.range };
}

export type { UsageRecord };
