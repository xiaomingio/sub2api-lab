/*
 * 文件说明: 渲染使用记录页下方的模型、分组、端点和计费类型占比环形图。
 */

import { useEffect, useRef } from "react";
import echarts from "./charts.js";
import type { DistributionItem } from "../types.js";

const colors = ["#2563eb", "#8b5cf6", "#059669", "#d97706", "#94a3b8", "#e11d48"];

export function UsageDistributionCharts(props: { data: { model: DistributionItem[]; group: DistributionItem[]; endpoint: DistributionItem[]; billing: DistributionItem[] } }) {
  return <section className="records-distribution-section" aria-label="使用记录分布分析">
    <div className="records-distribution-header"><div><p className="section-eyebrow">RECORD ANALYSIS</p><h2>使用分布</h2><p>基于当前使用记录筛选条件统计各维度占比。</p></div></div>
    <div className="records-distribution-grid">
      <DistributionChart title="模型" data={props.data.model} />
      <DistributionChart title="分组" data={props.data.group} />
      <DistributionChart title="端点" data={props.data.endpoint} />
      <DistributionChart title="计费类型" data={props.data.billing} />
    </div>
  </section>;
}

function DistributionChart(props: { title: string; data: DistributionItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      tooltip: { trigger: "item", formatter: "{b}<br/>{c} 条记录 ({d}%)" },
      legend: { type: "scroll", bottom: 0, left: 0, right: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: "#60716f", fontSize: 10 } },
      series: [{ type: "pie", radius: ["42%", "70%"], center: ["50%", "42%"], itemStyle: { borderColor: "#fff", borderWidth: 2 }, label: { show: true, position: "outside", formatter: (params: { name?: string; percent?: number }) => `${params.name || "未标记"}\n${Math.round(params.percent || 0)}%`, color: "#172a2a", fontSize: 10, lineHeight: 15, fontWeight: 800 }, labelLine: { show: true, length: 10, length2: 8, lineStyle: { color: "#9aa9a5" } }, labelLayout: { hideOverlap: true }, data: props.data.length ? props.data.map((item, index) => ({ name: item.label, value: item.value, itemStyle: { color: colors[index % colors.length] } })) : [{ name: "等待数据", value: 1, itemStyle: { color: "#e7efed" }, label: { show: false }, labelLine: { show: false } }] }]
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.dispose(); };
  }, [props.data]);
  return <article className="records-distribution-card"><h3>{props.title}</h3><div ref={ref} className="records-distribution-chart" aria-label={`${props.title}占比图`} /></article>;
}
