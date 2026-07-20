/*
 * 文件说明: React 管理台主页面，组织成本分摊、余额恢复和用量统计三个独立工作区。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { compareSystemBalancesDesc, createBalanceReport, normalizeInitialBalance, systemBalancesMatch } from "../balances.js";
import { presetLabels } from "../ranges.js";
import type { BalanceAccount, BalanceAllocationRow } from "../balances.js";
import type { RangePreset } from "../ranges.js";
import type { UsageSortKey } from "../usage.js";
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
  restore: "余额恢复"
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

function initialTab(): DashboardTab {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "allocation" || tab === "restore" ? tab : "usage";
}

function initialUsageQuery(): UsageQuery {
  const params = new URLSearchParams(window.location.search);
  return {
    preset: params.get("preset") || undefined,
    startDate: params.get("start_date") || undefined,
    endDate: params.get("end_date") || undefined,
    sort: (params.get("sort") || undefined) as UsageSortKey | undefined,
    order: params.get("order") === "asc" ? "asc" : undefined
  };
}

function accountName(account: Pick<BalanceAccount, "email" | "username" | "userId">): string {
  return account.email || account.username || `用户 #${account.userId}`;
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
  if (tab === "usage") {
    if (usageQuery.preset) params.set("preset", usageQuery.preset);
    if (usageQuery.startDate) params.set("start_date", usageQuery.startDate);
    if (usageQuery.endDate) params.set("end_date", usageQuery.endDate);
    if (usageQuery.sort) params.set("sort", usageQuery.sort);
    if (usageQuery.order) params.set("order", usageQuery.order);
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

function sortAccountsBySystemConsumedDesc(accounts: BalanceAccount[], initialBalance: string): BalanceAllocationRow[] {
  const report = createBalanceReport({
    accounts,
    initialBalance,
    actualCost: "0"
  });
  return [...report.rows].sort(
    (left, right) =>
      compareZeroCurrentBalanceLast(left, right) ||
      compareSystemBalancesDesc(left.systemConsumed, right.systemConsumed) ||
      compareAccountsByName(left, right)
  );
}

function sortAllocationRowsForDisplay(rows: BalanceAllocationRow[]): BalanceAllocationRow[] {
  return [...rows].sort(
    (left, right) =>
      compareZeroCurrentBalanceLast(left, right) ||
      compareSystemBalancesDesc(left.systemConsumed, right.systemConsumed) ||
      compareAccountsByName(left, right)
  );
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
  selectedUserIds: Set<number>;
  onSelectedUserIdsChange: (selectedUserIds: Set<number>) => void;
}) {
  const [initialBalance, setInitialBalance] = useState(props.data.defaults.initialBalance);
  const [actualCost, setActualCost] = useState(props.data.defaults.actualCost);
  const [actualCostCurrency, setActualCostCurrency] = useState<ActualCostCurrency>("CNY");
  const sortedAccounts = useMemo(
    () => sortAccountsBySystemConsumedDesc(props.data.balanceAccounts, initialBalance),
    [initialBalance, props.data.balanceAccounts]
  );
  const systemConsumedByUserId = useMemo(
    () => new Map(sortedAccounts.map((account) => [account.userId, "systemConsumed" in account ? account.systemConsumed : "0"])),
    [sortedAccounts]
  );
  const allocationReport = useMemo(
    () =>
      createBalanceReport({
        accounts: selectedAccounts(props.data.balanceAccounts, props.selectedUserIds),
        initialBalance,
        actualCost
      }),
    [actualCost, initialBalance, props.data.balanceAccounts, props.selectedUserIds]
  );
  const allocationRows = useMemo(() => sortAllocationRowsForDisplay(allocationReport.rows), [allocationReport.rows]);

  return (
    <section className="tab-panel is-active" aria-label="成本分摊">
      <div className="section-intro">
        <p>
          月结时使用：选择实际参与使用的账号，用“上月初始系统额度 - 当前系统余额”计算系统消耗，再按消耗占比分摊真实采购成本；这里只计算，不写入余额。
        </p>
      </div>

      <section className="tool-panel">
        <div className="form-grid">
          <label>
            <span>上月初始系统额度</span>
            <input value={initialBalance} inputMode="decimal" onChange={(event) => setInitialBalance(event.target.value)} />
          </label>
          <div className="form-field">
            <label htmlFor="actual-cost">实际采购总成本</label>
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
          <div className="inline-note">输入或勾选变化后自动重新计算</div>
        </div>
        <AccountPicker
          accounts={sortedAccounts}
          selectedUserIds={props.selectedUserIds}
          sortDescription="余额为 0 的账号排末尾，其余按系统消耗从高到低排列"
          getDetailSuffix={(account) => `系统消耗 ${formatSystemBalance(systemConsumedByUserId.get(account.userId) || "0")}`}
          onChange={props.onSelectedUserIdsChange}
        />
      </section>

      <MetricGrid
        metrics={[
          { label: "参与账号", value: formatInteger(allocationReport.summary.accounts) },
          { label: "有系统消耗", value: formatInteger(allocationReport.summary.consumingAccounts) },
          { label: "系统消耗合计", value: formatSystemBalance(allocationReport.summary.totalSystemConsumed) },
          { label: "已分摊实际成本", value: formatActualCost(allocationReport.summary.allocatedCost, actualCostCurrency) }
        ]}
      />

      <section className="table-section">
        <div className="table-header">
          <h2>分摊结果</h2>
          <span>余额为 0 的账号排末尾，其余按系统消耗从高到低排序</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>账号</th>
                <th className="num">当前系统余额</th>
                <th className="num">系统消耗</th>
                <th className="num">分摊比例</th>
                <th className="num">应承担采购成本</th>
              </tr>
            </thead>
            <tbody>
              {allocationRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    请选择参与上月分摊的账号后再计算
                  </td>
                </tr>
              ) : (
                allocationRows.map((row) => (
                  <tr key={row.userId}>
                    <td>
                      <div className="user-cell">
                        <span>{accountName(row)}</span>
                        <small>#{row.userId}</small>
                      </div>
                    </td>
                    <td className="num">{formatSystemBalance(row.currentBalance)}</td>
                    <td className="num strong">{formatSystemBalance(row.systemConsumed)}</td>
                    <td className="num">{row.sharePercent}</td>
                    <td className="num cost">{formatActualCost(row.allocatedCost, actualCostCurrency)}</td>
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

function RestoreTab(props: { data: DashboardData; onRefresh: () => void }) {
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
    <section className="tab-panel is-active" aria-label="余额恢复">
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
            {submitting ? "写入中" : "恢复所选账号"}
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
          <h2>确认恢复余额</h2>
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

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchDashboard(usageQuery);
      setData(payload);
      if (!allocationInitialized.current) {
        setAllocationSelectedUserIds(idsFromAccounts(payload.balanceAccounts.filter(isNonZeroBalance)));
        allocationInitialized.current = true;
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
              selectedUserIds={allocationSelectedUserIds}
              onSelectedUserIdsChange={setAllocationSelectedUserIds}
            />
          ) : null}
          {tab === "restore" ? <RestoreTab data={data} onRefresh={() => void loadDashboard()} /> : null}
        </>
      ) : null}
    </main>
  );
}
