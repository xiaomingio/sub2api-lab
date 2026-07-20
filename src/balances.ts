/*
 * 文件说明: 读取全部普通用户的系统余额，并按系统消耗比例精确分摊实际采购成本。
 */

import type { Db } from "./db.js";

const systemBalanceScale = 8;
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
  const actualCost = normalizeActualCost(params.actualCost) || defaultActualCost;
  const initialUnits = parseFixedDecimal(initialBalance, systemBalanceScale) as bigint;
  const actualCostUnits = parseFixedDecimal(actualCost, actualCostScale) as bigint;
  const allocations = params.accounts.map((account) => {
    const currentUnits = parseStoredBalance(account.currentBalance, account.userId);
    const consumedUnits = initialUnits > currentUnits ? initialUnits - currentUnits : 0n;
    return {
      account,
      consumedUnits,
      allocatedCostUnits: 0n,
      remainder: 0n
    };
  });
  const totalConsumedUnits = allocations.reduce((sum, row) => sum + row.consumedUnits, 0n);

  if (totalConsumedUnits > 0n && actualCostUnits > 0n) {
    let allocatedUnits = 0n;
    for (const row of allocations) {
      const weightedCost = row.consumedUnits * actualCostUnits;
      row.allocatedCostUnits = weightedCost / totalConsumedUnits;
      row.remainder = weightedCost % totalConsumedUnits;
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

  const rows = allocations
    .sort((left, right) =>
      left.consumedUnits === right.consumedUnits
        ? left.account.userId - right.account.userId
        : left.consumedUnits > right.consumedUnits
          ? -1
          : 1
    )
    .map<BalanceAllocationRow>((row) => ({
      ...row.account,
      systemConsumed: formatFixedDecimal(row.consumedUnits, systemBalanceScale),
      sharePercent: formatPercent(row.consumedUnits, totalConsumedUnits),
      allocatedCost: formatFixedDecimal(row.allocatedCostUnits, actualCostScale, actualCostScale)
    }));

  const allocatedCostUnits = totalConsumedUnits > 0n ? actualCostUnits : 0n;
  return {
    rows,
    initialBalance,
    actualCost,
    summary: {
      accounts: rows.length,
      consumingAccounts: allocations.filter((row) => row.consumedUnits > 0n).length,
      totalSystemConsumed: formatFixedDecimal(totalConsumedUnits, systemBalanceScale),
      allocatedCost: formatFixedDecimal(allocatedCostUnits, actualCostScale, actualCostScale),
      unallocatedCost: formatFixedDecimal(actualCostUnits - allocatedCostUnits, actualCostScale, actualCostScale)
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
export type { BalanceAccount, BalanceAllocationRow, BalanceReport };
