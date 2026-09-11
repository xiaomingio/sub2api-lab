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
import { buildQuotaTrend } from "./quota-trend.js";

const accountColors = ["#2563eb", "#059669", "#d97706", "#e11d48", "#7c3aed", "#64748b"];

function accountColor(index: number): string {
  return accountColors[index] || `hsl(${(index * 137.508) % 360}, 65%, 45%)`;
}

export function QuotaTrendTab(props: { data: DashboardData; query: UsageQuery; onQueryChange: (query: UsageQuery) => void; analysisCache: Map<string, UsageAnalysisData> }) {
  const query = props.query;
  const [snapshots, setSnapshots] = useState<QuotaSnapshot[]>([]);
  const [accountAnalysis, setAccountAnalysis] = useState<UsageAnalysisData | null>(() => props.analysisCache.get(JSON.stringify([query, "hour"])) || null);
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
    const requestKey = JSON.stringify([query, "hour"]);
    const cachedAnalysis = props.analysisCache.get(requestKey);
    setAccountAnalysisError("");
    if (cachedAnalysis) {
      setAccountAnalysis(cachedAnalysis);
      setAccountAnalysisLoading(false);
      return;
    }
    let active = true;
    setAccountAnalysisLoading(true);
    void fetchUsageAnalysis({ ...query, recordUserIds: [], recordAccountIds: [], recordInboundEndpoints: [], recordGroupIds: [], recordBillingTypes: [] }, "hour", false)
      .then((result) => {
        props.analysisCache.set(requestKey, result);
        if (active) setAccountAnalysis(result);
      })
      .catch((reason: unknown) => {
        if (active) setAccountAnalysisError(reason instanceof Error ? reason.message : "加载当前账号额度失败。");
      })
      .finally(() => { if (active) setAccountAnalysisLoading(false); });
    return () => { active = false; };
  }, [props.analysisCache, query]);

  const range = useMemo(() => {
    if (query.startDate && query.endDate) {
      return resolveDateRange({ startDate: query.startDate, endDate: query.endDate, timezone: props.data.timezone, defaultPreset: defaultPresetForTab("quotaTrend"), now: new Date(props.data.currentTime) });
    }
    return resolveDateRange({ preset: query.preset || defaultPresetForTab("quotaTrend"), timezone: props.data.timezone, defaultPreset: defaultPresetForTab("quotaTrend"), now: new Date(props.data.currentTime) });
  }, [props.data.currentTime, props.data.timezone, query]);

  return <>
    <section className="card quota-analysis-toolbar" aria-label="额度趋势筛选"><div className="card-body"><DateRangePicker range={{ ...range, start: range.start.toISOString(), end: range.end.toISOString() }} timezone={props.data.timezone} onChange={(change) => props.onQueryChange({ ...query, ...change })} /></div></section>
    {error ? <div className="status-message is-error">{error}</div> : null}
    {accountAnalysisError ? <div className="status-message is-error">{accountAnalysisError}</div> : null}
    <section className="card quota-section account-list-section"><div className="card-header quota-section-heading"><h2>当前账号额度</h2><span className="section-caption">读取 Sub2API 当前账号快照</span></div><div className="card-body account-list-body">{accountAnalysis ? <AccountWindowCardList accounts={accountAnalysis.quota.accounts} /> : accountAnalysisLoading ? <LoadingSection /> : <div className="empty-state">当前没有可用的账号额度</div>}</div></section>
    {loading && snapshots.length === 0 ? <LoadingSection /> : <section className="card quota-section"><div className="card-header quota-section-heading"><h2>{range.label}使用率趋势</h2><span className="section-caption">实线：实际用量 · 虚线：预测用量 · 点线：预期用量 · 同色竖线：下次重置</span></div><div className="card-body"><QuotaTrendChart snapshots={snapshots} timezone={props.data.timezone} /></div></section>}
  </>;
}

function QuotaTrendChart(props: { snapshots: QuotaSnapshot[]; timezone: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const trends = useMemo(() => buildQuotaTrend(props.snapshots), [props.snapshots]);
  const hasPoints = trends.some((account) => account.points.length > 0);
  useEffect(() => {
    if (!ref.current || !hasPoints) return;
    const chart = echarts.init(ref.current);
    const date = (value: number) => formatDateTime(new Date(value), props.timezone);
    const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
    const timestamps = trends.flatMap((account) => [...account.points.map(([at]) => at), ...account.resetPrediction.map(([at]) => at), ...(account.resetAt === null ? [] : [account.resetAt]), ...(account.exhaustedAt === null ? [] : [account.exhaustedAt])]);
    chart.setOption({
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line" },
        formatter: (rawParams: unknown) => {
          type AxisTooltipParam = { axisValue?: number | string; seriesName?: string; value?: number | [number, number | null] };
          const params = (Array.isArray(rawParams) ? rawParams : [rawParams]) as AxisTooltipParam[];
          const firstValueParam = params.find((param): param is AxisTooltipParam & { value: [number, number | null] } => Array.isArray(param.value));
          const firstValue = firstValueParam?.value[0];
          const rawAt = params[0]?.axisValue ?? firstValue;
          const hoverAt = typeof rawAt === "number" ? rawAt : Date.parse(String(rawAt));
          if (!Number.isFinite(hoverAt)) return "";
          const valueAt = (points: Array<[number, number | null]>): number | null => {
            const validPoints = points.filter((point) => point[1] !== null) as Array<[number, number]>;
            if (validPoints.length === 0 || hoverAt < validPoints[0][0] || hoverAt > validPoints.at(-1)![0]) return null;
            for (const [at, value] of validPoints) if (at === hoverAt) return value;
            const nextIndex = validPoints.findIndex(([at]) => at > hoverAt);
            if (nextIndex <= 0) return validPoints[0][1];
            const [previousAt, previousValue] = validPoints[nextIndex - 1];
            const [nextAt, nextValue] = validPoints[nextIndex];
            return previousValue + (nextValue - previousValue) * ((hoverAt - previousAt) / (nextAt - previousAt));
          };
          const lines = [`<strong>${date(hoverAt)}</strong>`];
          for (const [index, account] of trends.entries()) {
            const color = accountColor(index);
            const valueFor = (seriesName: string, points: Array<[number, number | null]>): number | null => {
              const value = params.find((param) => param.seriesName === seriesName)?.value;
              const numericValue = Array.isArray(value) ? value[1] : value;
              return typeof numericValue === "number" && Number.isFinite(numericValue) ? numericValue : valueAt(points);
            };
            const actual = valueFor(account.name, account.points);
            const expected = valueFor(`${account.name} · 预期`, account.resetPrediction);
            const prediction = valueFor(`${account.name} · 预测`, account.prediction);
            const detectedReset = account.resets.includes(hoverAt);
            const estimatedReset = account.resetAt === hoverAt;
            const details = [
              actual === null ? "" : `实际 ${actual.toFixed(2)}%`,
              prediction === null ? "" : `预测 ${prediction.toFixed(2)}%`,
              expected === null ? "" : `预期 ${expected.toFixed(2)}%`,
              detectedReset ? "检测到重置" : "",
              estimatedReset ? `下次重置：${date(account.resetAt!)}` : ""
            ].filter(Boolean);
            if (details.length > 0) {
              const swatch = `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px;"></span>`;
              lines.push(`${swatch}${escape(account.name)}：${details.join(" · ")}`);
            }
          }
          return lines.length > 1 ? lines.join("<br/>") : "";
        }
      },
      legend: { data: trends.map((account) => account.name), type: "scroll", top: 4, left: 4, right: 4, textStyle: { color: "#60716f", fontSize: 10 } },
      grid: { top: 42, right: 32, bottom: 80, left: 52 },
      dataZoom: [{ type: "slider", bottom: 8, height: 22 }, { type: "inside" }],
      xAxis: { type: "time", min: Math.min(...timestamps), max: Math.max(...timestamps), axisLabel: { hideOverlap: true, formatter: (value: number) => date(value) } },
      yAxis: { type: "value", min: 0, max: 100, axisLabel: { formatter: (value: number) => `${value}%` } },
      series: trends.flatMap((account, index) => {
        const color = accountColor(index);
        return [{
          name: account.name, type: "line", smooth: false, connectNulls: false,
          symbol: "circle", symbolSize: 5, itemStyle: { color }, lineStyle: { color, type: "solid" }, data: account.points,
          markLine: {
            symbol: ["none", "none"],
            data: [
              ...account.resets.map((at) => ({ xAxis: at, lineStyle: { color, type: "dotted", opacity: 0.45 }, label: { show: false } })),
              ...(account.resetAt === null ? [] : [{ xAxis: account.resetAt, lineStyle: { color, type: "solid", width: 2 }, label: { show: false }, tooltip: { formatter: () => `${escape(account.name)}<br/>下次重置：${date(account.resetAt!)}` } }])
            ]
          }
        }, {
          name: `${account.name} · 预测`, type: "line", data: account.prediction.map((point, pointIndex) => pointIndex === 0 ? { value: point, symbol: "emptyCircle", symbolSize: 7 } : point), smooth: false,
          symbol: "none", itemStyle: { color }, lineStyle: { color, type: "dashed", width: 2 },
          z: 3
        }, {
          name: `${account.name} · 预期`, type: "line", data: account.resetPrediction, smooth: false,
          symbol: "none", itemStyle: { color }, lineStyle: { color, type: [2, 10], width: 2, opacity: 0.8 },
          z: 2
        }];
      })
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.dispose(); };
  }, [props.timezone, trends, hasPoints]);
  return hasPoints ? <div ref={ref} className="quota-chart" aria-label="7 天账号使用率、下次重置与预测趋势图" /> : <div className="empty-state">当前范围暂无整点快照</div>;
}
