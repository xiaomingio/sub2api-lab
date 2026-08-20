/*
 * 文件说明: 用量统计工作区，负责用户级用量汇总和排序。
 */

import type { UsageSortKey } from "../../shared/usage.js";
import { DateRangePicker } from "../components/DateRangePicker.js";
import { formatInteger, formatUsageCost } from "../format.js";
import { MetricGrid, sortHeaders } from "./shared.js";
import type { DashboardData, UsageQuery } from "../types.js";

export function UsageTab(props: {
  data: DashboardData;
  usageQuery: UsageQuery;
  onUsageQueryChange: (query: UsageQuery) => void;
}) {
  const usage = props.data.usage;

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

      <DateRangePicker
        range={usage.range}
        timezone={props.data.timezone}
        onChange={(change) => props.onUsageQueryChange({ ...props.usageQuery, ...change })}
      />

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
