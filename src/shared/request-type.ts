/*
 * 文件说明: 定义 usage_logs.request_type 数字枚举及其面向用户的展示文本。
 * 参考资料: Sub2API backend/internal/service/usage_log.go。
 */

type RequestType = 0 | 1 | 2 | 3 | 4 | 5;

const requestTypeLabels: Record<RequestType, string> = {
  0: "未知响应（unknown）",
  1: "同步响应（sync）",
  2: "流式响应（stream）",
  3: "WebSocket V2（ws_v2）",
  4: "安全策略拦截（cyber）",
  5: "Live 响应（live）"
};

function requestTypeLabel(value: unknown): string | null {
  const numericValue = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isInteger(numericValue) || !Object.hasOwn(requestTypeLabels, numericValue)) {
    return null;
  }
  return requestTypeLabels[numericValue as RequestType];
}

export { requestTypeLabel };
export type { RequestType };
