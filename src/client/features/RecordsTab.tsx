/*
 * 文件说明: 使用记录工作区，负责原始调用记录的筛选和表格展示。
 * 参考资料: Sub2API frontend/src/views/admin/UsageView.vue 与 components/admin/usage/UsageTable.vue。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { DataTable } from "../components/DataTable.js";
import { DateRangePicker } from "../components/DateRangePicker.js";
import { FilterSummary } from "../components/FilterSummary.js";
import { formatDateTime, formatInteger } from "../format.js";
import { requestTypeLabel } from "../../shared/request-type.js";
import { billingTypeLabel } from "../../shared/billing-type.js";
import { billingModeLabel } from "../../shared/billing-mode.js";
import { recordLabels } from "./shared.js";
import type { DashboardData, UsageQuery, UsageRecordsData, UsageRecordFilterOption, UsageRecordFilterOptions } from "../types.js";
import { UsageDistributionCharts } from "../components/UsageDistributionCharts.js";
import { LoadingSection } from "../components/LoadingSection.js";
import type { UsageAnalysisData } from "../types.js";

const emptyRecordFilterOptions: UsageRecordFilterOptions = {
  users: [],
  accounts: [],
  models: [],
  upstreamEndpoints: [],
  billingModes: [],
  requestTypes: [],
  apiKeys: [],
  upstreamModelMismatch: [],
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
  analysis: UsageAnalysisData | null;
}) {
  const range = props.records?.range || props.data.usage.range;
  const filterOptions = props.filterOptions || emptyRecordFilterOptions;

  function updateFilter(key: keyof UsageQuery, values: string[] | number[]) {
    props.onUsageQueryChange({ ...props.usageQuery, [key]: values });
  }

  return (
    <>
      <section className="card records-filter-workspace" aria-label="使用记录筛选">
        <div className="card-body">
          <div className="records-filter-row" aria-label="使用记录预筛选">
          <DateRangePicker
            range={range}
            timezone={props.data.timezone}
            onChange={(change) => props.onUsageQueryChange({ ...props.usageQuery, ...change })}
          />

          <RecordFilterCard label="用户" options={filterOptions.users} selected={props.usageQuery.recordUserIds?.map(String) || []} onChange={(values) => updateFilter("recordUserIds", values.map(Number))} searchable searchPlaceholder="搜索用户或用户 ID" />
          <RecordFilterCard label="上游账号" options={filterOptions.accounts} selected={props.usageQuery.recordAccountIds?.map(String) || []} onChange={(values) => updateFilter("recordAccountIds", values.map(Number))} searchable searchPlaceholder="搜索上游账号" />
          <RecordFilterCard label="模型" options={filterOptions.models} selected={props.usageQuery.recordModels || []} onChange={(values) => updateFilter("recordModels", values)} searchable searchPlaceholder="搜索模型" />
          <RecordFilterCard label="上游接口" options={filterOptions.upstreamEndpoints} selected={props.usageQuery.recordUpstreamEndpoints || []} onChange={(values) => updateFilter("recordUpstreamEndpoints", values)} searchable searchPlaceholder="搜索上游接口" />
          <RecordFilterCard label="计费模式" options={filterOptions.billingModes} selected={props.usageQuery.recordBillingModes || []} onChange={(values) => updateFilter("recordBillingModes", values)} />
          <RecordFilterCard label="上游模型审计" options={filterOptions.upstreamModelMismatch} selected={props.usageQuery.recordUpstreamModelMismatch?.map(String) || []} onChange={(values) => props.onUsageQueryChange({ ...props.usageQuery, recordUpstreamModelMismatch: values.map((value) => value === "true") })} />
          <RecordFilterCard label="类型" options={filterOptions.requestTypes} selected={props.usageQuery.recordRequestTypes?.map(String) || []} onChange={(values) => updateFilter("recordRequestTypes", values.map(Number))} />
          <RecordFilterCard label="API 密钥" options={filterOptions.apiKeys} selected={props.usageQuery.recordApiKeyIds?.map(String) || []} onChange={(values) => updateFilter("recordApiKeyIds", values.map(Number))} searchable searchPlaceholder="搜索 API 密钥" />
          <RecordFilterCard label="入站接口" options={filterOptions.inboundEndpoints} selected={props.usageQuery.recordInboundEndpoints || []} onChange={(values) => updateFilter("recordInboundEndpoints", values)} />
          <RecordFilterCard label="分组" options={filterOptions.groups} selected={props.usageQuery.recordGroupIds || []} onChange={(values) => updateFilter("recordGroupIds", values)} />
          <RecordFilterCard label="计费类型" options={filterOptions.billingTypes} selected={props.usageQuery.recordBillingTypes || []} onChange={(values) => updateFilter("recordBillingTypes", values)} />
          </div>
        </div>
      </section>

      {props.loading && !props.records ? <LoadingSection /> : null}
      <UsageDistributionCharts data={props.analysis?.records || emptyDistributionData} />
        <section className="card table-section records-table-section" aria-label="使用记录列表">
        <div className="card-header table-header records-table-header">
          <h2>使用详情</h2>
          <div className="records-table-header-actions">
            <label className="records-limit-field">
              <span>每页：</span>
              <input type="number" min="1" max="10000" step="1" value={props.limit} onChange={(event) => props.onLimitChange(Math.min(10000, Math.max(1, Number(event.target.value) || 1)))} />
            </label>
            <div className="records-pagination" aria-label="记录分页">
              <button type="button" title="上一页" aria-label="上一页" disabled={props.page <= 1 || props.loading} onClick={() => props.onPageChange(props.page - 1)}><ChevronLeft size={15} aria-hidden="true" /></button>
              <span>第</span><input aria-label="跳转页码" type="number" min="1" max={props.records?.pageCount || 1} value={props.page} onChange={(event) => props.onPageChange(Math.min(props.records?.pageCount || 1, Math.max(1, Number(event.target.value) || 1)))} /><span>/ {props.records?.pageCount || 1} 页</span>
              <button type="button" title="下一页" aria-label="下一页" disabled={props.page >= (props.records?.pageCount || 1) || props.loading} onClick={() => props.onPageChange(props.page + 1)}><ChevronRight size={15} aria-hidden="true" /></button>
            </div>
          </div>
        </div>
        <div className="card-body card-body-flush">
          <DataTable
            rows={props.records?.rows || []}
            columns={props.records?.columns}
            labels={recordLabels}
            defaultSort="created_at"
            emptyText={props.loading ? "正在加载数据……" : "当前时间范围内没有使用记录"}
            renderCell={(value, key) => <span title={displayRecordValue(value)}>{formatRecordValue(value, key, props.data.timezone)}</span>}
          />
        </div>
      </section>
    </>
  );
}

const emptyDistributionData = { model: [], group: [], endpoint: [], user: [] };

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
  function closeFilter() {
    setOpen(false);
  }
  const toggle = (value: string, checked: boolean) => {
    const next = new Set(selected);
    checked ? next.add(value) : next.delete(value);
    props.onChange([...next]);
  };
  return <div ref={cardRef} className={`record-filter-card${open ? " is-open" : ""}`}>
    <FilterSummary label={props.label} value={summary} open={open} onClick={() => setOpen((value) => !value)} />
    {open ? <div className="record-filter-popover">
      <div className="record-filter-head"><strong>{props.label}</strong><button type="button" onClick={closeFilter}>完成</button></div>
      {props.searchable ? <label className="record-filter-search"><Search size={15} aria-hidden="true" /><input autoFocus type="search" value={search} placeholder={props.searchPlaceholder} onChange={(event) => setSearch(event.target.value)} /></label> : null}
      <div className="record-filter-actions"><span>全部 {props.options.length} 项</span><button type="button" onClick={() => props.onChange(props.options.map((option) => option.value))}>全选</button><button type="button" onClick={() => props.onChange([])}>清空</button></div>
      <div className="record-filter-options">{visibleOptions.length ? visibleOptions.map((option) => <label key={option.value}><input type="checkbox" checked={selected.has(option.value)} onChange={(event) => toggle(option.value, event.target.checked)} /><span><strong>{option.label}</strong>{option.hint ? <small>{option.hint}</small> : null}</span></label>) : <span className="record-filter-empty">没有匹配选项</span>}</div>
      <div className="record-filter-foot"><span>空选项表示不筛选</span><button type="button" onClick={closeFilter}>应用筛选</button></div>
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
  if (key === "billing_mode") return billingModeLabel(value);
  if (key === "upstream_model_mismatch" && typeof value === "boolean") return value ? "不匹配" : "匹配";
  if (isRecordDateKey(key)) {
    const parsed = new Date(String(value));
    if (!Number.isNaN(parsed.getTime())) return formatDateTime(parsed, timezone);
  }
  return displayRecordValue(value);
}

function isRecordDateKey(key: string): boolean {
  return /(^|_)(at|time|date)$|created|updated/i.test(key);
}
