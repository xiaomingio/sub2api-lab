/*
 * 文件说明: 独立额度趋势 Tab，读取独立统计库中的整点快照并展示账号使用率折线。
 * 说明: 重置由使用率下降判定，并在对应账号的折线上绘制竖向标记线。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import echarts from "../components/charts.js";
import { fetchQuotaSnapshots } from "../api.js";
import { DateRangePicker } from "../components/DateRangePicker.js";
import { LoadingSection } from "../components/LoadingSection.js";
import { formatDateTime } from "../format.js";
import { resolveDateRange } from "../../shared/ranges.js";
import type { DashboardData, QuotaSnapshot, UsageQuery } from "../types.js";
import { defaultPresetForTab } from "./shared.js";

export function QuotaTrendTab(props: { data: DashboardData; query: UsageQuery; onQueryChange: (query: UsageQuery) => void }) {
  const query = props.query;
  const [snapshots, setSnapshots] = useState<QuotaSnapshot[]>([]);
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

  const range = useMemo(() => {
    if (query.startDate && query.endDate) {
      return resolveDateRange({ startDate: query.startDate, endDate: query.endDate, timezone: props.data.timezone, defaultPreset: defaultPresetForTab("quotaTrend") });
    }
    return resolveDateRange({ preset: query.preset || defaultPresetForTab("quotaTrend"), timezone: props.data.timezone, defaultPreset: defaultPresetForTab("quotaTrend") });
  }, [props.data.timezone, query]);

  return <>
    <section className="card quota-analysis-toolbar" aria-label="额度趋势筛选"><div className="card-body"><DateRangePicker range={{ ...range, start: range.start.toISOString(), end: range.end.toISOString() }} timezone={props.data.timezone} onChange={(change) => props.onQueryChange({ ...query, ...change })} /></div></section>
    {error ? <div className="status-message is-error">{error}</div> : null}
    {loading && snapshots.length === 0 ? <LoadingSection /> : <section className="card quota-section"><div className="card-header quota-section-heading"><h2>{range.label}使用率趋势</h2><span className="section-caption">每个配置时区的整点快照；竖线表示检测到使用率下降</span></div><div className="card-body"><QuotaTrendChart snapshots={snapshots} timezone={props.data.timezone} /></div></section>}
  </>;
}

function QuotaTrendChart(props: { snapshots: QuotaSnapshot[]; timezone: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => [...props.snapshots].sort((left, right) => left.sampledAt.localeCompare(right.sampledAt)), [props.snapshots]);
  useEffect(() => {
    if (!ref.current || rows.length === 0) return;
    const chart = echarts.init(ref.current);
    const labels = [...new Set(rows.map((row) => formatDateTime(row.sampledAt, props.timezone)))];
    const rowsByAccount = new Map<number, QuotaSnapshot[]>();
    rows.forEach((row) => rowsByAccount.set(row.accountId, [...(rowsByAccount.get(row.accountId) || []), row]));
    const colors = ["#2563eb", "#059669", "#d97706", "#e11d48", "#7c3aed", "#64748b"];
    chart.setOption({
      tooltip: { trigger: "axis", valueFormatter: (value: number | null) => value === null ? "暂无数据" : `${value.toFixed(2)}%` },
      legend: { type: "scroll", top: 4, left: 4, right: 4, textStyle: { color: "#60716f", fontSize: 10 } },
      grid: { top: 42, right: 24, bottom: 54, left: 52 },
      xAxis: { type: "category", data: labels, axisLabel: { hideOverlap: true } },
      yAxis: { type: "value", min: 0, max: 100, axisLabel: { formatter: (value: number) => `${value}%` } },
      series: [...rowsByAccount.entries()].map(([accountId, accountRows], index) => {
        const color = colors[index % colors.length];
        const resetLines = accountRows.filter((row) => row.isReset).map((row) => ({
          xAxis: formatDateTime(row.sampledAt, props.timezone),
          name: "重置",
          label: { formatter: `重置 ${row.sevenDayUsedPercent === null ? "" : `${row.sevenDayUsedPercent.toFixed(1)}%`}`, color, position: "insideEndTop" }
        }));
        return {
          name: accountRows[0]?.accountName || `账号 #${accountId}`,
          type: "line",
          smooth: 0.15,
          connectNulls: false,
          symbol: "circle",
          symbolSize: 5,
          itemStyle: { color },
          lineStyle: { color },
          data: labels.map((label) => {
            const row = accountRows.find((item) => formatDateTime(item.sampledAt, props.timezone) === label);
            return row?.sevenDayUsedPercent ?? null;
          }),
          markLine: resetLines.length ? { silent: true, symbol: ["none", "none"], lineStyle: { color, type: "dashed", width: 1.5 }, data: resetLines } : undefined
        };
      })
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.dispose(); };
  }, [props.timezone, rows]);
  return rows.length ? <div ref={ref} className="quota-chart" aria-label="7 天账号使用率趋势图" /> : <div className="empty-state">当前范围暂无整点快照</div>;
}
