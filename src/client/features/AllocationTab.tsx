/*
 * 文件说明: 成本分摊工作区，负责统计口径、账号选择和分摊结果展示。
 */

import { useMemo, useState } from "react";
import {
  createBalanceReport,
  createUsageCostAllocationReport
} from "../../shared/allocation.js";
import type { UsageCostAllocationRow } from "../../shared/allocation.js";
import { MetricGrid, accountIdsMatch, accountName, actualCostCurrencies, allocationBasisOptions, allocationBasisSortKey, compareAccountsByName, compareAllocationRows, idsFromAccounts, isNonZeroBalance, normalizeAccountIds, selectedAccounts, sortAllocationRowsForDisplay, toggleUserId, upstreamAccountName } from "./shared.js";
import { formatActualCost, formatInteger, formatSystemBalance, formatUsageCost } from "../format.js";
import type { ActualCostCurrency } from "../format.js";
import type { AllocationBasis } from "../../shared/usage-costs.js";
import type { DashboardData, UsageQuery, AllocationColumn, AllocationDisplayRow, AllocationSort, AllocationSortKey } from "./shared.js";

export function AllocationTab(props: {
  data: DashboardData;
  usageQuery: UsageQuery;
  selectedUserIds: Set<number>;
  onUsageQueryChange: (query: UsageQuery) => void;
  onSelectedUserIdsChange: (selectedUserIds: Set<number>) => void;
}) {
  const allocationBasis = props.usageQuery.allocationBasis || "balance";
  const isBalanceBasis = allocationBasis === "balance";
  const [initialBalance, setInitialBalance] = useState(props.data.defaults.initialBalance);
  const [actualCost, setActualCost] = useState(props.data.defaults.actualCost);
  const [actualCostCurrency, setActualCostCurrency] = useState<ActualCostCurrency>("CNY");
  const [allocationSort, setAllocationSort] = useState<AllocationSort>({
    key: allocationBasisSortKey(allocationBasis),
    order: "desc"
  });
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
  const allocationColumns: AllocationColumn[] = useMemo(() => {
    const systemBalanceColumn: AllocationColumn = {
      key: "current_balance",
      label: "系统余额",
      numeric: true,
      render: (row) => formatSystemBalance(row.currentBalance)
    };
    const systemConsumedColumn: AllocationColumn = {
      key: "system_consumed",
      label: "系统消耗（统计基准）",
      numeric: true,
      strong: true,
      render: (row) => row.basisValue
    };
    const actualCostColumn: AllocationColumn = {
      key: "actual_cost",
      label: allocationBasis === "actual_cost" ? "实际费用（统计基准）" : "实际费用",
      numeric: true,
      strong: allocationBasis === "actual_cost",
      render: (row) => row.actualCostValue
    };
    const totalCostColumn: AllocationColumn = {
      key: "total_cost",
      label: allocationBasis === "total_cost" ? "标准费用（统计基准）" : "标准费用",
      numeric: true,
      strong: allocationBasis === "total_cost",
      render: (row) => row.totalCostValue
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
        systemConsumedColumn,
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
      ...trailingColumns
    ];
  }, [actualCostCurrency, allocationBasis, isBalanceBasis]);
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
    setAllocationSort({ key: allocationBasisSortKey(nextBasis), order: "desc" });
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
    <section className="tab-panel is-active allocation-panel" aria-label="成本分摊">
      <div className="tool-panel">
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
            <div className="form-field balance-initial-field">
              <label htmlFor="initial-balance">初始系统余额</label>
              <input
                id="initial-balance"
                value={initialBalance}
                inputMode="decimal"
                onChange={(event) => setInitialBalance(event.target.value)}
              />
            </div>
          ) : null}
          {!isBalanceBasis ? (
            <>
              <div className="form-field allocation-start-field">
                <label htmlFor="allocation-start-at">开始时间</label>
                <input
                  id="allocation-start-at"
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
              </div>
              <div className="form-field allocation-end-field">
                <label htmlFor="allocation-end-at">结束时间</label>
                <input
                  id="allocation-end-at"
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
              </div>
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
      </div>

      <MetricGrid
        metrics={[
          { label: "参与账号", value: formatInteger(summary.accounts) },
          { label: consumingAccountsLabel, value: formatInteger(summary.consumingAccounts) },
          { label: basisTotalLabel, value: basisTotal },
          { label: "已分摊实际成本", value: formatActualCost(summary.allocatedCost, actualCostCurrency) }
        ]}
      />

      <div className="table-section">
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
      </div>
    </section>
  );
}
