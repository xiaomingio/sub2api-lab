/*
 * 文件说明: 集中处理 React 管理台的数字、金额、比例和时间展示格式。
 */

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("zh-CN");
}

function formatTokenAmount(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return Math.round(value).toLocaleString("zh-CN");
}

function formatUsageCost(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6
  })}`;
}

function formatAnalysisCost(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSystemBalance(value: string): string {
  return `$${value}`;
}

type ActualCostCurrency = "CNY" | "USD";

function formatActualCost(value: string, currency: ActualCostCurrency): string {
  return `${currency === "CNY" ? "¥" : "$"}${value}`;
}

function formatDateTime(value: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export { formatActualCost, formatAnalysisCost, formatDateTime, formatInteger, formatSystemBalance, formatTokenAmount, formatUsageCost };
export type { ActualCostCurrency };
