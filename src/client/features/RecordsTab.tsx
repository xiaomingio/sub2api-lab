/*
 * 文件说明: 使用记录工作区，负责原始调用记录的筛选和表格展示。
 */

import { DataTable } from "../components/DataTable.js";
import { DateRangePicker } from "../components/DateRangePicker.js";
import { formatDateTime, formatInteger } from "../format.js";
import { recordLabels } from "./shared.js";
import type { DashboardData, UsageQuery, UsageRecordsData } from "../types.js";

export function RecordsTab(props: {
  data: DashboardData;
  usageQuery: UsageQuery;
  records: UsageRecordsData | null;
  limit: number;
  loading: boolean;
  onLimitChange: (limit: number) => void;
  onUsageQueryChange: (query: UsageQuery) => void;
}) {
  const range = props.records?.range || props.data.usage.range;

  return (
    <section className="tab-panel is-active records-panel" aria-label="使用记录">
      <DateRangePicker
        range={range}
        timezone={props.data.timezone}
        onChange={(change) => props.onUsageQueryChange({ ...props.usageQuery, ...change })}
      />

      <section className="records-toolbar" aria-label="记录加载设置">
        <label className="records-limit-field">
          <span>每页记录数</span>
          <input type="number" min="1" max="10000" step="1" value={props.limit} onChange={(event) => props.onLimitChange(Math.min(10000, Math.max(1, Number(event.target.value) || 1)))} />
        </label>
        <span className="records-meta">共 {formatInteger(props.records?.total || 0)} 条，当前显示 {formatInteger(props.records?.rows.length || 0)} 条</span>
        {props.loading ? <span className="records-meta" role="status">正在更新记录...</span> : null}
      </section>

      <section className="table-section records-table-section">
        <DataTable
          rows={props.records?.rows || []}
          columns={props.records?.columns}
          labels={recordLabels}
          defaultSort="created_at"
          emptyText={props.loading ? "正在加载使用记录" : "当前时间范围内没有使用记录"}
          renderCell={(value, key) => <span title={displayRecordValue(value)}>{formatRecordValue(value, key, props.data.timezone)}</span>}
        />
      </section>
    </section>
  );
}

function displayRecordValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function formatRecordValue(value: unknown, key: string, timezone: string): string {
  if (value === null || value === undefined || value === "") return "-";
  if (isRecordDateKey(key)) {
    const parsed = new Date(String(value));
    if (!Number.isNaN(parsed.getTime())) return formatDateTime(parsed, timezone);
  }
  return displayRecordValue(value);
}

function isRecordDateKey(key: string): boolean {
  return /(^|_)(at|time|date)$|created|updated/i.test(key);
}
