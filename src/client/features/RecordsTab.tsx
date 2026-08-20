/*
 * 文件说明: 使用记录工作区，负责原始调用记录的筛选和表格展示。
 * 参考资料: Sub2API frontend/src/views/admin/UsageView.vue 与 components/admin/usage/UsageTable.vue。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Search } from "lucide-react";
import { DataTable } from "../components/DataTable.js";
import { DateRangePicker } from "../components/DateRangePicker.js";
import { formatDateTime, formatInteger } from "../format.js";
import { requestTypeLabel } from "../../shared/request-type.js";
import { billingTypeLabel } from "../../shared/billing-type.js";
import { recordLabels } from "./shared.js";
import type { DashboardData, UsageQuery, UsageRecordsData, UsageRecordFilterOption, UsageRecordFilterOptions } from "../types.js";

const emptyRecordFilterOptions: UsageRecordFilterOptions = {
  users: [],
  accounts: [],
  inboundEndpoints: [],
  groups: [],
  billingTypes: []
};

export function RecordsTab(props: {
  data: DashboardData;
  usageQuery: UsageQuery;
  records: UsageRecordsData | null;
  filterOptions: UsageRecordFilterOptions | null;
  limit: number;
  page: number;
  onPageChange: (page: number) => void;
  loading: boolean;
  onLimitChange: (limit: number) => void;
  onUsageQueryChange: (query: UsageQuery) => void;
}) {
  const range = props.records?.range || props.data.usage.range;
  const filterOptions = props.filterOptions || emptyRecordFilterOptions;

  function updateFilter(key: keyof UsageQuery, values: string[] | number[]) {
    props.onUsageQueryChange({ ...props.usageQuery, [key]: values });
  }

  return (
    <section className="tab-panel is-active records-panel" aria-label="使用记录">
      <div className="records-filter-workspace">
        <button className="records-reset-button" type="button" title="重置全部筛选" aria-label="重置全部筛选" onClick={() => props.onUsageQueryChange({ ...props.usageQuery, preset: undefined, startDate: undefined, endDate: undefined, recordUserIds: [], recordAccountIds: [], recordInboundEndpoints: [], recordGroupIds: [], recordBillingTypes: [] })}><RotateCcw size={15} aria-hidden="true" /></button>
        <div className="records-filter-row">
          <DateRangePicker
            range={range}
            timezone={props.data.timezone}
            onChange={(change) => props.onUsageQueryChange({ ...props.usageQuery, ...change })}
          />

          <div className="records-prefilters" aria-label="使用记录预筛选">
            <RecordFilterCard label="用户" options={filterOptions.users} selected={props.usageQuery.recordUserIds?.map(String) || []} onChange={(values) => updateFilter("recordUserIds", values.map(Number))} searchable searchPlaceholder="搜索用户或用户 ID" />
            <RecordFilterCard label="上游账号" options={filterOptions.accounts} selected={props.usageQuery.recordAccountIds?.map(String) || []} onChange={(values) => updateFilter("recordAccountIds", values.map(Number))} searchable searchPlaceholder="搜索上游账号" />
            <RecordFilterCard label="入站接口" options={filterOptions.inboundEndpoints} selected={props.usageQuery.recordInboundEndpoints || []} onChange={(values) => updateFilter("recordInboundEndpoints", values)} />
            <RecordFilterCard label="分组" options={filterOptions.groups} selected={props.usageQuery.recordGroupIds || []} onChange={(values) => updateFilter("recordGroupIds", values)} />
            <RecordFilterCard label="计费类型" options={filterOptions.billingTypes} selected={props.usageQuery.recordBillingTypes || []} onChange={(values) => updateFilter("recordBillingTypes", values)} />
          </div>
        </div>
      </div>

      <div className="records-toolbar">
        <label className="records-limit-field">
          <span>每页记录数</span>
          <input type="number" min="1" max="10000" step="1" value={props.limit} onChange={(event) => props.onLimitChange(Math.min(10000, Math.max(1, Number(event.target.value) || 1)))} />
        </label>
        <span className="records-meta">共 {formatInteger(props.records?.total || 0)} 条，当前显示 {formatInteger(props.records?.rows.length || 0)} 条</span>
        {props.loading ? <span className="records-meta" role="status">正在更新记录...</span> : null}
        <div className="records-pagination" aria-label="记录分页">
          <button type="button" title="上一页" aria-label="上一页" disabled={props.page <= 1 || props.loading} onClick={() => props.onPageChange(props.page - 1)}><ChevronLeft size={15} aria-hidden="true" /></button>
          <span>第</span><input aria-label="跳转页码" type="number" min="1" max={props.records?.pageCount || 1} value={props.page} onChange={(event) => props.onPageChange(Math.min(props.records?.pageCount || 1, Math.max(1, Number(event.target.value) || 1)))} /><span>/ {props.records?.pageCount || 1} 页</span>
          <button type="button" title="下一页" aria-label="下一页" disabled={props.page >= (props.records?.pageCount || 1) || props.loading} onClick={() => props.onPageChange(props.page + 1)}><ChevronRight size={15} aria-hidden="true" /></button>
        </div>
      </div>

      <div className="table-section records-table-section">
        <DataTable
          rows={props.records?.rows || []}
          columns={props.records?.columns}
          labels={recordLabels}
          defaultSort="created_at"
          emptyText={props.loading ? "正在加载使用记录" : "当前时间范围内没有使用记录"}
          renderCell={(value, key) => <span title={displayRecordValue(value)}>{formatRecordValue(value, key, props.data.timezone)}</span>}
        />
      </div>
    </section>
  );
}

function RecordFilterCard(props: { label: string; options: UsageRecordFilterOption[]; selected: string[]; onChange: (values: string[]) => void; searchable?: boolean; searchPlaceholder?: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const selected = new Set(props.selected);
  const visibleOptions = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return props.options.filter((option) => !keyword || `${option.label} ${option.hint || ""}`.toLowerCase().includes(keyword));
  }, [props.options, search]);
  const summary = selected.size === 0 ? "未筛选" : `已选 ${selected.size} 项`;
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (event.target instanceof Node && !cardRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const toggle = (value: string, checked: boolean) => {
    const next = new Set(selected);
    checked ? next.add(value) : next.delete(value);
    props.onChange([...next]);
  };
  return <div ref={cardRef} className={`record-filter-card${open ? " is-open" : ""}`}>
    <button className="record-filter-summary" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="field-kicker">{props.label}</span><strong>{summary}</strong><ChevronDown className="record-filter-chevron" size={17} aria-hidden="true" />
    </button>
    {open ? <div className="record-filter-popover">
      <div className="record-filter-head"><strong>{props.label}</strong><button type="button" onClick={() => setOpen(false)}>完成</button></div>
      {props.searchable ? <label className="record-filter-search"><Search size={15} aria-hidden="true" /><input autoFocus type="search" value={search} placeholder={props.searchPlaceholder} onChange={(event) => setSearch(event.target.value)} /></label> : null}
      <div className="record-filter-actions"><span>全部 {props.options.length} 项</span><button type="button" onClick={() => props.onChange(props.options.map((option) => option.value))}>全选</button><button type="button" onClick={() => props.onChange([])}>清空</button></div>
      <div className="record-filter-options">{visibleOptions.length ? visibleOptions.map((option) => <label key={option.value}><input type="checkbox" checked={selected.has(option.value)} onChange={(event) => toggle(option.value, event.target.checked)} /><span><strong>{option.label}</strong>{option.hint ? <small>{option.hint}</small> : null}</span></label>) : <span className="record-filter-empty">没有匹配选项</span>}</div>
      <div className="record-filter-foot"><span>空选项表示不筛选</span><button type="button" onClick={() => setOpen(false)}>应用筛选</button></div>
    </div> : null}
  </div>;
}

function displayRecordValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function formatRecordValue(value: unknown, key: string, timezone: string): string {
  if (value === null || value === undefined || value === "") return "-";
  if (key === "request_type" || key === "stream" || key === "is_stream") {
    const label = requestTypeLabel(value);
    if (label) return label;
    if (typeof value === "boolean") return value ? "是" : "否";
  }
  if (key === "billing_type") return billingTypeLabel(value);
  if (isRecordDateKey(key)) {
    const parsed = new Date(String(value));
    if (!Number.isNaN(parsed.getTime())) return formatDateTime(parsed, timezone);
  }
  return displayRecordValue(value);
}

function isRecordDateKey(key: string): boolean {
  return /(^|_)(at|time|date)$|created|updated/i.test(key);
}
