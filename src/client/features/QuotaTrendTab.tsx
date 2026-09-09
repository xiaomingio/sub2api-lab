/*
 * 文件说明: 独立额度趋势 Tab，读取独立统计库中的整点快照并展示账号使用率折线。
 * 说明: 重置由使用率下降判定，并在对应账号的折线上绘制竖向标记线。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import echarts from "../components/charts.js";
import { fetchQuotaSnapshots } from "../api.js";
import { DateRangePicker } from "../components/DateRangePicker.js";
import { LoadingSection } from "../components/LoadingSection.js";
import { AccountWindowCardList } from "../components/AccountWindowCards.js";
import { formatDateTime } from "../format.js";
import { resolveDateRange } from "../../shared/ranges.js";
import type { DashboardData, QuotaSnapshot, UsageAnalysisData, UsageQuery } from "../types.js";
import { fetchUsageAnalysis } from "../api.js";
import { defaultPresetForTab } from "./shared.js";
import { buildQuotaTrend, type QuotaTrendAccount } from "./quota-trend.js";

export function QuotaTrendTab(props: { data: DashboardData; query: UsageQuery; onQueryChange: (query: UsageQuery) => void }) {
  const query = props.query;
  const [snapshots, setSnapshots] = useState<QuotaSnapshot[]>([]);
  const [accountAnalysis, setAccountAnalysis] = useState<UsageAnalysisData | null>(null);
  const [accountAnalysisLoading, setAccountAnalysisLoading] = useState(true);
  const [accountAnalysisError, setAccountAnalysisError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    void fetchQuotaSnapshots(query)
      .then((result) => setSnapshots(result.snapshots))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "加载额度趋势失败。"))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    setAccountAnalysisLoading(true);
    setAccountAnalysisError("");
    void fetchUsageAnalysis({ ...query, recordUserIds: [], recordAccountIds: [], recordInboundEndpoints: [], recordGroupIds: [], recordBillingTypes: [] }, "hour", false)
      .then(setAccountAnalysis)
      .catch((reason: unknown) => setAccountAnalysisError(reason instanceof Error ? reason.message : "加载当前账号额度失败。"))
      .finally(() => setAccountAnalysisLoading(false));
  }, [query]);

  const range = useMemo(() => {
    if (query.startDate && query.endDate) {
      return resolveDateRange({ startDate: query.startDate, endDate: query.endDate, timezone: props.data.timezone, defaultPreset: defaultPresetForTab("quotaTrend") });
    }
    return resolveDateRange({ preset: query.preset || defaultPresetForTab("quotaTrend"), timezone: props.data.timezone, defaultPreset: defaultPresetForTab("quotaTrend") });
  }, [props.data.timezone, query]);

  return <>
    <section className="card quota-analysis-toolbar" aria-label="额度趋势筛选"><div className="card-body"><DateRangePicker range={{ ...range, start: range.start.toISOString(), end: range.end.toISOString() }} timezone={props.data.timezone} onChange={(change) => props.onQueryChange({ ...query, ...change })} /></div></section>
    {error ? <div className="status-message is-error">{error}</div> : null}
    {accountAnalysisError ? <div className="status-message is-error">{accountAnalysisError}</div> : null}
    <section className="card quota-section account-list-section"><div className="card-header quota-section-heading"><h2>当前账号额度</h2><span className="section-caption">读取 Sub2API 当前账号快照</span></div><div className="card-body account-list-body">{accountAnalysis ? <AccountWindowCardList accounts={accountAnalysis.quota.accounts} /> : accountAnalysisLoading ? <LoadingSection /> : <div className="empty-state">当前没有可用的账号额度</div>}</div></section>
    {loading && snapshots.length === 0 ? <LoadingSection /> : <section className="card quota-section"><div className="card-header quota-section-heading"><h2>{range.label}使用率趋势</h2><span className="section-caption">实线：实际用量 · 虚线：按本轮平均速度预测至 100% · 同色竖线：下次重置</span></div><div className="card-body"><QuotaTrendChart snapshots={snapshots} accounts={accountAnalysis?.quota.accounts || []} timezone={props.data.timezone} /></div></section>}
  </>;
}

function QuotaTrendChart(props: { snapshots: QuotaSnapshot[]; accounts: QuotaTrendAccount[]; timezone: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const trends = useMemo(() => buildQuotaTrend(props.snapshots, props.accounts), [props.snapshots, props.accounts]);
  const hasPoints = trends.some((account) => account.points.length > 0);
  useEffect(() => {
    if (!ref.current || !hasPoints) return;
    const chart = echarts.init(ref.current);
    const date = (value: number) => formatDateTime(new Date(value), props.timezone);
    const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
    const colors = ["#2563eb", "#059669", "#d97706", "#e11d48", "#7c3aed", "#64748b"];
    const timestamps = trends.flatMap((account) => [...account.points.map(([at]) => at), ...(account.resetAt === null ? [] : [account.resetAt]), ...(account.exhaustedAt === null ? [] : [account.exhaustedAt])]);
    chart.setOption({
      tooltip: { trigger: "item" },
      legend: { data: trends.map((account) => account.name), type: "scroll", top: 4, left: 4, right: 4, textStyle: { color: "#60716f", fontSize: 10 } },
      grid: { top: 42, right: 32, bottom: 80, left: 52 },
      dataZoom: [{ type: "slider", bottom: 8, height: 22 }, { type: "inside" }],
      xAxis: { type: "time", min: Math.min(...timestamps), max: Math.max(...timestamps), axisLabel: { hideOverlap: true, formatter: (value: number) => date(value) } },
      yAxis: { type: "value", min: 0, max: 100, axisLabel: { formatter: (value: number) => `${value}%` } },
      series: trends.flatMap((account, index) => {
        const color = colors[index] || `hsl(${(index * 137.508) % 360}, 65%, 45%)`;
        const summary = [escape(account.name), account.resetAt === null ? "下次重置：暂无有效时间" : `下次重置：${date(account.resetAt)}`,
          account.baseline ? `预测基点：${date(account.baseline[0])}，${account.baseline[1]!.toFixed(2)}%${account.estimatedBaseline ? "（未采到重置，使用本轮最早采样）" : "（使用率下降后的实际采样）"}` : "",
          account.exhaustedAt === null ? `预测：${account.predictionUnavailableReason}` : `预计达到 100%：${date(account.exhaustedAt)}`,
          account.exhaustedAt !== null && account.resetAt !== null ? (account.exhaustedAt >= account.resetAt ? "按当前速度可坚持到重置" : "按当前速度将在重置前耗尽") : ""].filter(Boolean).join("<br/>");
        return [{
          name: account.name, type: "line", smooth: false, connectNulls: false,
          symbol: "circle", symbolSize: 5, itemStyle: { color }, lineStyle: { color }, data: account.points,
          tooltip: { formatter: (param: { value: [number, number] }) => `${summary}<br/>${date(param.value[0])}：${param.value[1].toFixed(2)}%` },
          markLine: {
            symbol: ["none", "none"],
            data: [
              ...account.resets.map((at) => ({ xAxis: at, lineStyle: { color, type: "dotted", opacity: 0.45 }, label: { show: false }, tooltip: { formatter: `${escape(account.name)}<br/>检测到重置：${date(at)}` } })),
              ...(account.resetAt === null ? [] : [{ xAxis: account.resetAt, lineStyle: { color, type: "solid", width: 2 }, label: { formatter: `${account.name} 下次重置`, color, position: "insideEndTop" }, tooltip: { formatter: summary } }])
            ]
          }
        }, {
          name: account.name, type: "line", data: account.prediction, smooth: false,
          symbol: "emptyCircle", symbolSize: 7, itemStyle: { color }, lineStyle: { color, type: "dashed", width: 2 },
          tooltip: { formatter: summary }, z: 3
        }];
      })
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.dispose(); };
  }, [props.timezone, trends, hasPoints]);
  return hasPoints ? <div ref={ref} className="quota-chart" aria-label="7 天账号使用率、下次重置与预测趋势图" /> : <div className="empty-state">当前范围暂无整点快照</div>;
}
