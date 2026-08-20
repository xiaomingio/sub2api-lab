/*
 * 文件说明: 提供业务无关的数据表格，支持自适应过滤、三态排序和固定行高虚拟滚动。
 */

import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import "./DataTable.css";

type SortType = "text" | "number" | "time";
type FilterType = "enum" | "text" | "range";
type FilterState = { text?: string; min?: string; max?: string; values?: Set<string> };
type DataTableProps<T extends Record<string, unknown>> = { rows: T[]; columns?: string[]; labels?: Record<string, string>; emptyText: string; defaultSort?: string; renderCell?: (value: unknown, key: string, row: T) => ReactNode };

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function isDateKey(key: string): boolean { return /(^|_)(at|time|date)$|created|updated/i.test(key); }
function inferType(key: string, value: unknown): SortType { return typeof value === "number" || (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) ? "number" : isDateKey(key) ? "time" : "text"; }
function inferFilter<T extends Record<string, unknown>>(key: string, type: SortType, rows: T[]): FilterType { return type !== "text" ? "range" : new Set(rows.map((row) => displayValue(row[key]))).size <= 12 ? "enum" : "text"; }
function rangeValue(value: unknown, type: SortType): number { return type === "time" ? Date.parse(displayValue(value)) || 0 : Number(value); }
function boundary(value: string | undefined, type: SortType): number | null { if (!value?.trim()) return null; const parsed = type === "time" ? Date.parse(value) : Number(value); return Number.isFinite(parsed) ? parsed : null; }
function sortValue(left: unknown, right: unknown, type: SortType): number { return type === "number" || type === "time" ? rangeValue(left, type) - rangeValue(right, type) : displayValue(left).localeCompare(displayValue(right), "zh-Hans-CN", { numeric: true, sensitivity: "base" }); }
function labelFor(key: string, labels: Record<string, string>): string {
  return labels[key] || key;
}

function FilterPanel<T extends Record<string, unknown>>({ keyName, type, filter, rows, onChange }: { keyName: string; type: SortType; filter?: FilterState; rows: T[]; onChange: (value: FilterState) => void }) {
  const mode = inferFilter(keyName, type, rows);
  const options = Array.from(new Set(rows.map((row) => displayValue(row[keyName]))));
  if (mode === "text") return <div className="data-filter-text"><input autoFocus value={filter?.text || ""} placeholder="包含..." onChange={(event) => onChange({ text: event.target.value })} /><button type="button" onClick={() => onChange({})}>清空</button></div>;
  if (mode === "range") { const inputType = type === "time" ? "datetime-local" : "number"; return <div className="data-filter-range"><label>最小值<input autoFocus type={inputType} value={filter?.min || ""} onChange={(event) => onChange({ min: event.target.value, max: filter?.max || "" })} /></label><label>最大值<input type={inputType} value={filter?.max || ""} onChange={(event) => onChange({ min: filter?.min || "", max: event.target.value })} /></label><button type="button" onClick={() => onChange({})}>清空</button></div>; }
  const selected = filter?.values || new Set(options);
  return <div className="data-filter-enum"><div className="data-filter-actions"><strong>{selected.size}/{options.length}</strong><button type="button" onClick={() => onChange({ values: new Set(options) })}>全选</button><button type="button" onClick={() => onChange({ values: new Set(options.filter((value) => !selected.has(value))) })}>反选</button><button type="button" onClick={() => onChange({ values: new Set() })}>清空</button></div>{options.map((option) => <label key={option}><input type="checkbox" checked={selected.has(option)} onChange={(event) => { const next = new Set(selected); event.target.checked ? next.add(option) : next.delete(option); onChange({ values: next }); }} /><span>{option}</span><small>{rows.filter((row) => displayValue(row[keyName]) === option).length}</small></label>)}</div>;
}

export function DataTable<T extends Record<string, unknown>>({ rows, columns, labels = {}, emptyText, defaultSort, renderCell }: DataTableProps<T>) {
  const keys = useMemo(() => columns || Array.from(new Set(rows.flatMap((row) => Object.keys(row)))), [columns, rows]);
  const columnInfo = useMemo(() => keys.map((key) => ({ key, type: inferType(key, rows.map((row) => row[key]).find((value) => value !== null && value !== undefined)) })), [keys, rows]);
  const [columnFilters, setColumnFilters] = useState<Record<string, FilterState>>({});
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(defaultSort ? { key: defaultSort, direction: "desc" } : null);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [filterPosition, setFilterPosition] = useState({ top: 0, left: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = 48;
  const filteredRows = useMemo(() => rows.filter((row) => keys.every((key) => { const filter = columnFilters[key]; const info = columnInfo.find((item) => item.key === key); if (!filter || !info) return true; const mode = inferFilter(key, info.type, rows); if (mode === "text") return !filter.text?.trim() || displayValue(row[key]).toLowerCase().includes(filter.text.trim().toLowerCase()); if (mode === "range") { const min = boundary(filter.min, info.type); const max = boundary(filter.max, info.type); const value = rangeValue(row[key], info.type); return (min === null || value >= min) && (max === null || value <= max); } return !filter.values || filter.values.has(displayValue(row[key])); })), [columnFilters, columnInfo, keys, rows]);
  const sortedRows = useMemo(() => { if (!sort) return filteredRows; const info = columnInfo.find((item) => item.key === sort.key); if (!info) return filteredRows; const direction = sort.direction === "asc" ? 1 : -1; return [...filteredRows].sort((left, right) => sortValue(left[sort.key], right[sort.key], info.type) * direction); }, [columnInfo, filteredRows, sort]);
  useEffect(() => { const shell = scrollRef.current; if (!shell) return; const resize = () => setViewportHeight(shell.clientHeight || 600); resize(); const observer = new ResizeObserver(resize); observer.observe(shell); return () => observer.disconnect(); }, []);
  useEffect(() => {
    if (!openFilter) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && (target.closest(".data-filter-popover") || target.closest(".data-table-filter-button"))) return;
      setOpenFilter(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [openFilter]);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 8); const visibleCount = Math.ceil(viewportHeight / rowHeight) + 16; const visibleRows = sortedRows.slice(startIndex, startIndex + visibleCount); const virtualized = sortedRows.length > visibleCount;
  function toggleSort(key: string) { setSort((current) => current?.key !== key ? { key, direction: "asc" } : current.direction === "asc" ? { key, direction: "desc" } : null); setScrollTop(0); if (scrollRef.current) scrollRef.current.scrollTop = 0; }
  return <div className="data-table-shell" ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}><table className="data-table"><thead><tr>{keys.map((key) => { const info = columnInfo.find((item) => item.key === key) || { key, type: "text" as SortType }; const activeSort = sort?.key === key ? sort.direction : null; const currentFilter = columnFilters[key]; const allValues = new Set(rows.map((row) => displayValue(row[key]))); const filterActive = Boolean(currentFilter?.text?.trim() || currentFilter?.min?.trim() || currentFilter?.max?.trim() || currentFilter?.values && currentFilter.values.size !== allValues.size); const sortLabel = `按${labelFor(key, labels)}排序`; return <th key={key} className="data-table-sortable" role="button" tabIndex={0} title={sortLabel} aria-label={sortLabel} aria-sort={activeSort === "asc" ? "ascending" : activeSort === "desc" ? "descending" : "none"} onClick={() => toggleSort(key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleSort(key); } }}><div className="data-table-heading"><button className="data-table-sort-area" type="button" onClick={(event) => { event.stopPropagation(); toggleSort(key); }}><span className="data-table-label">{labelFor(key, labels)}</span><span className="data-table-sort" aria-hidden="true">{activeSort === "asc" ? <ArrowUp size={16} /> : activeSort === "desc" ? <ArrowDown size={16} /> : <ArrowUpDown size={16} />}</span></button><button className={`data-table-filter-button${filterActive ? " is-active" : ""}`} type="button" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setFilterPosition({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)) }); setOpenFilter((current) => current === key ? null : key); }} aria-label={`过滤${labelFor(key, labels)}`}><ListFilter size={16} aria-hidden="true" /></button></div>{openFilter === key ? createPortal(<div className="data-filter-popover" style={filterPosition} onClick={(event) => event.stopPropagation()}><strong>{labelFor(key, labels)}</strong><FilterPanel keyName={key} type={info.type} filter={currentFilter} rows={rows} onChange={(value) => setColumnFilters((current) => ({ ...current, [key]: value }))} /></div>, document.body) : null}</th>; })}</tr></thead><tbody>{sortedRows.length === 0 ? <tr><td className="empty-cell" colSpan={Math.max(keys.length, 1)}>{emptyText}</td></tr> : <><tr aria-hidden="true"><td colSpan={keys.length} style={{ height: virtualized ? startIndex * rowHeight : 0, padding: 0, border: 0 }} /></tr>{visibleRows.map((row, index) => <tr key={`${startIndex + index}-${displayValue(row.id)}`}>{keys.map((key) => <td key={key}>{renderCell ? renderCell(row[key], key, row) : displayValue(row[key])}</td>)}</tr>)}<tr aria-hidden="true"><td colSpan={keys.length} style={{ height: virtualized ? Math.max(0, (sortedRows.length - startIndex - visibleRows.length) * rowHeight) : 0, padding: 0, border: 0 }} /></tr></>}</tbody></table></div>;
}

export type { DataTableProps };
