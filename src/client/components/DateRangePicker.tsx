/*
 * 文件说明: 共享用量统计和使用记录的日期范围选择器。
 */

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { presetLabels } from "../../shared/ranges.js";
import type { RangePreset } from "../../shared/ranges.js";
import { formatDateTime } from "../format.js";
import { FilterSummary } from "./FilterSummary.js";

const presetOrder: RangePreset[] = [
  "today",
  "yesterday",
  "last_24_hours",
  "sub2api_last_24_hours",
  "last_7_days",
  "last_14_days",
  "last_30_days",
  "this_month",
  "last_month"
];

type DateRangeValue = {
  preset: RangePreset;
  label: string;
  start: string;
  end: string;
  startDate: string;
  endDate: string;
};

type DateRangeChange = {
  preset: RangePreset;
  startDate?: string;
  endDate?: string;
};

type DateRangePickerProps = {
  range: DateRangeValue;
  timezone: string;
  onChange: (change: DateRangeChange) => void;
};

export function DateRangePicker({ range, timezone, onChange }: DateRangePickerProps) {
  const [customStart, setCustomStart] = useState(range.startDate);
  const [customEnd, setCustomEnd] = useState(range.endDate);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | undefined>();
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCustomStart(range.startDate);
    setCustomEnd(range.endDate);
  }, [range.endDate, range.startDate]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) {
        closePicker();
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    const reposition = () => {
      if (open) positionPanel();
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  function positionPanel() {
    const picker = pickerRef.current;
    const panel = panelRef.current;
    if (!picker || !panel) return;
    const trigger = picker.getBoundingClientRect();
    const viewportPadding = 16;
    const panelWidth = Math.min(720, window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, trigger.left),
      window.innerWidth - panelWidth - viewportPadding
    );
    setPanelStyle({ left, top: trigger.bottom + 10, width: panelWidth });
  }

  function closePicker() {
    setOpen(false);
  }

  const rangeText = `${formatDateTime(range.start, timezone)} 至 ${formatDateTime(range.end, timezone)}`;
  return (
    <div className={`record-filter-card${open ? " is-open" : ""}`} ref={pickerRef}>
        <FilterSummary label="时间范围" value={range.label} title={rangeText} open={open} onClick={() => setOpen((value) => !value)} />
        {open ? <div className="range-panel" ref={panelRef} style={panelStyle}>
          <div className="preset-grid">
            {presetOrder.map((preset) => (
              <button
                className={`range-option${range.preset === preset ? " is-active" : ""}`}
                type="button"
                key={preset}
                onClick={() => {
                  onChange({ preset });
                  closePicker();
                }}
              >
                {presetLabels[preset]}
              </button>
            ))}
          </div>
          <form
            className="custom-range"
            onSubmit={(event) => {
              event.preventDefault();
              onChange({ preset: "custom", startDate: customStart, endDate: customEnd });
              closePicker();
            }}
          >
            <label>
              <span>开始日期</span>
              <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
            </label>
            <span className="range-arrow" aria-hidden="true">-&gt;</span>
            <label>
              <span>结束日期</span>
              <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
            </label>
            <button className="apply-button" type="submit">应用</button>
          </form>
        </div> : null}
    </div>
  );
}

export type { DateRangeChange, DateRangePickerProps, DateRangeValue };
