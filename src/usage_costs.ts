/*
 * 文件说明: 读取 Sub2API 上游账号列表，并按用户聚合 usage_logs 中的成本分摊基准。
 */

import type { DateRange, DateTimeRange } from "./ranges.js";
import type { Db } from "./db.js";
import type { UsageCostBasisRow } from "./balances.js";

type AllocationBasis = "balance" | "actual_cost" | "total_cost";

type UsageCostMetric = Exclude<AllocationBasis, "balance">;

type UpstreamAccount = {
  accountId: number;
  name: string;
  platform: string;
  type: string;
  status: string;
};

type UsageCostBasisReport = {
  rows: UsageCostBasisRow[];
  metric: UsageCostMetric | null;
  accountIds: number[];
};

type UpstreamAccountQueryRow = {
  account_id: number | string;
  name: string;
  platform: string;
  type: string;
  status: string;
};

type UsageCostBasisQueryRow = {
  user_id: number | string;
  cost_basis: string;
  actual_cost: string;
  total_cost: string;
};

const costExpressionByMetric: Record<UsageCostMetric, string> = {
  actual_cost: "ul.actual_cost",
  total_cost: "ul.total_cost"
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

export function normalizeAllocationBasis(value: string | undefined): AllocationBasis {
  return value === "actual_cost" || value === "total_cost" ? value : "balance";
}

export function parseAccountIds(value: string | string[] | undefined): number[] {
  if (!value) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  const ids = values
    .flatMap((item) => item.split(","))
    .map((item) => Number(item.trim()))
    .filter((accountId) => Number.isInteger(accountId) && accountId > 0);
  return [...new Set(ids)].sort((left, right) => left - right);
}

export async function listUpstreamAccounts(db: Db): Promise<UpstreamAccount[]> {
  const result = await db.pool.query<UpstreamAccountQueryRow>(
    `
      SELECT
        id AS account_id,
        name,
        platform,
        type,
        status
      FROM accounts
      WHERE deleted_at IS NULL
      ORDER BY LOWER(name), id
    `
  );

  return result.rows.map((row) => ({
    accountId: toNumber(row.account_id),
    name: row.name,
    platform: row.platform,
    type: row.type,
    status: row.status
  }));
}

export async function getUserUsageCostBasis(params: {
  db: Db;
  range: Pick<DateRange | DateTimeRange, "start" | "end">;
  metric: UsageCostMetric;
  accountIds: number[];
}): Promise<UsageCostBasisRow[]> {
  const costExpression = costExpressionByMetric[params.metric];
  const values: unknown[] = [params.range.start, params.range.end];
  const accountFilter = params.accountIds.length > 0 ? "AND ul.account_id = ANY($3::bigint[])" : "";
  if (params.accountIds.length > 0) {
    values.push(params.accountIds);
  }

  const result = await params.db.pool.query<UsageCostBasisQueryRow>(
    `
      SELECT
        ul.user_id,
        COALESCE(SUM(${costExpression}), 0)::numeric(30, 10)::text AS cost_basis,
        COALESCE(SUM(ul.actual_cost), 0)::numeric(30, 10)::text AS actual_cost,
        COALESCE(SUM(ul.total_cost), 0)::numeric(30, 10)::text AS total_cost
      FROM usage_logs ul
      WHERE ul.created_at >= $1
        AND ul.created_at < $2
        ${accountFilter}
      GROUP BY ul.user_id
      ORDER BY COALESCE(SUM(${costExpression}), 0) DESC, ul.user_id ASC
    `,
    values
  );

  return result.rows.map((row) => ({
    userId: toNumber(row.user_id),
    costBasis: row.cost_basis,
    actualCost: row.actual_cost,
    totalCost: row.total_cost
  }));
}

export async function getUsageCostBasisReport(params: {
  db: Db;
  range: Pick<DateRange | DateTimeRange, "start" | "end">;
  basis: AllocationBasis;
  accountIds: number[];
}): Promise<UsageCostBasisReport> {
  const accountIds = parseAccountIds(params.accountIds.map(String));
  if (params.basis === "balance") {
    return {
      rows: await getUserUsageCostBasis({
        db: params.db,
        range: params.range,
        metric: "actual_cost",
        accountIds
      }),
      metric: null,
      accountIds
    };
  }

  return {
    rows: await getUserUsageCostBasis({
      db: params.db,
      range: params.range,
      metric: params.basis,
      accountIds
    }),
    metric: params.basis,
    accountIds
  };
}

export type { AllocationBasis, UpstreamAccount, UsageCostBasisReport, UsageCostMetric };
