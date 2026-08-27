/*
 * 文件说明: 额度分析一级 Tab，展示当前 7 天窗口的本地 Token、费用和账号分析。
 * 说明: 上游窗口数据直接读取 Sub2API 原始数据库中的 accounts.extra，不调用上游账号。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import echarts from "../components/charts.js";
import { Search } from "lucide-react";
import { fetchUsageAnalysis } from "../api.js";
import { DateRangePicker } from "../components/DateRangePicker.js";
import { LoadingSection } from "../components/LoadingSection.js";
import { AccountWindowCardList } from "../components/AccountWindowCards.js";
import { formatAnalysisCost, formatDateTime, formatInteger, formatTokenAmount } from "../format.js";
import { resolveDateRange } from "../../shared/ranges.js";
import type { DashboardData, UsageAnalysisData, UsageQuery } from "../types.js";
import { defaultPresetForTab } from "./shared.js";

type ChartType = "stacked" | "line";

export function QuotaAnalysisTab(props: { data: DashboardData; query: UsageQuery; onQueryChange: (query: UsageQuery) => void; analysisCache: Map<string, UsageAnalysisData> }) {
  const [granularity, setGranularity] = useState<"hour" | "day">("hour");
  const initialRequestKey = JSON.stringify([{ preset: defaultPresetForTab("quota") }, "hour"]);
  const [analysis, setAnalysis] = useState<UsageAnalysisData | null>(() => props.analysisCache.get(initialRequestKey) || null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [userCostBasis, setUserCostBasis] = useState<"actualCost" | "standardCost">("actualCost");
  const [userTokenChartType, setUserTokenChartType] = useState<ChartType>("stacked");
  const [userCostChartType, setUserCostChartType] = useState<ChartType>("stacked");
  const [accountChartType, setAccountChartType] = useState<ChartType>("stacked");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const requestKey = JSON.stringify([props.query, granularity]);
    const cachedAnalysis = props.analysisCache.get(requestKey);
    if (cachedAnalysis) {
      setAnalysis(cachedAnalysis);
      setLoading(false);
      return;
    }
    setLoading(true); setError("");
    void fetchUsageAnalysis({ ...props.query, recordUserIds: [], recordAccountIds: [], recordInboundEndpoints: [], recordGroupIds: [], recordBillingTypes: [] }, granularity, false)
      .then((result) => { props.analysisCache.set(requestKey, result); setAnalysis(result); if (selectedAccountId && !result.quota.accounts.some((account) => account.accountId === selectedAccountId)) setSelectedAccountId(null); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "加载额度分析失败。"))
      .finally(() => setLoading(false));
  }, [granularity, props.analysisCache, props.query, selectedAccountId]);
  const accounts = analysis?.quota.accounts || [];
  const visibleAccounts = useMemo(() => accounts.filter((account) => `${account.name} ${account.platform} ${account.accountId}`.toLowerCase().includes(accountSearch.trim().toLowerCase())), [accounts, accountSearch]);
  const selectedAccount = accounts.find((account) => account.accountId === selectedAccountId) || null;
  const filteredUserSeries = useMemo(() => (analysis?.quota.userSeries || []).filter((row) => selectedAccountId === null || row.accountId === selectedAccountId), [analysis?.quota.userSeries, selectedAccountId]);
  const quotaUserLabels = analysis?.quota.buckets || [];
  const quotaUserTokenSeries = useMemo(() => userSeries(filteredUserSeries, "tokens", quotaUserLabels), [filteredUserSeries, quotaUserLabels]);
  const quotaUserCostSeries = useMemo(() => userSeries(filteredUserSeries, userCostBasis, quotaUserLabels), [filteredUserSeries, userCostBasis, quotaUserLabels]);
  const quotaRange = analysis?.range || serializeRange(props.query.preset || defaultPresetForTab("quota"), props.data.timezone);
  return <>
    <section className="card quota-analysis-toolbar" aria-label="额度分析筛选"><div className="card-body card-body-horizontal"><DateRangePicker range={quotaRange} timezone={props.data.timezone} onChange={(change) => props.onQueryChange({ ...props.query, ...change })} /><div className="quota-granularity"><span>粒度</span><div className="segmented-control"><button className={granularity === "hour" ? "is-active" : ""} type="button" onClick={() => setGranularity("hour")}>小时</button><button className={granularity === "day" ? "is-active" : ""} type="button" onClick={() => setGranularity("day")}>每天</button></div></div></div></section>
    {error ? <div className="status-message is-error">{error}</div> : null}
    {loading && !analysis ? <LoadingSection /> : null}
    <>
      <section className="card quota-section account-list-section"><div className="card-header quota-section-heading"><h3>账号列表</h3><label className="account-window-search"><Search size={15} aria-hidden="true" /><input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="搜索账号" /></label></div><div className="card-body account-list-body"><AccountWindowCardList accounts={accounts} visibleAccounts={visibleAccounts} selectedAccountId={selectedAccountId} onSelect={setSelectedAccountId} /><AccountWindow account={selectedAccount} accounts={accounts} /></div></section>
      <section className="card quota-section account-analysis-section"><div className="card-header quota-section-heading"><h3>模型用量</h3><div className="quota-section-actions"><ChartTypeToggle value={accountChartType} onChange={setAccountChartType} /></div></div><div className="card-body"><div className="account-window-detail"><AccountUsageChart series={analysis?.quota.series || []} buckets={analysis?.quota.buckets || []} accountId={selectedAccountId} chartType={accountChartType} granularity={granularity} /></div></div></section>
      <QuotaChartSection title="用户 Token 消耗" chartType={userTokenChartType} onChartTypeChange={setUserTokenChartType}><StackedChart data={quotaUserTokenSeries} labels={quotaUserLabels} chartType={userTokenChartType} granularity={granularity} valueType="tokens" /></QuotaChartSection>
      <QuotaChartSection title="用户费用消耗" chartType={userCostChartType} onChartTypeChange={setUserCostChartType} actions={<div className="segmented-control"><button className={userCostBasis === "actualCost" ? "is-active" : ""} type="button" onClick={() => setUserCostBasis("actualCost")}>实际费用</button><button className={userCostBasis === "standardCost" ? "is-active" : ""} type="button" onClick={() => setUserCostBasis("standardCost")}>原始费用</button></div>}><StackedChart data={quotaUserCostSeries} labels={quotaUserLabels} chartType={userCostChartType} granularity={granularity} valueType="cost" /></QuotaChartSection>
    </>
  </>;
}

function serializeRange(preset: string, timezone: string) {
  const range = resolveDateRange({ preset, timezone, defaultPreset: preset });
  return { ...range, start: range.start.toISOString(), end: range.end.toISOString() };
}

function QuotaChartSection(props: { title: string; chartType: ChartType; onChartTypeChange: (value: ChartType) => void; actions?: ReactNode; children: ReactNode }) { return <section className="card quota-section"><div className="card-header quota-section-heading"><h3>{props.title}</h3><div className="quota-section-actions"><ChartTypeToggle value={props.chartType} onChange={props.onChartTypeChange} />{props.actions}</div></div><div className="card-body">{props.children}</div></section>; }
function ChartTypeToggle(props: { value: ChartType; onChange: (value: ChartType) => void }) { return <div className="segmented-control" role="group" aria-label="图表类型"><button className={props.value === "stacked" ? "is-active" : ""} type="button" onClick={() => props.onChange("stacked")}>堆叠图</button><button className={props.value === "line" ? "is-active" : ""} type="button" onClick={() => props.onChange("line")}>折线图</button></div>; }
function AccountWindow(props: { account: UsageAnalysisData["quota"]["accounts"][number] | null; accounts: UsageAnalysisData["quota"]["accounts"] }) { const account = props.account; const selectedAccounts = account ? [account] : props.accounts; const totalTokens = selectedAccounts.reduce((sum, item) => sum + item.tokens, 0); const standardCost = selectedAccounts.reduce((sum, item) => sum + item.standardCost, 0); const actualCost = selectedAccounts.reduce((sum, item) => sum + item.actualCost, 0); return <div className="account-window-summary"><div><span>当前选择</span><strong>{account?.name || "全部账号"}</strong></div><div><span>本地 Token</span><strong>{formatTokenAmount(totalTokens)}</strong></div><div><span>7 天使用率</span><strong>{account ? `${formatWindowRate(account)}` : formatPercentAverage(props.accounts, "sevenDayUsedPercent")}</strong></div><div><span>窗口起点 - 下次重置</span><strong>{account ? `${formatWindowDate(account.sevenDayWindowStart)} - ${formatWindowDate(account.sevenDayResetAt)}` : "按账号分别展示"}</strong></div><div><span>账号成本</span><strong>{formatAnalysisCost(standardCost)}</strong></div><div><span>实际扣费</span><strong>{formatAnalysisCost(actualCost)}</strong></div><div><span>数据更新时间</span><strong>{account ? formatWindowDate(account.usageUpdatedAt) : "按账号分别更新"}</strong></div></div>; }
function averagePercent(accounts: UsageAnalysisData["quota"]["accounts"], key: "fiveHourUsedPercent" | "sevenDayUsedPercent"): number { const values = accounts.map((account) => account[key]).filter((value): value is number => value !== null); return values.length ? Math.min(100, Math.max(0, values.reduce((sum, value) => sum + value, 0) / values.length)) : 0; }
function formatPercentAverage(accounts: UsageAnalysisData["quota"]["accounts"], key: "fiveHourUsedPercent" | "sevenDayUsedPercent"): string { const values = accounts.map((account) => account[key]).filter((value): value is number => value !== null); return values.length ? `${averagePercent(accounts, key).toFixed(0)}%` : "暂无数据"; }
function formatWindowRate(account: UsageAnalysisData["quota"]["accounts"][number]): string { return account.sevenDayUsedPercent === null ? "暂无数据" : `7d ${account.sevenDayUsedPercent.toFixed(0)}%`; }
function formatWindowDate(value: string | null): string { return value ? formatDateTime(value, "Asia/Shanghai") : "暂无数据"; }
function userLabels(rows: UsageAnalysisData["quota"]["userSeries"]): string[] { return [...new Set(rows.map((row) => row.bucket))]; }
function userSeries(rows: UsageAnalysisData["quota"]["userSeries"], metric: "tokens" | "actualCost" | "standardCost" = "tokens", labels = userLabels(rows)) { const totals = new Map<string, number>(); rows.forEach((row) => totals.set(row.label, (totals.get(row.label) || 0) + row[metric])); const topUsers = [...totals.entries()].sort((left, right) => right[1] - left[1]).slice(0, 15).map(([name]) => name); const grouped = new Map<string, Map<string, number>>(); rows.forEach((row) => { const name = topUsers.includes(row.label) ? row.label : "其他"; const buckets = grouped.get(name) || new Map<string, number>(); buckets.set(row.bucket, (buckets.get(row.bucket) || 0) + row[metric]); grouped.set(name, buckets); }); return [...grouped].map(([name, values]) => ({ name, values: labels.map((bucket) => values.get(bucket) || 0) })).sort((left, right) => { if (left.name === "其他") return 1; if (right.name === "其他") return -1; return right.values.reduce((sum, value) => sum + value, 0) - left.values.reduce((sum, value) => sum + value, 0); }); }
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
 function StackedChart(props: { data: Array<{ name: string; values: number[] }>; labels?: string[]; tooltipDetails?: Record<string, Record<string, Record<string, number>>>; chartType: ChartType; granularity: "hour" | "day"; valueType: "tokens" | "cost" }) { const ref = useRef<HTMLDivElement>(null); useEffect(() => { if (!ref.current) return; const chart = echarts.init(ref.current); const chartLayout = () => { const width = ref.current?.clientWidth || 0; const rows = estimateLegendRows(props.data.map((item) => item.name), width); const legendHeight = 16 + rows * 18; return { legendHeight, gridTop: legendHeight + 34 }; }; const layout = chartLayout(); chart.setOption({ tooltip: { trigger: "axis", formatter: (params: Array<{ axisValue: string; seriesName: string; value: number; marker: string }>) => { const bucket = params[0]?.axisValue || ""; const details = props.tooltipDetails?.[bucket]; const lines = params.map((item) => { const types = details?.[item.seriesName]; const breakdown = types ? Object.entries(types).map(([type, tokens]) => `${type} ${formatTokenAmount(tokens)}`).join(" / ") : ""; return `${item.marker}${item.seriesName}: ${formatChartValue(Number(item.value), props.valueType)}${breakdown ? `<br/><span style=\"padding-left:14px\">${breakdown}</span>` : ""}`; }); return `<strong>${bucket}</strong><br/>${lines.join("<br/>")}`; } }, legend: { type: "plain", orient: "horizontal", top: 4, left: 4, right: 4, height: layout.legendHeight, itemGap: 8, textStyle: { color: "#60716f", fontSize: 10 } }, grid: { top: layout.gridTop, right: 20, bottom: 28, left: 58 }, xAxis: { type: "category", data: props.labels || (props.granularity === "day" ? ["最近 7 天"] : ["当前小时"]) }, yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatChartValue(value, props.valueType) } }, series: props.data.map((item, index) => ({ name: item.name, type: "line", ...(props.chartType === "stacked" ? { stack: "total", areaStyle: { opacity: 0.7 } } : {}), smooth: 0.18, symbol: "none", lineStyle: { width: 1 }, itemStyle: { color: ["#2563eb", "#8b5cf6", "#059669", "#d97706", "#e11d48", "#64748b"][index % 6] }, emphasis: { focus: "series", blurScope: "coordinateSystem", lineStyle: { width: 2, opacity: 1 }, itemStyle: { opacity: 1 }, areaStyle: { opacity: 0.85 } }, blur: { lineStyle: { opacity: 0.18 }, itemStyle: { opacity: 0.18 }, areaStyle: { opacity: 0.12 } }, data: item.values })) }); const resize = () => { const nextLayout = chartLayout(); chart.setOption({ legend: { height: nextLayout.legendHeight }, grid: { top: nextLayout.gridTop } }); chart.resize(); }; window.addEventListener("resize", resize); return () => { window.removeEventListener("resize", resize); chart.dispose(); }; }, [props.data, props.granularity, props.valueType, props.labels, props.tooltipDetails, props.chartType]); return <div ref={ref} className="quota-chart" aria-label="额度分析图表" />; }

function estimateLegendRows(names: string[], width: number): number { const availableWidth = Math.max(1, width - 8); let rows = 1; let rowWidth = 0; names.forEach((name) => { const itemWidth = 14 + 8 + estimateTextWidth(name) + 8; if (rowWidth > 0 && rowWidth + itemWidth > availableWidth) { rows += 1; rowWidth = itemWidth; } else { rowWidth += itemWidth; } }); return rows; }
function estimateTextWidth(value: string): number { return Array.from(value).reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 10 : 5.5), 0); }

function formatChartValue(value: number, valueType: "tokens" | "cost"): string { return valueType === "cost" ? formatAnalysisCost(value) : formatTokenAmount(value); }
