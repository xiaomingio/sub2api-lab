/*
 * 文件说明: 渲染使用记录页下方的模型、分组、端点和用户占比饼图。
 */

import { useEffect, useRef } from "react";
import echarts from "./charts.js";
import type { DistributionItem } from "../types.js";

const colors = ["#2563eb", "#8b5cf6", "#059669", "#d97706", "#94a3b8", "#e11d48"];

type PieLabelParams = { name?: string; percent?: number };

function canFitInsideLabel(item: DistributionItem, total: number) {
  const labelUnits = Array.from(item.label).reduce((units, character) => units + (character.charCodeAt(0) > 127 ? 1 : 0.56), 0);
  const minimumPercent = (labelUnits * 6 + 18) / 300;
  return total > 0 && item.value / total >= Math.max(0.1, minimumPercent);
}

export function UsageDistributionCharts(props: { data: { model: DistributionItem[]; group: DistributionItem[]; endpoint: DistributionItem[]; user: DistributionItem[] } }) {
  return <section className="card records-distribution-section" aria-label="使用记录分布分析">
    <div className="card-header"><h2>使用分布</h2></div>
    <div className="card-body records-distribution-body">
      <div className="records-distribution-grid">
        <DistributionChart title="模型" data={props.data.model} />
        <DistributionChart title="分组" data={props.data.group} />
        <DistributionChart title="端点" data={props.data.endpoint} />
        <DistributionChart title="用户" data={props.data.user} />
      </div>
    </div>
  </section>;
}

function DistributionChart(props: { title: string; data: DistributionItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const total = props.data.reduce((sum, item) => sum + item.value, 0);
    chart.setOption({
      animation: props.data.length > 0,
      tooltip: { trigger: "item", formatter: "{b}<br/>{c} 条记录 ({d}%)" },
      legend: { type: "scroll", bottom: 0, left: 0, right: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: "#60716f", fontSize: 10 } },
      series: [{ type: "pie", radius: "70%", center: ["50%", "42%"], avoidLabelOverlap: true, itemStyle: { borderColor: "#fff", borderWidth: 2 }, label: { show: true, formatter: (params: PieLabelParams) => `${params.name || "未标记"}\n${Math.round(params.percent || 0)}%`, fontSize: 10, lineHeight: 15, fontWeight: 800 }, labelLine: { show: true, length: 10, length2: 8, lineStyle: { color: "#9aa9a5" } }, labelLayout: { hideOverlap: true }, data: props.data.length ? props.data.map((item, index) => {
        const inside = canFitInsideLabel(item, total);
        return { name: item.label, value: item.value, itemStyle: { color: colors[index % colors.length] }, label: { position: inside ? "inside" : "outside", color: inside ? "#fff" : "#172a2a", textBorderColor: inside ? "rgba(0, 0, 0, 0.18)" : "transparent", textBorderWidth: inside ? 2 : 0 }, labelLine: { show: !inside } };
      }) : [{ name: "等待数据", value: 1, itemStyle: { color: "#e7efed" }, label: { show: false }, labelLine: { show: false } }] }]
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.dispose(); };
  }, [props.data]);
  return <article className="records-distribution-card"><h3>{props.title}</h3><div ref={ref} className="records-distribution-chart" aria-label={`${props.title}占比图`} /></article>;
}
