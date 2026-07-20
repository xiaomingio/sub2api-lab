/*
 * 文件说明: 查询 Sub2API usage_logs 和 users 表，返回按用户聚合的 token 和费用统计。
 */

import type { DateRange } from "./ranges.js";
import type { Db } from "./db.js";

type UsageRow = {
  userId: number;
  email: string;
  username: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  imageOutputTokens: number;
  totalTokens: number;
  standardCost: number;
  actualCost: number;
};

type UsageSortKey =
  | "user"
  | "requests"
  | "input_tokens"
  | "output_tokens"
  | "cache_tokens"
  | "image_output_tokens"
  | "total_tokens"
  | "standard_cost"
  | "actual_cost";

type SortOrder = "asc" | "desc";

type UsageSummary = {
  requests: number;
  users: number;
  totalTokens: number;
  actualCost: number;
  standardCost: number;
};

type UsageReport = {
  rows: UsageRow[];
  summary: UsageSummary;
  range: DateRange;
  sort: {
    key: UsageSortKey;
    order: SortOrder;
  };
};

const sortExpressions: Record<UsageSortKey, string> = {
  user: "display_user",
  requests: "requests",
  input_tokens: "input_tokens",
  output_tokens: "output_tokens",
  cache_tokens: "cache_tokens",
  image_output_tokens: "image_output_tokens",
  total_tokens: "total_tokens",
  standard_cost: "standard_cost",
  actual_cost: "actual_cost"
};

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number(value);
  }
  return 0;
}

export async function getUserUsageSummary(params: {
  db: Db;
  range: DateRange;
  timezone: string;
  limit: number;
  sortKey: string | undefined;
  sortOrder: string | undefined;
}): Promise<UsageReport> {
  const sortKey = normalizeSortKey(params.sortKey);
  const sortOrder = normalizeSortOrder(params.sortOrder);
  const imageTokensExpr = params.db.hasImageOutputTokens ? "COALESCE(ul.image_output_tokens, 0)" : "0";
  const orderDirection = sortOrder.toUpperCase();
  const orderBy = `${sortExpressions[sortKey]} ${orderDirection}, actual_cost DESC, total_tokens DESC, user_id ASC`;
  const result = await params.db.pool.query(
    `
      SELECT
        ul.user_id,
        COALESCE(u.email, '') AS email,
        COALESCE(u.username, '') AS username,
        LOWER(COALESCE(NULLIF(u.email, ''), NULLIF(u.username, ''), ul.user_id::text)) AS display_user,
        COUNT(*)::bigint AS requests,
        COALESCE(SUM(ul.input_tokens), 0)::bigint AS input_tokens,
        COALESCE(SUM(ul.output_tokens), 0)::bigint AS output_tokens,
        COALESCE(SUM(ul.cache_creation_tokens + ul.cache_read_tokens), 0)::bigint AS cache_tokens,
        COALESCE(SUM(${imageTokensExpr}), 0)::bigint AS image_output_tokens,
        COALESCE(SUM(
          ul.input_tokens
          + ul.output_tokens
          + ul.cache_creation_tokens
          + ul.cache_read_tokens
          + ${imageTokensExpr}
        ), 0)::bigint AS total_tokens,
        COALESCE(SUM(ul.total_cost), 0)::float8 AS standard_cost,
        COALESCE(SUM(ul.actual_cost), 0)::float8 AS actual_cost
      FROM usage_logs ul
      LEFT JOIN users u ON u.id = ul.user_id
      WHERE ul.created_at >= $1
        AND ul.created_at < $2
      GROUP BY ul.user_id, u.email, u.username
      ORDER BY ${orderBy}
      LIMIT $3
    `,
    [params.range.start, params.range.end, params.limit]
  );

  const rows = result.rows.map((row) => ({
    userId: toNumber(row.user_id),
    email: row.email,
    username: row.username,
    requests: toNumber(row.requests),
    inputTokens: toNumber(row.input_tokens),
    outputTokens: toNumber(row.output_tokens),
    cacheTokens: toNumber(row.cache_tokens),
    imageOutputTokens: toNumber(row.image_output_tokens),
    totalTokens: toNumber(row.total_tokens),
    standardCost: toNumber(row.standard_cost),
    actualCost: toNumber(row.actual_cost)
  }));

  const userIds = new Set(rows.map((row) => row.userId));
  const summary = rows.reduce<UsageSummary>(
    (acc, row) => ({
      requests: acc.requests + row.requests,
      users: userIds.size,
      totalTokens: acc.totalTokens + row.totalTokens,
      actualCost: acc.actualCost + row.actualCost,
      standardCost: acc.standardCost + row.standardCost
    }),
    { requests: 0, users: 0, totalTokens: 0, actualCost: 0, standardCost: 0 }
  );

  return {
    rows,
    summary,
    range: params.range,
    sort: {
      key: sortKey,
      order: sortOrder
    }
  };
}

function normalizeSortKey(value: string | undefined): UsageSortKey {
  if (value && Object.hasOwn(sortExpressions, value)) {
    return value as UsageSortKey;
  }
  return "actual_cost";
}

function normalizeSortOrder(value: string | undefined): SortOrder {
  return value === "asc" ? "asc" : "desc";
}

export type { SortOrder, UsageReport, UsageRow, UsageSortKey, UsageSummary };
