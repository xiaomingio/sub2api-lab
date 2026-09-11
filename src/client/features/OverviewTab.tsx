/*
 * 文件说明: 管理台系统介绍页，说明各个 Tab 的用途并提供进入入口。
 */

import type { DashboardTab } from "../types.js";
import { tabDefinitions } from "./shared.js";

export function OverviewTab(props: { onSelectTab: (tab: DashboardTab) => void }) {
  return (
    <div className="overview-workspace">
      <section className="card overview-hero" aria-labelledby="overview-title">
        <div className="card-body">
          <p className="section-eyebrow">SUB2API LAB / ADMIN</p>
          <h1 id="overview-title">Sub2API Lab 管理台</h1>
          <p>集中查看上游账号额度、调用用量、成本分摊和系统余额，帮助你了解当前运行情况并定位异常。</p>
        </div>
      </section>

      <section className="overview-section" aria-labelledby="overview-tools-title">
        <div className="overview-section-heading">
          <div>
            <p className="section-eyebrow">功能导航</p>
            <h2 id="overview-tools-title">从这里进入对应工具</h2>
          </div>
          <span className="section-caption">每个 Tab 负责一类分析或管理任务</span>
        </div>
        <div className="overview-tab-grid">
          {tabDefinitions.filter(({ key }) => key !== "overview").map((item) => (
            <button className="overview-tab-card" type="button" key={item.key} onClick={() => props.onSelectTab(item.key)}>
              <span className="overview-tab-card-label">{item.label}</span>
              <span className="overview-tab-card-description">{item.description}</span>
              <span className="overview-tab-card-action">进入 Tab <span aria-hidden="true">→</span></span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
