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

type DashboardTab = "allocation" | "balance" | "usage" | "records" | "quota";

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
  recordUserIds?: number[];
  recordAccountIds?: number[];
  recordInboundEndpoints?: string[];
  recordGroupIds?: string[];
  recordBillingTypes?: string[];
};

type UsageRecordsData = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  page: number;
  pageCount: number;
  range: SerializedDateRange;
};

type UsageRecordFilterOption = { value: string; label: string; hint?: string };
type UsageRecordFilterOptions = {
  users: UsageRecordFilterOption[];
  accounts: UsageRecordFilterOption[];
  inboundEndpoints: UsageRecordFilterOption[];
  groups: UsageRecordFilterOption[];
  billingTypes: UsageRecordFilterOption[];
};

type DistributionItem = { label: string; value: number };
type UsageAnalysisData = {
  range: SerializedDateRange;
  records: { model: DistributionItem[]; group: DistributionItem[]; endpoint: DistributionItem[]; billing: DistributionItem[] };
  quota: {
    accounts: Array<{
      accountId: number;
      name: string;
      platform: string;
      tokens: number;
      actualCost: number;
      standardCost: number;
      fiveHourUsedPercent: number | null;
      sevenDayUsedPercent: number | null;
      fiveHourWindowStart: string | null;
      sevenDayWindowStart: string | null;
      fiveHourResetAt: string | null;
      sevenDayResetAt: string | null;
      usageUpdatedAt: string | null;
    }>;
    users: Array<{ label: string; tokens: number; actualCost: number; standardCost: number }>;
    userSeries: Array<{ bucket: string; accountId: number | null; label: string; tokens: number; actualCost: number; standardCost: number }>;
    buckets: string[];
    series: Array<{ bucket: string; accountId: number | null; model: string; tokenType: string; tokens: number; actualCost: number; standardCost: number }>;
  };
};

export type { DashboardData, DashboardTab, DistributionItem, RestoreFailure, RestoreResult, SerializedUsageReport, UsageAnalysisData, UsageQuery, UsageRecordsData, UsageRecordFilterOption, UsageRecordFilterOptions };
