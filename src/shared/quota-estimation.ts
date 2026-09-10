/*
 * 文件说明: 定义额度估算的取样、模型容量和诊断结果契约。
 */
export const estimationRanges = [
  { hours: 720, label: "最近 30 天" },
  { hours: 168, label: "最近 7 天" },
  { hours: 72, label: "最近 3 天" },
  { hours: 24, label: "最近 24 小时" }
] as const;
export type EstimationHours = typeof estimationRanges[number]["hours"];
export type QuotaObservation = {
  accountId: number; accountName: string; sampledAt: string;
  updatedAt: string | null; resetAt: string | null; percent: number | null;
};
export type QuotaInterval = { id: number; accountId: number; start: string; end: string; percent: number };
export type BillingGroup = { groupId: number | null; groupName: string; channelName: string; input: number; output: number; cacheRead: number; cacheCreation: number; inputPrice: number | null; outputPrice: number | null; cacheReadPrice: number | null; cacheCreationPrice: number | null };
export type TokenEstimate = { tokenType: "input" | "output" | "cacheRead" | "cacheCreation"; tokens: number; capacity: number | null; coefficient: number | null };
export type ModelTokens = { model: string; input: number; output: number; cacheRead: number; cacheCreation: number; billingGroups?: BillingGroup[] };
export type QuotaSample = QuotaInterval & { models: ModelTokens[] };
export type ModelEstimate = ModelTokens & {
  totalTokens: number; share: number; cacheRate: number; outputRate: number; samples: number;
  tokenEstimates: TokenEstimate[];
  capacity: number | null; interval: [number, number] | null; comparisonCapacity: number | null; comparisonReason: string | null;
  status: "参考估算" | "估算不稳定" | "无法可靠估算"; reasons: string[];
};
export type AccountEstimate = {
  accountId: number; accountName: string; samples: number; effectiveHours: number;
  start: string | null; end: string | null; percent: number; discardedIntervals: number;
  validationError: number | null; models: ModelEstimate[]; reasons: string[];
};
export type QuotaEstimation = {
  hours: EstimationHours; start: string; end: string; timezone: string; accounts: AccountEstimate[];
};
