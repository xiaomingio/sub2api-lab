/*
 * 文件说明: 定义 React 管理台使用的后端 JSON API 数据结构。
 */

import type { BalanceAccount } from "../balances.js";
import type { RangePreset } from "../ranges.js";
import type { SortOrder, UsageRow, UsageSortKey } from "../usage.js";

type SerializedDateRange = {
  preset: RangePreset;
  label: string;
  start: string;
  end: string;
  startDate: string;
  endDate: string;
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

type DashboardTab = "allocation" | "restore" | "usage";

type UsageQuery = {
  preset?: string;
  startDate?: string;
  endDate?: string;
  sort?: UsageSortKey;
  order?: SortOrder;
};

export type { DashboardData, DashboardTab, RestoreFailure, RestoreResult, SerializedUsageReport, UsageQuery };
