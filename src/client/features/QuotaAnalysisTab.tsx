/*
 * 文件说明: 额度分析一级 Tab，展示全量最近 7 天的本地 Token、费用和账号分析。
 * 说明: 上游窗口数据来自 accounts.extra 的数据库快照，不调用上游账号。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import echarts from "../components/charts.js";
import { Search } from "lucide-react";
import { fetchUsageAnalysis } from "../api.js";
import { DateRangePicker } from "../components/DateRangePicker.js";
import { formatAnalysisCost, formatDateTime, formatInteger, formatTokenAmount } from "../format.js";
import type { DashboardData, UsageAnalysisData, UsageQuery } from "../types.js";

type ChartType = "stacked" | "line";

export function QuotaAnalysisTab(props: { data: DashboardData; usageQuery: UsageQuery }) {
  const [granularity, setGranularity] = useState<"hour" | "day">("hour");
  const [quotaQuery, setQuotaQuery] = useState<UsageQuery>({ preset: "last_7_days" });
  const [analysis, setAnalysis] = useState<UsageAnalysisData | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [userCostBasis, setUserCostBasis] = useState<"actualCost" | "standardCost">("actualCost");
  const [userTokenChartType, setUserTokenChartType] = useState<ChartType>("stacked");
  const [userCostChartType, setUserCostChartType] = useState<ChartType>("stacked");
  const [accountChartType, setAccountChartType] = useState<ChartType>("stacked");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true); setError("");
    void fetchUsageAnalysis({ ...quotaQuery, recordUserIds: [], recordAccountIds: [], recordInboundEndpoints: [], recordGroupIds: [], recordBillingTypes: [] }, granularity, false)
      .then((result) => { setAnalysis(result); if (selectedAccountId && !result.quota.accounts.some((account) => account.accountId === selectedAccountId)) setSelectedAccountId(null); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "加载额度分析失败。"))
      .finally(() => setLoading(false));
  }, [granularity, quotaQuery]);
  const accounts = analysis?.quota.accounts || [];
  const visibleAccounts = useMemo(() => accounts.filter((account) => `${account.name} ${account.platform} ${account.accountId}`.toLowerCase().includes(accountSearch.trim().toLowerCase())), [accounts, accountSearch]);
  const selectedAccount = accounts.find((account) => account.accountId === selectedAccountId) || null;
  const filteredUserSeries = useMemo(() => (analysis?.quota.userSeries || []).filter((row) => selectedAccountId === null || row.accountId === selectedAccountId), [analysis?.quota.userSeries, selectedAccountId]);
  const quotaUserLabels = analysis?.quota.buckets || [];
  const quotaUserTokenSeries = useMemo(() => userSeries(filteredUserSeries, "tokens", quotaUserLabels), [filteredUserSeries, quotaUserLabels]);
  const quotaUserCostSeries = useMemo(() => userSeries(filteredUserSeries, userCostBasis, quotaUserLabels), [filteredUserSeries, userCostBasis, quotaUserLabels]);
  const userChartScope = selectedAccount ? `当前账号：${selectedAccount.name}` : "当前账号：全部账号";
  return <section className="tab-panel is-active quota-panel" aria-label="额度分析">
    <div className="quota-analysis-toolbar"><div><p className="section-eyebrow">QUOTA ANALYSIS</p><h2>额度分析</h2></div><div className="quota-toolbar-controls"><DateRangePicker range={analysis?.range || props.data.usage.range} timezone={props.data.timezone} onChange={(change) => setQuotaQuery((query) => ({ ...query, ...change }))} /><span>粒度</span><div className="segmented-control"><button className={granularity === "hour" ? "is-active" : ""} type="button" onClick={() => setGranularity("hour")}>小时</button><button className={granularity === "day" ? "is-active" : ""} type="button" onClick={() => setGranularity("day")}>每天</button></div></div></div>
    <div className="quota-kpi-grid"><Kpi label="本地 Token" value={formatTokenAmount(analysis?.quota.accounts.reduce((sum, account) => sum + account.tokens, 0) || 0)} hint="最近 7 天 usage_logs" /><Kpi label="实际扣费" value={formatAnalysisCost(analysis?.quota.accounts.reduce((sum, account) => sum + account.actualCost, 0) || 0)} hint="用户实际支付" /><Kpi label="账号成本" value={formatAnalysisCost(analysis?.quota.accounts.reduce((sum, account) => sum + account.standardCost, 0) || 0)} hint="本地标准费用" /><Kpi label="上游窗口" value={formatPercentAverage(analysis?.quota.accounts || [], "sevenDayUsedPercent")} hint="数据库快照平均值" /></div>
    {error ? <div className="status-message is-error">{error}</div> : null}
    {loading && !analysis ? <div className="status-message">正在加载额度分析。</div> : null}
    {analysis ? <>
      <section className="quota-section account-list-section"><div className="quota-section-heading"><div><p className="section-eyebrow">UPSTREAM ACCOUNTS</p><h3>账号列表</h3><p>点击账号后，下面三个区块同步切换为该账号数据。</p></div><label className="account-window-search"><Search size={15} aria-hidden="true" /><input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="搜索账号" /></label></div><div className="account-window-scroller"><AccountCard account={null} accounts={accounts} selected={selectedAccountId === null} onSelect={() => setSelectedAccountId(null)} />{visibleAccounts.map((account) => <AccountCard key={account.accountId} account={account} accounts={accounts} selected={selectedAccountId === account.accountId} onSelect={() => setSelectedAccountId(account.accountId)} />)}</div><AccountWindow account={selectedAccount} accounts={accounts} /></section>
      <section className="quota-section account-analysis-section"><div className="quota-section-heading"><div><p className="section-eyebrow">QUOTA WINDOW</p><h3>额度窗口（按模型）</h3><p>按当前选择的账号查看各模型 Token 消耗明细。</p></div><div className="quota-section-actions"><ChartTypeToggle value={accountChartType} onChange={setAccountChartType} /></div></div><div className="account-window-detail"><AccountUsageChart series={analysis.quota.series} buckets={analysis.quota.buckets} accountId={selectedAccountId} chartType={accountChartType} granularity={granularity} /></div></section>
      <QuotaChartSection title={`用户 Token 消耗 · ${selectedAccount?.name || "全部账号"}`} subtitle={`${userChartScope}；按用户汇总本地 Token，Top 10 之外合并为其他。`} chartType={userTokenChartType} onChartTypeChange={setUserTokenChartType}><StackedChart data={quotaUserTokenSeries} labels={quotaUserLabels} chartType={userTokenChartType} granularity={granularity} valueType="tokens" /></QuotaChartSection>
      <QuotaChartSection title={`用户费用趋势 · ${selectedAccount?.name || "全部账号"}`} subtitle={userCostBasis === "actualCost" ? `${userChartScope}；用户实际支付金额。` : `${userChartScope}；按本地定价规则计算的原始费用。`} chartType={userCostChartType} onChartTypeChange={setUserCostChartType} actions={<div className="segmented-control"><button className={userCostBasis === "actualCost" ? "is-active" : ""} type="button" onClick={() => setUserCostBasis("actualCost")}>实际费用</button><button className={userCostBasis === "standardCost" ? "is-active" : ""} type="button" onClick={() => setUserCostBasis("standardCost")}>原始费用</button></div>}><StackedChart data={quotaUserCostSeries} labels={quotaUserLabels} chartType={userCostChartType} granularity={granularity} valueType="cost" /></QuotaChartSection>
    </> : null}
  </section>;
}

function Kpi(props: { label: string; value: string; hint: string }) { return <div className="quota-kpi"><span>{props.label}</span><strong>{props.value}</strong><small>{props.hint}</small></div>; }
function QuotaChartSection(props: { title: string; subtitle: string; chartType: ChartType; onChartTypeChange: (value: ChartType) => void; actions?: ReactNode; children: ReactNode }) { return <section className="quota-section"><div className="quota-section-heading"><div><p className="section-eyebrow">LOCAL USAGE</p><h3>{props.title}</h3><p>{props.subtitle}</p></div><div className="quota-section-actions"><ChartTypeToggle value={props.chartType} onChange={props.onChartTypeChange} />{props.actions}</div></div>{props.children}</section>; }
function ChartTypeToggle(props: { value: ChartType; onChange: (value: ChartType) => void }) { return <div className="segmented-control" role="group" aria-label="图表类型"><button className={props.value === "stacked" ? "is-active" : ""} type="button" onClick={() => props.onChange("stacked")}>堆叠图</button><button className={props.value === "line" ? "is-active" : ""} type="button" onClick={() => props.onChange("line")}>折线图</button></div>; }
function AccountCard(props: { account: UsageAnalysisData["quota"]["accounts"][number] | null; accounts: UsageAnalysisData["quota"]["accounts"]; selected: boolean; onSelect: () => void }) { const account = props.account; const all = !account; const tokens = all ? props.accounts.reduce((sum, item) => sum + item.tokens, 0) : account.tokens; return <button className={`account-window-card${all ? " account-window-all" : ""}${props.selected ? " is-selected" : ""}`} type="button" onClick={props.onSelect}><span className="account-window-card-title">{all ? "全部账号" : <><i style={{ backgroundColor: accountColor(account.accountId) }} />{account.name}</>}</span>{all ? <span className="account-window-rate">{formatPercentAverage(props.accounts, "sevenDayUsedPercent")}</span> : <span className="account-window-rate">{formatWindowRate(account)}</span>}<span className="account-window-meter"><i style={{ width: `${all ? averagePercent(props.accounts, "sevenDayUsedPercent") : account.sevenDayUsedPercent || 0}%` }} /></span><dl><div><dt>下次重置</dt><dd>{all ? "多账号" : formatWindowDate(account.sevenDayResetAt)}</dd></div><div><dt>本地 Token</dt><dd>{formatTokenAmount(tokens)}</dd></div></dl></button>; }
function AccountWindow(props: { account: UsageAnalysisData["quota"]["accounts"][number] | null; accounts: UsageAnalysisData["quota"]["accounts"] }) { const account = props.account; const selectedAccounts = account ? [account] : props.accounts; const totalTokens = selectedAccounts.reduce((sum, item) => sum + item.tokens, 0); const standardCost = selectedAccounts.reduce((sum, item) => sum + item.standardCost, 0); const actualCost = selectedAccounts.reduce((sum, item) => sum + item.actualCost, 0); return <div className="account-window-summary"><div><span>当前选择</span><strong>{account?.name || "全部账号"}</strong></div><div><span>本地 Token</span><strong>{formatTokenAmount(totalTokens)}</strong></div><div><span>7 天使用率</span><strong>{account ? `${formatWindowRate(account)}` : formatPercentAverage(props.accounts, "sevenDayUsedPercent")}</strong></div><div><span>窗口起点 - 下次重置</span><strong>{account ? `${formatWindowDate(account.sevenDayWindowStart)} - ${formatWindowDate(account.sevenDayResetAt)}` : "按账号分别展示"}</strong></div><div><span>账号成本</span><strong>{formatAnalysisCost(standardCost)}</strong></div><div><span>实际扣费</span><strong>{formatAnalysisCost(actualCost)}</strong></div><div><span>数据更新时间</span><strong>{account ? formatWindowDate(account.usageUpdatedAt) : "按账号分别更新"}</strong></div></div>; }
function averagePercent(accounts: UsageAnalysisData["quota"]["accounts"], key: "fiveHourUsedPercent" | "sevenDayUsedPercent"): number { const values = accounts.map((account) => account[key]).filter((value): value is number => value !== null); return values.length ? Math.min(100, Math.max(0, values.reduce((sum, value) => sum + value, 0) / values.length)) : 0; }
function formatPercentAverage(accounts: UsageAnalysisData["quota"]["accounts"], key: "fiveHourUsedPercent" | "sevenDayUsedPercent"): string { const values = accounts.map((account) => account[key]).filter((value): value is number => value !== null); return values.length ? `${averagePercent(accounts, key).toFixed(0)}%` : "暂无数据"; }
function formatWindowRate(account: UsageAnalysisData["quota"]["accounts"][number]): string { return account.sevenDayUsedPercent === null ? "暂无数据" : `7d ${account.sevenDayUsedPercent.toFixed(0)}%`; }
function formatWindowDate(value: string | null): string { return value ? formatDateTime(value, "Asia/Shanghai") : "暂无数据"; }
function userLabels(rows: UsageAnalysisData["quota"]["userSeries"]): string[] { return [...new Set(rows.map((row) => row.bucket))]; }
function userSeries(rows: UsageAnalysisData["quota"]["userSeries"], metric: "tokens" | "actualCost" | "standardCost" = "tokens", labels = userLabels(rows)) { const totals = new Map<string, number>(); rows.forEach((row) => totals.set(row.label, (totals.get(row.label) || 0) + row[metric])); const topUsers = [...totals.entries()].sort((left, right) => right[1] - left[1]).slice(0, 10).map(([name]) => name); const grouped = new Map<string, Map<string, number>>(); rows.forEach((row) => { const name = topUsers.includes(row.label) ? row.label : "其他"; const buckets = grouped.get(name) || new Map<string, number>(); buckets.set(row.bucket, (buckets.get(row.bucket) || 0) + row[metric]); grouped.set(name, buckets); }); return [...grouped].map(([name, values]) => ({ name, values: labels.map((bucket) => values.get(bucket) || 0) })).sort((left, right) => { if (left.name === "其他") return 1; if (right.name === "其他") return -1; return right.values.reduce((sum, value) => sum + value, 0) - left.values.reduce((sum, value) => sum + value, 0); }); }
function AccountUsageChart(props: { series: UsageAnalysisData["quota"]["series"]; buckets: string[]; accountId: number | null; chartType: ChartType; granularity: "hour" | "day" }) { const chart = accountSeries(props.series, props.buckets, props.accountId); return <StackedChart data={chart.data} labels={chart.labels} tooltipDetails={chart.tooltipDetails} chartType={props.chartType} granularity={props.granularity} valueType="tokens" />; }
function accountSeries(series: UsageAnalysisData["quota"]["series"], labels: string[], accountId: number | null): { labels: string[]; data: Array<{ name: string; values: number[] }>; tooltipDetails: Record<string, Record<string, Record<string, number>>> } {
  const filtered = accountId === null ? series : series.filter((item) => item.accountId === accountId);
  const groups = new Map<string, Map<string, number>>();
  const tooltipDetails: Record<string, Record<string, Record<string, number>>> = {};
  for (const item of filtered) {
    const name = item.model;
    const values = groups.get(name) || new Map<string, number>();
    values.set(item.bucket, (values.get(item.bucket) || 0) + item.tokens);
    groups.set(name, values);
    const byModel = tooltipDetails[item.bucket] || {};
    const byType = byModel[name] || {};
    byType[item.tokenType] = (byType[item.tokenType] || 0) + item.tokens;
    byModel[name] = byType;
    tooltipDetails[item.bucket] = byModel;
  }
  const data = [...groups]
    .map(([name, values]) => ({ name, values: labels.map((bucket) => values.get(bucket) || 0) }))
    .sort((left, right) => right.values.reduce((sum, value) => sum + value, 0) - left.values.reduce((sum, value) => sum + value, 0));
  return { labels, tooltipDetails, data };
}
function accountColor(accountId: number): string { return ["#2563eb", "#8b5cf6", "#059669", "#d97706", "#e11d48", "#64748b"][accountId % 6]; }
function StackedChart(props: { data: Array<{ name: string; values: number[] }>; labels?: string[]; tooltipDetails?: Record<string, Record<string, Record<string, number>>>; chartType: ChartType; granularity: "hour" | "day"; valueType: "tokens" | "cost" }) { const ref = useRef<HTMLDivElement>(null); useEffect(() => { if (!ref.current) return; const chart = echarts.init(ref.current); chart.setOption({ tooltip: { trigger: "axis", formatter: (params: Array<{ axisValue: string; seriesName: string; value: number; marker: string }>) => { const bucket = params[0]?.axisValue || ""; const details = props.tooltipDetails?.[bucket]; const lines = params.map((item) => { const types = details?.[item.seriesName]; const breakdown = types ? Object.entries(types).map(([type, tokens]) => `${type} ${formatTokenAmount(tokens)}`).join(" / ") : ""; return `${item.marker}${item.seriesName}: ${formatChartValue(Number(item.value), props.valueType)}${breakdown ? `<br/><span style=\"padding-left:14px\">${breakdown}</span>` : ""}`; }); return `<strong>${bucket}</strong><br/>${lines.join("<br/>")}`; } }, legend: { type: "plain", orient: "horizontal", top: 4, left: 4, right: 4, height: 34, itemGap: 8, textStyle: { color: "#60716f", fontSize: 10 } }, grid: { top: 68, right: 20, bottom: 28, left: 58 }, xAxis: { type: "category", data: props.labels || (props.granularity === "day" ? ["最近 7 天"] : ["当前小时"]) }, yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatChartValue(value, props.valueType) } }, series: props.data.map((item, index) => ({ name: item.name, type: "line", ...(props.chartType === "stacked" ? { stack: "total", areaStyle: { opacity: 0.7 } } : {}), smooth: 0.18, symbol: "none", lineStyle: { width: 1 }, itemStyle: { color: ["#2563eb", "#8b5cf6", "#059669", "#d97706", "#e11d48", "#64748b"][index % 6] }, data: item.values })) }); const resize = () => chart.resize(); window.addEventListener("resize", resize); return () => { window.removeEventListener("resize", resize); chart.dispose(); }; }, [props.data, props.granularity, props.valueType, props.labels, props.tooltipDetails, props.chartType]); return <div ref={ref} className="quota-chart" aria-label="额度分析图表" />; }

function formatChartValue(value: number, valueType: "tokens" | "cost"): string { return valueType === "cost" ? formatAnalysisCost(value) : formatTokenAmount(value); }
