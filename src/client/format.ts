/*
 * 文件说明: 集中处理 React 管理台的数字、金额、比例和时间展示格式。
 */

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("zh-CN");
}

function formatUsageCost(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6
  })}`;
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

export { formatActualCost, formatDateTime, formatInteger, formatSystemBalance, formatUsageCost };
export type { ActualCostCurrency };
