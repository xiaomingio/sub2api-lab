/*
 * 文件说明: 定义 usage_logs.billing_mode 的面向用户展示文本。
 * 参考资料: Sub2API frontend/src/components/admin/usage/UsageFilters.vue。
 */

const billingModeLabels: Record<string, string> = {
  token: "按量",
  per_request: "按次",
  image: "按图片",
  video: "按视频"
};

function billingModeLabel(value: unknown): string {
  const normalized = String(value ?? "").trim();
  return billingModeLabels[normalized] || (normalized ? `未知模式（${normalized}）` : "未记录");
}

export { billingModeLabel };
