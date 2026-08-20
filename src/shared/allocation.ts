/*
 * 文件说明: 读取普通用户系统余额，并把余额消耗或用量成本基准按比例分摊实际采购成本。
 */

import type { Db } from "../server/db.js";

const systemBalanceScale = 8;
const usageCostBasisScale = 10;
const actualCostScale = 2;
const maxSystemBalanceUnits = 99_999_999_999_999_999_999n;
const maxActualCostUnits = 99_999_999_999_999n;

const defaultInitialBalance = "5000";
const defaultActualCost = "1200";

type BalanceAccount = {
  userId: number;
  email: string;
  username: string;
  status: string;
  currentBalance: string;
};

type BalanceAllocationRow = BalanceAccount & {
  systemConsumed: string;
  sharePercent: string;
  allocatedCost: string;
};

type UsageCostBasisRow = {
  userId: number;
  costBasis: string;
  actualCost: string;
  totalCost: string;
};

type UsageCostAllocationRow = BalanceAccount & {
  costBasis: string;
  actualCost: string;
  totalCost: string;
  sharePercent: string;
  allocatedCost: string;
};

type UsageCostAllocationReport = {
  rows: UsageCostAllocationRow[];
  actualCost: string;
  summary: {
    accounts: number;
    consumingAccounts: number;
    totalCostBasis: string;
    allocatedCost: string;
    unallocatedCost: string;
  };
};

type BalanceReport = {
  rows: BalanceAllocationRow[];
  initialBalance: string;
  actualCost: string;
  summary: {
    accounts: number;
    consumingAccounts: number;
    totalSystemConsumed: string;
    allocatedCost: string;
    unallocatedCost: string;
  };
};

type UserBalanceQueryRow = {
  user_id: number | string;
  email: string;
  username: string;
  status: string;
  current_balance: string;
};

type WeightedAllocation<TAccount extends BalanceAccount> = {
  account: TAccount;
  basisUnits: bigint;
  allocatedCostUnits: bigint;
  remainder: bigint;
};

type WeightedAllocationResult<TAccount extends BalanceAccount> = {
  allocations: Array<WeightedAllocation<TAccount>>;
  totalBasisUnits: bigint;
  actualCost: string;
  actualCostUnits: bigint;
};

function powerOfTen(scale: number): bigint {
  return 10n ** BigInt(scale);
}

function parseFixedDecimal(value: string, scale: number): bigint | null {
  const match = value.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) {
    return null;
  }

  const fraction = match[3] || "";
  if (fraction.length > scale) {
    return null;
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const integerUnits = BigInt(match[2]) * powerOfTen(scale);
  const fractionUnits = BigInt(fraction.padEnd(scale, "0") || "0");
  return sign * (integerUnits + fractionUnits);
}

function formatFixedDecimal(units: bigint, scale: number, minimumFractionDigits = 0): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const divisor = powerOfTen(scale);
  const integer = absolute / divisor;
  const rawFraction = (absolute % divisor).toString().padStart(scale, "0");
  const trimmedFraction = rawFraction.replace(/0+$/, "");
  const fraction = trimmedFraction.padEnd(minimumFractionDigits, "0");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function normalizeFixedDecimal(params: {
  value: unknown;
  scale: number;
  maximumUnits: bigint;
  allowZero: boolean;
}): string | null {
  if (typeof params.value !== "string" && typeof params.value !== "number") {
    return null;
  }
  const units = parseFixedDecimal(String(params.value), params.scale);
  if (units === null || units < 0n || (!params.allowZero && units === 0n) || units > params.maximumUnits) {
    return null;
  }
  return formatFixedDecimal(units, params.scale);
}

function parseStoredBalance(value: string, userId: number): bigint {
  const units = parseFixedDecimal(value, systemBalanceScale);
  if (units === null) {
    throw new Error(`用户 #${userId} 的系统余额格式无效`);
  }
  return units;
}

function formatPercent(numerator: bigint, denominator: bigint): string {
  if (denominator === 0n || numerator === 0n) {
    return "0.0000%";
  }
  const scaled = (numerator * 1_000_000n + denominator / 2n) / denominator;
  const integer = scaled / 10_000n;
  const fraction = (scaled % 10_000n).toString().padStart(4, "0");
  return `${integer}.${fraction}%`;
}

function createWeightedAllocations<TAccount extends BalanceAccount>(params: {
  accounts: TAccount[];
  actualCost?: unknown;
  getBasisUnits: (account: TAccount) => bigint;
}): WeightedAllocationResult<TAccount> {
  const actualCost = normalizeActualCost(params.actualCost) || defaultActualCost;
  const actualCostUnits = parseFixedDecimal(actualCost, actualCostScale) as bigint;
  const allocations = params.accounts.map((account) => ({
    account,
    basisUnits: params.getBasisUnits(account),
    allocatedCostUnits: 0n,
    remainder: 0n
  }));
  const totalBasisUnits = allocations.reduce((sum, row) => sum + row.basisUnits, 0n);

  if (totalBasisUnits > 0n && actualCostUnits > 0n) {
    let allocatedUnits = 0n;
    for (const row of allocations) {
      const weightedCost = row.basisUnits * actualCostUnits;
      row.allocatedCostUnits = weightedCost / totalBasisUnits;
      row.remainder = weightedCost % totalBasisUnits;
      allocatedUnits += row.allocatedCostUnits;
    }

    const rankedRemainders = [...allocations].sort(
      (left, right) =>
        (left.remainder === right.remainder ? left.account.userId - right.account.userId : left.remainder > right.remainder ? -1 : 1)
    );
    const remainingUnits = actualCostUnits - allocatedUnits;
    for (let index = 0; BigInt(index) < remainingUnits; index += 1) {
      rankedRemainders[index].allocatedCostUnits += 1n;
    }
  }

  return {
    allocations,
    totalBasisUnits,
    actualCost,
    actualCostUnits
  };
}

export function normalizeInitialBalance(value: unknown): string | null {
  return normalizeFixedDecimal({
    value,
    scale: systemBalanceScale,
    maximumUnits: maxSystemBalanceUnits,
    allowZero: false
  });
}

export function normalizeActualCost(value: unknown): string | null {
  return normalizeFixedDecimal({
    value,
    scale: actualCostScale,
    maximumUnits: maxActualCostUnits,
    allowZero: true
  });
}

export function systemBalancesMatch(left: string, right: string): boolean {
  const leftUnits = parseFixedDecimal(left, systemBalanceScale);
  const rightUnits = parseFixedDecimal(right, systemBalanceScale);
  return leftUnits !== null && rightUnits !== null && leftUnits === rightUnits;
}

export function compareSystemBalancesDesc(left: string, right: string): number {
  const leftUnits = parseFixedDecimal(left, systemBalanceScale);
  const rightUnits = parseFixedDecimal(right, systemBalanceScale);
  if (leftUnits === null && rightUnits === null) return 0;
  if (leftUnits === null) return 1;
  if (rightUnits === null) return -1;
  if (leftUnits === rightUnits) return 0;
  return leftUnits > rightUnits ? -1 : 1;
}

export async function listBalanceAccounts(db: Db): Promise<BalanceAccount[]> {
  const result = await db.pool.query<UserBalanceQueryRow>(
    `
      SELECT
        id AS user_id,
        COALESCE(email, '') AS email,
        COALESCE(username, '') AS username,
        status,
        balance::text AS current_balance
      FROM users
      WHERE deleted_at IS NULL
        AND role = 'user'
      ORDER BY LOWER(COALESCE(NULLIF(email, ''), NULLIF(username, ''), id::text)), id
    `
  );

  return result.rows.map((row) => {
    const userId = Number(row.user_id);
    const currentBalance = formatFixedDecimal(parseStoredBalance(row.current_balance, userId), systemBalanceScale);
    return {
      userId,
      email: row.email,
      username: row.username,
      status: row.status,
      currentBalance
    };
  });
}

export function createBalanceReport(params: {
  accounts: BalanceAccount[];
  initialBalance?: unknown;
  actualCost?: unknown;
}): BalanceReport {
  const initialBalance = normalizeInitialBalance(params.initialBalance) || defaultInitialBalance;
  const initialUnits = parseFixedDecimal(initialBalance, systemBalanceScale) as bigint;
  const allocation = createWeightedAllocations({
    accounts: params.accounts,
    actualCost: params.actualCost,
    getBasisUnits(account) {
      const currentUnits = parseStoredBalance(account.currentBalance, account.userId);
      return initialUnits > currentUnits ? initialUnits - currentUnits : 0n;
    }
  });

  const rows = allocation.allocations
    .sort((left, right) =>
      left.basisUnits === right.basisUnits
        ? left.account.userId - right.account.userId
        : left.basisUnits > right.basisUnits
          ? -1
          : 1
    )
    .map<BalanceAllocationRow>((row) => ({
      ...row.account,
      systemConsumed: formatFixedDecimal(row.basisUnits, systemBalanceScale),
      sharePercent: formatPercent(row.basisUnits, allocation.totalBasisUnits),
      allocatedCost: formatFixedDecimal(row.allocatedCostUnits, actualCostScale, actualCostScale)
    }));

  const allocatedCostUnits = allocation.totalBasisUnits > 0n ? allocation.actualCostUnits : 0n;
  return {
    rows,
    initialBalance,
    actualCost: allocation.actualCost,
    summary: {
      accounts: rows.length,
      consumingAccounts: allocation.allocations.filter((row) => row.basisUnits > 0n).length,
      totalSystemConsumed: formatFixedDecimal(allocation.totalBasisUnits, systemBalanceScale),
      allocatedCost: formatFixedDecimal(allocatedCostUnits, actualCostScale, actualCostScale),
      unallocatedCost: formatFixedDecimal(allocation.actualCostUnits - allocatedCostUnits, actualCostScale, actualCostScale)
    }
  };
}

export function createUsageCostAllocationReport(params: {
  accounts: BalanceAccount[];
  costBasisRows: UsageCostBasisRow[];
  actualCost?: unknown;
}): UsageCostAllocationReport {
  const basisByUserId = new Map<number, bigint>();
  for (const row of params.costBasisRows) {
    const basisUnits = parseFixedDecimal(row.costBasis, usageCostBasisScale);
    if (basisUnits === null || basisUnits < 0n) {
      throw new Error(`用户 #${row.userId} 的用量成本基准格式无效`);
    }
    basisByUserId.set(row.userId, basisUnits);
  }

  const allocation = createWeightedAllocations({
    accounts: params.accounts,
    actualCost: params.actualCost,
    getBasisUnits(account) {
      return basisByUserId.get(account.userId) || 0n;
    }
  });
  const rows = allocation.allocations
    .sort((left, right) =>
      left.basisUnits === right.basisUnits
        ? left.account.userId - right.account.userId
        : left.basisUnits > right.basisUnits
          ? -1
          : 1
    )
    .map<UsageCostAllocationRow>((row) => ({
      ...row.account,
      costBasis: formatFixedDecimal(row.basisUnits, usageCostBasisScale),
      actualCost: params.costBasisRows.find((basisRow) => basisRow.userId === row.account.userId)?.actualCost || "0",
      totalCost: params.costBasisRows.find((basisRow) => basisRow.userId === row.account.userId)?.totalCost || "0",
      sharePercent: formatPercent(row.basisUnits, allocation.totalBasisUnits),
      allocatedCost: formatFixedDecimal(row.allocatedCostUnits, actualCostScale, actualCostScale)
    }));

  const allocatedCostUnits = allocation.totalBasisUnits > 0n ? allocation.actualCostUnits : 0n;
  return {
    rows,
    actualCost: allocation.actualCost,
    summary: {
      accounts: rows.length,
      consumingAccounts: allocation.allocations.filter((row) => row.basisUnits > 0n).length,
      totalCostBasis: formatFixedDecimal(allocation.totalBasisUnits, usageCostBasisScale),
      allocatedCost: formatFixedDecimal(allocatedCostUnits, actualCostScale, actualCostScale),
      unallocatedCost: formatFixedDecimal(allocation.actualCostUnits - allocatedCostUnits, actualCostScale, actualCostScale)
    }
  };
}

export async function getBalanceReport(params: {
  db: Db;
  initialBalance?: unknown;
  actualCost?: unknown;
}): Promise<BalanceReport> {
  const accounts = await listBalanceAccounts(params.db);
  return createBalanceReport({
    accounts,
    initialBalance: params.initialBalance,
    actualCost: params.actualCost
  });
}

export { defaultActualCost, defaultInitialBalance };
export type { BalanceAccount, BalanceAllocationRow, BalanceReport, UsageCostAllocationReport, UsageCostAllocationRow, UsageCostBasisRow };
