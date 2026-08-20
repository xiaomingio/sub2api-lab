/*
 * 文件说明: 定义 React 管理台使用的后端 JSON API 数据结构。
 */

import type { BalanceAccount } from "../shared/allocation.js";
import type { RangePreset } from "../shared/ranges.js";
import type { SortOrder, UsageRow, UsageSortKey } from "../shared/usage.js";
import type { AllocationBasis, UpstreamAccount, UsageCostBasisReport } from "../shared/usage-costs.js";

type SerializedDateRange = {
  preset: RangePreset;
  label: string;
  start: string;
  end: string;
  startDate: string;
  endDate: string;
};

type SerializedDateTimeRange = {
  start: string;
  end: string;
  startAt: string;
  endAt: string;
};

type SerializedUsageReport = {
  rows: UsageRow[];
  summary: {
    requests: number;
    users: number;
    totalTokens: number;
    actualCost: number;
    standardCost: number;
  };
  range: SerializedDateRange;
  sort: {
    key: UsageSortKey;
    order: SortOrder;
  };
};

type DashboardData = {
  title: string;
  basePath: string;
  timezone: string;
  maxRows: number;
  defaults: {
    initialBalance: string;
    actualCost: string;
    restoreTargetBalance: string;
  };
  restore: {
    enabled: boolean;
    disabledReason: string;
  };
  balanceAccounts: BalanceAccount[];
  upstreamAccounts: UpstreamAccount[];
  allocationRange: SerializedDateTimeRange;
  allocationUsage: UsageCostBasisReport;
  usage: SerializedUsageReport;
};

type RestoreFailure = {
  userId: number;
  displayName: string;
  reason: string;
};

type RestoreResult = {
  targetBalance: string;
  selectedUserIds: number[];
  updatedUserIds: number[];
  unchangedUserIds: number[];
  failures: RestoreFailure[];
};

type DashboardTab = "allocation" | "balance" | "usage" | "records";

type UsageQuery = {
  preset?: string;
  startDate?: string;
  endDate?: string;
  sort?: UsageSortKey;
  order?: SortOrder;
  allocationBasis?: AllocationBasis;
  allocationAccountIds?: number[];
  allocationStartAt?: string;
  allocationEndAt?: string;
};

type UsageRecordsData = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  range: SerializedDateRange;
};

export type { DashboardData, DashboardTab, RestoreFailure, RestoreResult, SerializedUsageReport, UsageQuery, UsageRecordsData };
