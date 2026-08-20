/*
 * 文件说明: 管理台共享的 Tab、查询状态、展示标签和成本分摊辅助逻辑。
 */

import type { ReactNode } from "react";
import {
  compareSystemBalancesDesc,
  systemBalancesMatch
} from "../../shared/allocation.js";
import type { BalanceAccount, BalanceAllocationRow } from "../../shared/allocation.js";
import type { UsageSortKey } from "../../shared/usage.js";
import type { AllocationBasis, UpstreamAccount } from "../../shared/usage-costs.js";
import {
  formatInteger,
  formatSystemBalance
} from "../format.js";
import type { ActualCostCurrency } from "../format.js";
import type { DashboardData, DashboardTab, RestoreResult, UsageQuery, UsageRecordsData } from "../types.js";

const tabLabels: Record<DashboardTab, string> = {
  usage: "用量统计",
  records: "使用记录",
  quota: "额度分析",
  allocation: "成本分摊",
  balance: "余额设置"
};

const sortHeaders: Array<{ key: UsageSortKey; label: string; numeric?: boolean }> = [
  { key: "user", label: "用户" },
  { key: "requests", label: "请求", numeric: true },
  { key: "input_tokens", label: "输入", numeric: true },
  { key: "output_tokens", label: "输出", numeric: true },
  { key: "cache_tokens", label: "缓存", numeric: true },
  { key: "image_output_tokens", label: "图片", numeric: true },
  { key: "total_tokens", label: "总 Token", numeric: true },
  { key: "standard_cost", label: "标准费用", numeric: true },
  { key: "actual_cost", label: "实际费用", numeric: true }
];

const actualCostCurrencies: Array<{ value: ActualCostCurrency; label: string }> = [
  { value: "CNY", label: "人民币" },
  { value: "USD", label: "美元" }
];

const allocationBasisOptions: Array<{ value: AllocationBasis; label: string }> = [
  { value: "balance", label: "系统余额" },
  { value: "actual_cost", label: "实际费用" },
  { value: "total_cost", label: "标准费用" }
];

type AllocationSortKey =
  | "user"
  | "current_balance"
  | "system_consumed"
  | "actual_cost"
  | "total_cost"
  | "share_percent"
  | "allocated_cost";

type AllocationSort = {
  key: AllocationSortKey;
  order: "asc" | "desc";
};

type AllocationDisplayRow = BalanceAccount & {
  actualCostValue: string;
  totalCostValue: string;
  basisValue: string;
  selected: boolean;
  sharePercent: string;
  allocatedCost: string;
};

type AllocationColumn = {
  key: AllocationSortKey;
  label: string;
  numeric?: boolean;
  strong?: boolean;
  cost?: boolean;
  render: (row: AllocationDisplayRow) => ReactNode;
};

function initialTab(): DashboardTab {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "allocation" || tab === "balance" || tab === "records" || tab === "quota" ? tab : "usage";
}

function initialUsageQuery(): UsageQuery {
  const params = new URLSearchParams(window.location.search);
  const allocationBasis = params.get("allocation_basis");
  return {
    preset: params.get("preset") || undefined,
    startDate: params.get("start_date") || undefined,
    endDate: params.get("end_date") || undefined,
    sort: (params.get("sort") || undefined) as UsageSortKey | undefined,
    order: params.get("order") === "asc" ? "asc" : undefined,
    allocationBasis: allocationBasis === "actual_cost" || allocationBasis === "total_cost" ? allocationBasis : "balance",
    allocationAccountIds: parseAccountIdsParam(params),
    allocationStartAt: params.get("allocation_start_at") || undefined,
    allocationEndAt: params.get("allocation_end_at") || undefined,
    recordUserIds: parseNumberList(params, "user_ids"),
    recordAccountIds: parseNumberList(params, "account_ids"),
    recordInboundEndpoints: parseStringList(params, "inbound_endpoints"),
    recordGroupIds: parseStringList(params, "group_ids"),
    recordBillingTypes: parseStringList(params, "billing_types")
  };
}

function parseStringList(params: URLSearchParams, key: string): string[] {
  return [...new Set(params.getAll(key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
}

function parseNumberList(params: URLSearchParams, key: string): number[] {
  return [...new Set(parseStringList(params, key).map(Number).filter((value) => Number.isInteger(value) && value > 0))];
}

function normalizeAccountIds(ids: Array<number | undefined> | undefined): number[] {
  if (!ids) {
    return [];
  }
  return [...new Set(ids.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0))].sort(
    (left, right) => left - right
  );
}

function parseAccountIdsParam(params: URLSearchParams): number[] {
  const rawValues = params.getAll("allocation_account_ids");
  return normalizeAccountIds(rawValues.flatMap((value) => value.split(",").map((item) => Number(item.trim()))));
}

function accountName(account: Pick<BalanceAccount, "email" | "username" | "userId">): string {
  return account.email || account.username || `用户 #${account.userId}`;
}

function parseDisplayNumber(value: string): number {
  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareAccountsByName(left: BalanceAccount, right: BalanceAccount): number {
  const nameComparison = accountName(left).localeCompare(accountName(right), "zh-Hans-u-co-pinyin", {
    numeric: true,
    sensitivity: "base"
  });
  return nameComparison || left.userId - right.userId;
}

function updateUrl(tab: DashboardTab, usageQuery: UsageQuery) {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (tab === "usage" || tab === "allocation" || tab === "quota") {
    if (usageQuery.preset) params.set("preset", usageQuery.preset);
    if (usageQuery.startDate) params.set("start_date", usageQuery.startDate);
    if (usageQuery.endDate) params.set("end_date", usageQuery.endDate);
  }
  if (tab === "usage") {
    if (usageQuery.sort) params.set("sort", usageQuery.sort);
    if (usageQuery.order) params.set("order", usageQuery.order);
  }
  if (tab === "records") {
    if (usageQuery.preset) params.set("preset", usageQuery.preset);
    if (usageQuery.startDate) params.set("start_date", usageQuery.startDate);
    if (usageQuery.endDate) params.set("end_date", usageQuery.endDate);
    if (usageQuery.recordUserIds?.length) params.set("user_ids", usageQuery.recordUserIds.join(","));
    if (usageQuery.recordAccountIds?.length) params.set("account_ids", usageQuery.recordAccountIds.join(","));
    if (usageQuery.recordInboundEndpoints?.length) params.set("inbound_endpoints", usageQuery.recordInboundEndpoints.join(","));
    if (usageQuery.recordGroupIds?.length) params.set("group_ids", usageQuery.recordGroupIds.join(","));
    if (usageQuery.recordBillingTypes?.length) params.set("billing_types", usageQuery.recordBillingTypes.join(","));
  }
  if (tab === "allocation" && usageQuery.allocationBasis && usageQuery.allocationBasis !== "balance") {
    params.set("allocation_basis", usageQuery.allocationBasis);
    if (usageQuery.allocationAccountIds && usageQuery.allocationAccountIds.length > 0) {
      params.set("allocation_account_ids", usageQuery.allocationAccountIds.join(","));
    }
    if (usageQuery.allocationStartAt) params.set("allocation_start_at", usageQuery.allocationStartAt);
    if (usageQuery.allocationEndAt) params.set("allocation_end_at", usageQuery.allocationEndAt);
  }
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

const recordLabels: Record<string, string> = {
  user: "用户",
  api_key: "API Key",
  account: "上游账号",
  inbound_endpoint: "入站接口",
  upstream_endpoint: "上游接口",
  group: "分组",
  id: "ID",
  user_id: "用户 ID",
  api_key_id: "API Key ID",
  account_id: "上游账号 ID",
  request_id: "请求 ID",
  provider: "提供商",
  platform: "平台",
  model: "模型",
  path: "路径",
  method: "请求方法",
  status: "状态",
  status_code: "状态码",
  error: "错误",
  error_message: "错误信息",
  created_at: "创建时间",
  updated_at: "更新时间",
  input_tokens: "输入 Token",
  output_tokens: "输出 Token",
  input_cost: "输入费用",
  output_cost: "输出费用",
  cache_creation_tokens: "缓存创建 Token",
  cache_read_tokens: "缓存读取 Token",
  cache_creation_cost: "缓存创建费用",
  cache_read_cost: "缓存读取费用",
  image_output_tokens: "图片输出 Token",
  total_tokens: "总 Token",
  total_cost: "标准费用",
  actual_cost: "实际费用",
  first_token_ms: "首 Token 延迟",
  duration_ms: "总耗时",
  request_type: "请求类型",
  billing_type: "计费类型",
  currency: "货币",
  stream: "流式响应",
  is_stream: "流式响应",
  metadata: "元数据",
  request_body: "请求内容",
  response_body: "响应内容"
};

function selectedAccounts(accounts: BalanceAccount[], selectedUserIds: Set<number>): BalanceAccount[] {
  return accounts.filter((account) => selectedUserIds.has(account.userId));
}

function idsFromAccounts(accounts: BalanceAccount[]): Set<number> {
  return new Set(accounts.map((account) => account.userId));
}

function isNonZeroBalance(account: BalanceAccount): boolean {
  return !systemBalancesMatch(account.currentBalance, "0");
}

function isPositiveDecimal(value: string | undefined): boolean {
  return Number(value || "0") > 0;
}

function defaultAllocationSelectedUserIds(data: DashboardData, allocationBasis: AllocationBasis | undefined): Set<number> {
  if (allocationBasis === "actual_cost" || allocationBasis === "total_cost") {
    return new Set(data.allocationUsage.rows.filter((row) => isPositiveDecimal(row.costBasis)).map((row) => row.userId));
  }
  return idsFromAccounts(data.balanceAccounts.filter(isNonZeroBalance));
}

function allocationSelectionKey(query: UsageQuery): string {
  const basis = query.allocationBasis || "balance";
  const accountIds = normalizeAccountIds(query.allocationAccountIds).join(",");
  return [basis, query.allocationStartAt || "", query.allocationEndAt || "", accountIds].join("|");
}

function sortAccountsByCurrentBalanceDesc(accounts: BalanceAccount[]): BalanceAccount[] {
  return [...accounts].sort(
    (left, right) => compareSystemBalancesDesc(left.currentBalance, right.currentBalance) || compareAccountsByName(left, right)
  );
}

function compareZeroCurrentBalanceLast(left: BalanceAccount, right: BalanceAccount): number {
  const leftIsZero = systemBalancesMatch(left.currentBalance, "0");
  const rightIsZero = systemBalancesMatch(right.currentBalance, "0");
  if (leftIsZero === rightIsZero) return 0;
  return leftIsZero ? 1 : -1;
}

function sortAllocationRowsForDisplay(rows: BalanceAllocationRow[]): BalanceAllocationRow[] {
  return [...rows].sort(
    (left, right) =>
      compareZeroCurrentBalanceLast(left, right) ||
      compareSystemBalancesDesc(left.systemConsumed, right.systemConsumed) ||
      compareAccountsByName(left, right)
  );
}

function upstreamAccountName(account: UpstreamAccount): string {
  return `${account.name} #${account.accountId}`;
}

function accountIdsMatch(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((id, index) => id === right[index]);
}

function toggleUserId(selectedUserIds: Set<number>, userId: number, checked: boolean): Set<number> {
  const next = new Set(selectedUserIds);
  if (checked) {
    next.add(userId);
  } else {
    next.delete(userId);
  }
  return next;
}

function allocationBasisSortKey(basis: AllocationBasis): AllocationSortKey {
  if (basis === "balance") {
    return "system_consumed";
  }
  return basis;
}

function compareAllocationRows(left: AllocationDisplayRow, right: AllocationDisplayRow, key: AllocationSortKey): number {
  if (key === "user") {
    return compareAccountsByName(left, right);
  }
  const leftValue =
    key === "current_balance"
      ? left.currentBalance
      : key === "system_consumed"
        ? left.basisValue
      : key === "actual_cost"
        ? left.actualCostValue
        : key === "total_cost"
          ? left.totalCostValue
          : key === "share_percent"
            ? left.sharePercent
            : left.allocatedCost;
  const rightValue =
    key === "current_balance"
      ? right.currentBalance
      : key === "system_consumed"
        ? right.basisValue
      : key === "actual_cost"
        ? right.actualCostValue
        : key === "total_cost"
          ? right.totalCostValue
          : key === "share_percent"
            ? right.sharePercent
            : right.allocatedCost;
  return parseDisplayNumber(leftValue) - parseDisplayNumber(rightValue);
}

function MetricGrid(props: { metrics: Array<{ label: string; value: string }> }) {
  return (
    <div className="metric-grid">
      {props.metrics.map((metric) => (
        <article key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </article>
      ))}
    </div>
  );
}

function AccountPicker(props: {
  accounts: BalanceAccount[];
  selectedUserIds: Set<number>;
  disabled?: boolean;
  sortDescription: string;
  getDetailSuffix?: (account: BalanceAccount) => string;
  onChange: (selectedUserIds: Set<number>) => void;
}) {
  const selectedCount = props.selectedUserIds.size;
  const setAll = (checked: boolean) => {
    props.onChange(checked ? idsFromAccounts(props.accounts) : new Set());
  };

  return (
    <>
      <div className="selection-head">
        <div>
          <h3>账号选择</h3>
          <p className="selection-meta">
            <span>{selectedCount === 0 ? "当前未选择账号" : `当前已选择 ${formatInteger(selectedCount)} 个账号`}</span>
            <span>{props.sortDescription}</span>
          </p>
        </div>
        <div className="selection-actions">
          <button className="ghost-button" type="button" disabled={props.disabled} onClick={() => setAll(true)}>
            全选
          </button>
          <button className="ghost-button" type="button" disabled={props.disabled} onClick={() => setAll(false)}>
            清空
          </button>
        </div>
      </div>

      <div className="account-grid">
        {props.accounts.map((account) => (
          <label className="account-option" key={account.userId}>
            <input
              type="checkbox"
              checked={props.selectedUserIds.has(account.userId)}
              disabled={props.disabled}
              onChange={(event) => {
                const next = new Set(props.selectedUserIds);
                if (event.target.checked) {
                  next.add(account.userId);
                } else {
                  next.delete(account.userId);
                }
                props.onChange(next);
              }}
            />
            <span>
              <strong>{accountName(account)}</strong>
              <small>
                #{account.userId} · 当前系统余额 {formatSystemBalance(account.currentBalance)}
                {props.getDetailSuffix ? ` · ${props.getDetailSuffix(account)}` : ""}
              </small>
            </span>
          </label>
        ))}
      </div>
    </>
  );
}



export {
  AccountPicker,
  MetricGrid,
  accountIdsMatch,
  accountName,
  actualCostCurrencies,
  allocationBasisOptions,
  allocationBasisSortKey,
  allocationSelectionKey,
  compareAccountsByName,
  compareAllocationRows,
  compareZeroCurrentBalanceLast,
  defaultAllocationSelectedUserIds,
  idsFromAccounts,
  initialTab,
  initialUsageQuery,
  isNonZeroBalance,
  isPositiveDecimal,
  normalizeAccountIds,
  parseAccountIdsParam,
  recordLabels,
  selectedAccounts,
  sortHeaders,
  sortAccountsByCurrentBalanceDesc,
  sortAllocationRowsForDisplay,
  tabLabels,
  toggleUserId,
  updateUrl,
  upstreamAccountName
};

export type {
  AllocationColumn,
  AllocationDisplayRow,
  AllocationSort,
  AllocationSortKey,
  DashboardData,
  DashboardTab,
  RestoreResult,
  UsageQuery,
  UsageRecordsData,
  UsageSortKey
};
