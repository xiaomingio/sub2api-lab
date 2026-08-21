/*
 * 文件说明: 提供日期和枚举筛选控件共用的触发器结构。
 */

import { ChevronDown } from "lucide-react";

type FilterSummaryProps = {
  label: string;
  value: string;
  title?: string;
  open?: boolean;
  onClick?: () => void;
};

export function FilterSummary(props: FilterSummaryProps) {
  return (
    <button
      className="filter-summary"
      type="button"
      aria-expanded={props.open}
      onClick={props.onClick}
    >
      <span className="field-kicker">{props.label}</span>
      <strong title={props.title}>{props.value}</strong>
      <ChevronDown className="filter-summary-chevron" size={17} aria-hidden="true" />
    </button>
  );
}
