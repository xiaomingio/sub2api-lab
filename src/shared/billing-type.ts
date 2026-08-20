/*
 * 文件说明: 定义 usage_logs.billing_type 的枚举值及其中文展示文本。
 * 参考资料: docs/prototypes/usage-filters.html 中的计费类型筛选原型。
 */

const billingTypeLabels: Record<string, string> = {
  "0": "钱包余额",
  "1": "订阅套餐"
};

function billingTypeLabel(value: unknown): string {
  const normalized = String(value ?? "").trim();
  return billingTypeLabels[normalized] || (normalized ? `未知类型（${normalized}）` : "未记录");
}

export { billingTypeLabel };
