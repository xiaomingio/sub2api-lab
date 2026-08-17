/*
 * 文件说明: React 管理台主页面，组织成本分摊、余额设置和用量统计三个独立工作区。
 */

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  compareSystemBalancesDesc,
  createBalanceReport,
  createUsageCostAllocationReport,
  normalizeInitialBalance,
  systemBalancesMatch
} from "../balances.js";
import { presetLabels } from "../ranges.js";
import type { BalanceAccount, BalanceAllocationRow, UsageCostAllocationRow } from "../balances.js";
import type { RangePreset } from "../ranges.js";
import type { UsageSortKey } from "../usage.js";
import type { AllocationBasis, UpstreamAccount } from "../usage_costs.js";
import { fetchDashboard, restoreBalances } from "./api.js";
import {
  type ActualCostCurrency,
  formatActualCost,
  formatDateTime,
  formatInteger,
  formatSystemBalance,
  formatUsageCost
} from "./format.js";
import type { DashboardData, DashboardTab, RestoreResult, UsageQuery } from "./types.js";

const tabLabels: Record<DashboardTab, string> = {
  usage: "用量统计",
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

const presetOrder: RangePreset[] = [
  "today",
  "yesterday",
  "last_24_hours",
  "sub2api_last_24_hours",
  "last_7_days",
  "last_14_days",
  "last_30_days",
  "this_month",
  "last_month"
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
  | "actual_cost"
  | "total_cost"
  | "basis"
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
  return tab === "allocation" || tab === "balance" ? tab : "usage";
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
    allocationEndAt: params.get("allocation_end_at") || undefined
  };
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
  if (tab === "usage" || tab === "allocation") {
    if (usageQuery.preset) params.set("preset", usageQuery.preset);
    if (usageQuery.startDate) params.set("start_date", usageQuery.startDate);
    if (usageQuery.endDate) params.set("end_date", usageQuery.endDate);
  }
  if (tab === "usage") {
    if (usageQuery.sort) params.set("sort", usageQuery.sort);
    if (usageQuery.order) params.set("order", usageQuery.order);
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

function compareAllocationRows(left: AllocationDisplayRow, right: AllocationDisplayRow, key: AllocationSortKey): number {
  if (key === "user") {
    return compareAccountsByName(left, right);
  }
  const leftValue =
    key === "current_balance"
      ? left.currentBalance
      : key === "actual_cost"
        ? left.actualCostValue
        : key === "total_cost"
          ? left.totalCostValue
          : key === "basis"
            ? left.basisValue
            : key === "share_percent"
              ? left.sharePercent
              : left.allocatedCost;
  const rightValue =
    key === "current_balance"
      ? right.currentBalance
      : key === "actual_cost"
        ? right.actualCostValue
        : key === "total_cost"
          ? right.totalCostValue
          : key === "basis"
            ? right.basisValue
            : key === "share_percent"
              ? right.sharePercent
              : right.allocatedCost;
  return parseDisplayNumber(leftValue) - parseDisplayNumber(rightValue);
}

function MetricGrid(props: { metrics: Array<{ label: string; value: string }> }) {
  return (
    <section className="metric-grid" aria-label="汇总">
      {props.metrics.map((metric) => (
        <article key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </article>
      ))}
    </section>
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

function AllocationTab(props: {
  data: DashboardData;
  usageQuery: UsageQuery;
  selectedUserIds: Set<number>;
  onUsageQueryChange: (query: UsageQuery) => void;
  onSelectedUserIdsChange: (selectedUserIds: Set<number>) => void;
}) {
  const [initialBalance, setInitialBalance] = useState(props.data.defaults.initialBalance);
  const [actualCost, setActualCost] = useState(props.data.defaults.actualCost);
  const [actualCostCurrency, setActualCostCurrency] = useState<ActualCostCurrency>("CNY");
  const [allocationSort, setAllocationSort] = useState<AllocationSort>({ key: "basis", order: "desc" });
  const allocationBasis = props.usageQuery.allocationBasis || "balance";
  const isBalanceBasis = allocationBasis === "balance";
  const selectedUpstreamAccountIds = isBalanceBasis ? [] : normalizeAccountIds(props.usageQuery.allocationAccountIds);
  const allocationRange = props.data.allocationRange;
  const allocationRangeMatches =
    (!props.usageQuery.allocationStartAt || props.usageQuery.allocationStartAt === allocationRange.startAt) &&
    (!props.usageQuery.allocationEndAt || props.usageQuery.allocationEndAt === allocationRange.endAt);
  const usageCostRowsMatch =
    props.data.allocationUsage.metric === (isBalanceBasis ? null : allocationBasis) &&
    accountIdsMatch(props.data.allocationUsage.accountIds, selectedUpstreamAccountIds) &&
    allocationRangeMatches;
  const usageCostRows = usageCostRowsMatch ? props.data.allocationUsage.rows : [];
  const usageCostByUserId = useMemo(() => new Map(usageCostRows.map((row) => [row.userId, row])), [usageCostRows]);
  const selectedAllocationAccounts = useMemo(
    () => selectedAccounts(props.data.balanceAccounts, props.selectedUserIds),
    [props.data.balanceAccounts, props.selectedUserIds]
  );
  const balanceAllocationReport = useMemo(
    () =>
      createBalanceReport({
        accounts: selectedAllocationAccounts,
        initialBalance,
        actualCost
      }),
    [actualCost, initialBalance, selectedAllocationAccounts]
  );
  const allBalanceRows = useMemo(
    () =>
      sortAllocationRowsForDisplay(
        createBalanceReport({
          accounts: props.data.balanceAccounts,
          initialBalance,
          actualCost: "0"
        }).rows
      ),
    [initialBalance, props.data.balanceAccounts]
  );
  const selectedUsageCostAllocationReport = useMemo(
    () =>
      createUsageCostAllocationReport({
        accounts: selectedAllocationAccounts,
        costBasisRows: usageCostRows,
        actualCost
      }),
    [actualCost, selectedAllocationAccounts, usageCostRows]
  );
  const allUsageCostRows = useMemo(
    () =>
      createUsageCostAllocationReport({
        accounts: props.data.balanceAccounts,
        costBasisRows: usageCostRows,
        actualCost: "0"
      }).rows,
    [props.data.balanceAccounts, usageCostRows]
  );
  const allocationRows = useMemo<AllocationDisplayRow[]>(() => {
    if (isBalanceBasis) {
      const selectedRowsByUserId = new Map(balanceAllocationReport.rows.map((row) => [row.userId, row]));
      return allBalanceRows.map((row) => ({
        ...row,
        actualCostValue: formatUsageCost(Number(usageCostByUserId.get(row.userId)?.actualCost || "0")),
        totalCostValue: formatUsageCost(Number(usageCostByUserId.get(row.userId)?.totalCost || "0")),
        basisValue: formatSystemBalance(selectedRowsByUserId.get(row.userId)?.systemConsumed || "0"),
        selected: props.selectedUserIds.has(row.userId),
        sharePercent: selectedRowsByUserId.get(row.userId)?.sharePercent || "0.0000%",
        allocatedCost: selectedRowsByUserId.get(row.userId)?.allocatedCost || "0.00"
      }));
    }
    const selectedRowsByUserId = new Map(selectedUsageCostAllocationReport.rows.map((row) => [row.userId, row]));
    return allUsageCostRows.map((row: UsageCostAllocationRow) => ({
      ...row,
      basisValue: formatUsageCost(Number(row.costBasis)),
      actualCostValue: formatUsageCost(Number(row.actualCost)),
      totalCostValue: formatUsageCost(Number(row.totalCost)),
      selected: props.selectedUserIds.has(row.userId),
      sharePercent: selectedRowsByUserId.get(row.userId)?.sharePercent || "0.0000%",
      allocatedCost: selectedRowsByUserId.get(row.userId)?.allocatedCost || "0.00"
    }));
  }, [
    allBalanceRows,
    allUsageCostRows,
    balanceAllocationReport.rows,
    isBalanceBasis,
    props.selectedUserIds,
    selectedUsageCostAllocationReport.rows,
    usageCostByUserId
  ]);
  const summary = isBalanceBasis ? balanceAllocationReport.summary : selectedUsageCostAllocationReport.summary;
  const basisTotal = isBalanceBasis
    ? formatSystemBalance(balanceAllocationReport.summary.totalSystemConsumed)
    : formatUsageCost(Number(selectedUsageCostAllocationReport.summary.totalCostBasis));
  const basisTotalLabel =
    allocationBasis === "balance" ? "系统消耗合计" : allocationBasis === "actual_cost" ? "实际费用合计" : "标准费用合计";
  const consumingAccountsLabel =
    allocationBasis === "balance" ? "有系统消耗" : allocationBasis === "actual_cost" ? "有实际费用" : "有标准费用";
  const basisLabel =
    allocationBasis === "balance"
      ? "统计基准（系统消耗）"
      : allocationBasis === "actual_cost"
        ? "统计基准（实际费用）"
        : "统计基准（标准费用）";
  const allocationColumns: AllocationColumn[] = useMemo(() => {
    const systemBalanceColumn: AllocationColumn = {
      key: "current_balance",
      label: "系统余额",
      numeric: true,
      render: (row) => formatSystemBalance(row.currentBalance)
    };
    const actualCostColumn: AllocationColumn = {
      key: "actual_cost",
      label: "实际费用",
      numeric: true,
      render: (row) => row.actualCostValue
    };
    const totalCostColumn: AllocationColumn = {
      key: "total_cost",
      label: "标准费用",
      numeric: true,
      render: (row) => row.totalCostValue
    };
    const basisColumn: AllocationColumn = {
      key: "basis",
      label: basisLabel,
      numeric: true,
      strong: true,
      render: (row) => row.basisValue
    };
    const trailingColumns: AllocationColumn[] = [
      {
        key: "share_percent",
        label: "分摊比例",
        numeric: true,
        render: (row) => row.sharePercent
      },
      {
        key: "allocated_cost",
        label: "分担成本",
        numeric: true,
        cost: true,
        render: (row) => formatActualCost(row.allocatedCost, actualCostCurrency)
      }
    ];

    if (isBalanceBasis) {
      return [
        {
          key: "user",
          label: "账号",
          render: (row) => (
            <div className="user-cell">
              <span>{accountName(row)}</span>
              <small>#{row.userId}</small>
            </div>
          )
        },
        systemBalanceColumn,
        totalCostColumn,
        actualCostColumn,
        basisColumn,
        ...trailingColumns
      ];
    }

    return [
      {
        key: "user",
        label: "账号",
        render: (row) => (
          <div className="user-cell">
            <span>{accountName(row)}</span>
            <small>#{row.userId}</small>
          </div>
        )
      },
      systemBalanceColumn,
      totalCostColumn,
      actualCostColumn,
      basisColumn,
      ...trailingColumns
    ];
  }, [actualCostCurrency, basisLabel, isBalanceBasis]);
  const sortedAllocationRows = useMemo(
    () =>
      [...allocationRows].sort((left, right) => {
        const comparison = compareAllocationRows(left, right, allocationSort.key) || compareAccountsByName(left, right);
        return allocationSort.order === "asc" ? comparison : -comparison;
      }),
    [allocationRows, allocationSort]
  );

  function sortAllocationBy(key: AllocationSortKey) {
    setAllocationSort((current) => ({
      key,
      order: current.key === key && current.order === "desc" ? "asc" : "desc"
    }));
  }

  function changeAllocationBasis(nextBasis: AllocationBasis) {
    if (nextBasis === "balance") {
      props.onSelectedUserIdsChange(idsFromAccounts(props.data.balanceAccounts.filter(isNonZeroBalance)));
    }
    props.onUsageQueryChange({
      ...props.usageQuery,
      allocationBasis: nextBasis,
      allocationAccountIds: nextBasis === "balance" ? [] : selectedUpstreamAccountIds
    });
  }

  function changeUpstreamAccount(accountId: number, checked: boolean) {
    const nextIds = new Set(selectedUpstreamAccountIds);
    if (checked) {
      nextIds.add(accountId);
    } else {
      nextIds.delete(accountId);
    }
    props.onUsageQueryChange({
      ...props.usageQuery,
      allocationAccountIds: normalizeAccountIds([...nextIds])
    });
  }

  function selectAllAllocationRows() {
    const nextSelectedUserIds = new Set(props.selectedUserIds);
    for (const row of allocationRows) {
      nextSelectedUserIds.add(row.userId);
    }
    props.onSelectedUserIdsChange(nextSelectedUserIds);
  }

  function invertAllocationRows() {
    const nextSelectedUserIds = new Set(props.selectedUserIds);
    for (const row of allocationRows) {
      if (nextSelectedUserIds.has(row.userId)) {
        nextSelectedUserIds.delete(row.userId);
      } else {
        nextSelectedUserIds.add(row.userId);
      }
    }
    props.onSelectedUserIdsChange(nextSelectedUserIds);
  }

  return (
    <section className="tab-panel is-active" aria-label="成本分摊">
      <div className="section-intro">
        <p>
          月结时使用：按所选统计口径计算每个用户的消耗基准，再按占比分摊真实采购成本；这里只计算，不写入余额。
        </p>
      </div>

      <section className="tool-panel">
        <div className="form-grid allocation-form-grid">
          <div className="form-field">
            <span className="field-label-row">
              <span>统计口径</span>
              <span
                className="info-tooltip"
                tabIndex={0}
                role="img"
                aria-label="系统余额按初始额度减剩余额度计算；实际费用按设置的分组倍率计算，对应 usage_logs.actual_cost；标准费用按模型官方价格计算，对应 usage_logs.total_cost"
                data-tooltip={
                  "系统余额：初始额度 - 当前系统余额\n实际费用：按设置的分组倍率计算，字段 usage_logs.actual_cost\n标准费用：按模型官方价格计算，字段 usage_logs.total_cost"
                }
              >
                i
              </span>
            </span>
            <div className="currency-tabs" role="tablist" aria-label="统计口径">
              {allocationBasisOptions.map((option) => (
                <button
                  className={allocationBasis === option.value ? "is-active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={allocationBasis === option.value}
                  key={option.value}
                  onClick={() => changeAllocationBasis(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="actual-cost">采购总成本</label>
            <div className="amount-input">
              <input
                id="actual-cost"
                value={actualCost}
                inputMode="decimal"
                onChange={(event) => setActualCost(event.target.value)}
              />
              <div className="currency-tabs" role="tablist" aria-label="实际采购成本币种">
                {actualCostCurrencies.map((currency) => (
                  <button
                    className={actualCostCurrency === currency.value ? "is-active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={actualCostCurrency === currency.value}
                    key={currency.value}
                    onClick={() => setActualCostCurrency(currency.value)}
                  >
                    {currency.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {isBalanceBasis ? (
            <label className="balance-initial-field">
              <span>初始系统余额</span>
              <input value={initialBalance} inputMode="decimal" onChange={(event) => setInitialBalance(event.target.value)} />
            </label>
          ) : null}
          {!isBalanceBasis ? (
            <>
              <label className="allocation-start-field">
                <span>开始时间</span>
                <input
                  type="datetime-local"
                  value={allocationRange.startAt}
                  onChange={(event) =>
                    props.onUsageQueryChange({
                      ...props.usageQuery,
                      allocationStartAt: event.target.value,
                      allocationEndAt: props.usageQuery.allocationEndAt || allocationRange.endAt
                    })
                  }
                />
              </label>
              <label className="allocation-end-field">
                <span>结束时间</span>
                <input
                  type="datetime-local"
                  value={allocationRange.endAt}
                  onChange={(event) =>
                    props.onUsageQueryChange({
                      ...props.usageQuery,
                      allocationStartAt: props.usageQuery.allocationStartAt || allocationRange.startAt,
                      allocationEndAt: event.target.value
                    })
                  }
                />
              </label>
              <div className="form-field upstream-account-field">
                <span>上游账号</span>
                <div className="upstream-account-list" aria-label="上游账号">
                  {props.data.upstreamAccounts.length === 0 ? (
                    <span className="upstream-empty">暂无上游账号</span>
                  ) : (
                    props.data.upstreamAccounts.map((account) => (
                      <label className="upstream-account-option" title={`${upstreamAccountName(account)} · ${account.platform}/${account.type}`} key={account.accountId}>
                        <input
                          type="checkbox"
                          checked={selectedUpstreamAccountIds.includes(account.accountId)}
                          onChange={(event) => changeUpstreamAccount(account.accountId, event.target.checked)}
                        />
                        <span>{upstreamAccountName(account)}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </section>

      <MetricGrid
        metrics={[
          { label: "参与账号", value: formatInteger(summary.accounts) },
          { label: consumingAccountsLabel, value: formatInteger(summary.consumingAccounts) },
          { label: basisTotalLabel, value: basisTotal },
          { label: "已分摊实际成本", value: formatActualCost(summary.allocatedCost, actualCostCurrency) }
        ]}
      />

      <section className="table-section">
        <div className="table-header">
          <div className="table-title-actions">
            <h2>分摊结果</h2>
            <div className="table-selection-actions">
              <button className="ghost-button" type="button" disabled={allocationRows.length === 0} onClick={selectAllAllocationRows}>
                全选
              </button>
              <button className="ghost-button" type="button" disabled={allocationRows.length === 0} onClick={invertAllocationRows}>
                反选
              </button>
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="select-col">参与</th>
                {allocationColumns.map((column) => {
                  const active = allocationSort.key === column.key;
                  const marker = active ? (allocationSort.order === "desc" ? " ↓" : " ↑") : "";
                  return (
                    <th className={`${column.numeric ? "num " : ""}sortable`} key={column.label}>
                      <button type="button" onClick={() => sortAllocationBy(column.key)}>
                        {column.label}
                        {marker}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {allocationRows.length === 0 ? (
                <tr>
                  <td colSpan={allocationColumns.length + 1} className="empty-cell">
                    当前没有可展示的用户
                  </td>
                </tr>
              ) : (
                sortedAllocationRows.map((row) => (
                  <tr className={!row.selected ? "is-muted-row" : ""} key={row.userId}>
                    <td className="select-col">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        aria-label={`选择 ${accountName(row)} 参与成本分摊`}
                        onChange={(event) =>
                          props.onSelectedUserIdsChange(toggleUserId(props.selectedUserIds, row.userId, event.target.checked))
                        }
                      />
                    </td>
                    {allocationColumns.map((column) => (
                      <td
                        className={`${column.numeric ? "num " : ""}${column.strong ? "strong " : ""}${column.cost ? "cost" : ""}`.trim()}
                        key={column.label}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function BalanceSettingsTab(props: { data: DashboardData; onRefresh: () => void }) {
  const [targetBalance, setTargetBalance] = useState(props.data.defaults.restoreTargetBalance);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ state: "success" | "warning" | "error"; text: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sortedAccounts = useMemo(() => sortAccountsByCurrentBalanceDesc(props.data.balanceAccounts), [props.data.balanceAccounts]);
  const selected = selectedAccounts(props.data.balanceAccounts, selectedUserIds);
  const canSubmit = props.data.restore.enabled && selected.length > 0 && Boolean(normalizeInitialBalance(targetBalance));

  useEffect(() => {
    if (confirming) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [confirming]);

  async function submitRestore() {
    setConfirming(false);
    setSubmitting(true);
    setResult({ state: "warning", text: "正在调用 Sub2API 管理接口写入所选账号余额。" });
    try {
      const payload = await restoreBalances({
        targetBalance,
        userIds: selected.map((account) => account.userId)
      });
      setResult(summarizeRestoreResult(props.data.balanceAccounts, payload));
    } catch (error) {
      setResult({ state: "error", text: error instanceof Error ? error.message : "写入失败，请稍后重试。" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="tab-panel is-active" aria-label="余额设置">
      <div className="section-intro">
        <p>
          下月开用前使用：只把勾选账号的系统余额覆盖为新的目标额度，未选择账号不会变化；提交前会再次确认，不影响成本分摊页的计算结果。
        </p>
      </div>

      {!props.data.restore.enabled ? <div className="status-message is-warning">{props.data.restore.disabledReason}</div> : null}

      <section className="tool-panel">
        <div className="form-grid">
          <label>
            <span>下月新系统额度</span>
            <input
              value={targetBalance}
              inputMode="decimal"
              disabled={!props.data.restore.enabled}
              onChange={(event) => setTargetBalance(event.target.value)}
            />
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={!canSubmit || submitting}
            onClick={() => setConfirming(true)}
          >
            {submitting ? "写入中" : "设置所选账号"}
          </button>
          <button className="ghost-button" type="button" onClick={props.onRefresh}>
            刷新当前余额
          </button>
        </div>
        <AccountPicker
          accounts={sortedAccounts}
          selectedUserIds={selectedUserIds}
          disabled={!props.data.restore.enabled || submitting}
          sortDescription="按当前系统余额从高到低排列"
          onChange={setSelectedUserIds}
        />
        {result ? <div className={`status-message is-${result.state}`}>{result.text}</div> : null}
      </section>

      <dialog className="confirm-dialog" ref={dialogRef} onCancel={() => setConfirming(false)}>
        <form method="dialog">
          <h2>确认设置系统余额</h2>
          <p>
            将把 {selected.length} 个账号的系统余额覆盖为 {formatSystemBalance(targetBalance)}。这会写入 Sub2API 并记录余额调整历史：
            {selected.map(accountName).join("、")}
          </p>
          <div className="dialog-actions">
            <button className="ghost-button" value="cancel" onClick={() => setConfirming(false)}>
              取消
            </button>
            <button className="primary-button" value="confirm" onClick={() => void submitRestore()}>
              确认写入
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}

function summarizeRestoreResult(accounts: BalanceAccount[], payload: RestoreResult) {
  const accountById = new Map(accounts.map((account) => [account.userId, account]));
  const updatedNames = payload.updatedUserIds.map((userId) => accountName(accountById.get(userId) || { userId, email: "", username: "" }));
  const parts = [];
  if (payload.updatedUserIds.length > 0) {
    parts.push(`已恢复 ${payload.updatedUserIds.length} 个账号：${updatedNames.join("、")}`);
  }
  if (payload.unchangedUserIds.length > 0) {
    parts.push(`已有 ${payload.unchangedUserIds.length} 个账号本来就是目标额度`);
  }
  if (payload.failures.length > 0) {
    parts.push(
      `失败 ${payload.failures.length} 个：${payload.failures
        .map((failure) => `${failure.displayName || `用户 #${failure.userId}`}（${failure.reason || "原因未知"}）`)
        .join("、")}`
    );
  }
  parts.push("当前页面保留写入前快照，主动刷新后可查看最新系统余额。");
  return {
    state: payload.failures.length > 0 ? "warning" : "success",
    text: parts.join("；")
  } as const;
}

function UsageTab(props: {
  data: DashboardData;
  usageQuery: UsageQuery;
  onUsageQueryChange: (query: UsageQuery) => void;
}) {
  const usage = props.data.usage;
  const [customStart, setCustomStart] = useState(usage.range.startDate);
  const [customEnd, setCustomEnd] = useState(usage.range.endDate);
  const rangePickerRef = useRef<HTMLDetailsElement>(null);
  const rangeText = `${formatDateTime(usage.range.start, props.data.timezone)} 至 ${formatDateTime(usage.range.end, props.data.timezone)}`;

  function closeRangePicker() {
    rangePickerRef.current?.removeAttribute("open");
  }

  function sortBy(key: UsageSortKey) {
    const active = usage.sort.key === key;
    props.onUsageQueryChange({
      ...props.usageQuery,
      sort: key,
      order: active && usage.sort.order === "desc" ? "asc" : "desc"
    });
  }

  return (
    <section className="tab-panel is-active" aria-label="用量统计">
      <div className="section-intro">
        <p>
          对账或排查用量时使用：按选择的时间范围汇总每个用户在 Sub2API 里的请求数、Token 和已记录费用；这里只读取调用记录，不做成本分摊，也不写入余额。
        </p>
      </div>

      <section className="range-section" aria-label="时间范围">
        <span className="section-label">时间范围：{rangeText}</span>
        <details className="range-picker" ref={rangePickerRef}>
          <summary>
            <span className="calendar-icon" aria-hidden="true"></span>
            <span>{usage.range.label}</span>
            <span className="chevron" aria-hidden="true"></span>
          </summary>
          <div className="range-panel">
            <div className="preset-grid">
              {presetOrder.map((preset) => (
                <button
                  className={`range-option${usage.range.preset === preset ? " is-active" : ""}`}
                  type="button"
                  key={preset}
                  onClick={() => {
                    props.onUsageQueryChange({ ...props.usageQuery, preset });
                    closeRangePicker();
                  }}
                >
                  {presetLabels[preset]}
                </button>
              ))}
            </div>
            <form
              className="custom-range"
              onSubmit={(event) => {
                event.preventDefault();
                props.onUsageQueryChange({
                  ...props.usageQuery,
                  preset: "custom",
                  startDate: customStart,
                  endDate: customEnd
                });
                closeRangePicker();
              }}
            >
              <label>
                <span>开始日期</span>
                <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
              </label>
              <span className="range-arrow" aria-hidden="true">
                -&gt;
              </span>
              <label>
                <span>结束日期</span>
                <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
              </label>
              <button className="apply-button" type="submit">
                应用
              </button>
            </form>
          </div>
        </details>
      </section>

      <MetricGrid
        metrics={[
          { label: "总费用", value: formatUsageCost(usage.summary.actualCost) },
          { label: "总 Token", value: formatInteger(usage.summary.totalTokens) },
          { label: "请求数", value: formatInteger(usage.summary.requests) },
          { label: "用户数", value: formatInteger(usage.summary.users) }
        ]}
      />

      <section className="table-section">
        <div className="table-header">
          <h2>用户用量汇总</h2>
          <span>最多显示 {formatInteger(props.data.maxRows)} 行</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {sortHeaders.map((header) => {
                  const active = usage.sort.key === header.key;
                  const marker = active ? (usage.sort.order === "desc" ? " ↓" : " ↑") : "";
                  return (
                    <th className={`${header.numeric ? "num " : ""}sortable`} key={header.key}>
                      <button type="button" onClick={() => sortBy(header.key)}>
                        {header.label}
                        {marker}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {usage.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-cell">
                    当前时间范围内没有可展示的用量记录
                  </td>
                </tr>
              ) : (
                usage.rows.map((row) => (
                  <tr key={row.userId}>
                    <td>
                      <div className="user-cell">
                        <span>{row.email || row.username || `用户 #${row.userId}`}</span>
                        <small>#{row.userId}</small>
                      </div>
                    </td>
                    <td className="num">{formatInteger(row.requests)}</td>
                    <td className="num">{formatInteger(row.inputTokens)}</td>
                    <td className="num">{formatInteger(row.outputTokens)}</td>
                    <td className="num">{formatInteger(row.cacheTokens)}</td>
                    <td className="num">{formatInteger(row.imageOutputTokens)}</td>
                    <td className="num strong">{formatInteger(row.totalTokens)}</td>
                    <td className="num">{formatUsageCost(row.standardCost)}</td>
                    <td className="num cost">{formatUsageCost(row.actualCost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

export function App() {
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  const [usageQuery, setUsageQuery] = useState<UsageQuery>(initialUsageQuery);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [allocationSelectedUserIds, setAllocationSelectedUserIds] = useState<Set<number>>(new Set());
  const allocationInitialized = useRef(false);
  const allocationSelectionKeyRef = useRef("");

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchDashboard(usageQuery);
      setData(payload);
      const nextAllocationSelectionKey = allocationSelectionKey(usageQuery);
      if (!allocationInitialized.current || allocationSelectionKeyRef.current !== nextAllocationSelectionKey) {
        setAllocationSelectedUserIds(defaultAllocationSelectedUserIds(payload, usageQuery.allocationBasis));
        allocationInitialized.current = true;
        allocationSelectionKeyRef.current = nextAllocationSelectionKey;
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载数据失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    updateUrl(tab, usageQuery);
  }, [tab, usageQuery]);

  useEffect(() => {
    void loadDashboard();
  }, [usageQuery]);

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <h1>{data?.title || "Sub2API Lab"}</h1>
        </div>
        <div className="top-actions">
          <form method="post" action="logout">
            <button className="logout-button" type="submit">
              退出
            </button>
          </form>
        </div>
      </header>

      <nav className="tab-nav" aria-label="功能标签页">
        {Object.entries(tabLabels).map(([key, label]) => (
          <button
            className={`tab-link${tab === key ? " is-active" : ""}`}
            type="button"
            key={key}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key as DashboardTab)}
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && !data ? <div className="status-message">正在加载数据。</div> : null}
      {error ? <div className="status-message is-error">{error}</div> : null}

      {data ? (
        <>
          {tab === "usage" ? (
            <UsageTab data={data} usageQuery={usageQuery} onUsageQueryChange={(query) => setUsageQuery(query)} />
          ) : null}
          {tab === "allocation" ? (
            <AllocationTab
              data={data}
              usageQuery={usageQuery}
              selectedUserIds={allocationSelectedUserIds}
              onUsageQueryChange={(query) => setUsageQuery(query)}
              onSelectedUserIdsChange={setAllocationSelectedUserIds}
            />
          ) : null}
          {tab === "balance" ? <BalanceSettingsTab data={data} onRefresh={() => void loadDashboard()} /> : null}
        </>
      ) : null}
    </main>
  );
}
