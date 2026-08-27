/*
 * 文件说明: 封装 React 管理台调用 Fastify JSON API 的请求与错误处理。
 */

import type { DashboardData, QuotaSnapshotsData, RestoreResult, UsageAnalysisData, UsageQuery, UsageRecordsData, UsageRecordFilterOptions } from "./types.js";

function apiPath(path: string): string {
  return path.replace(/^\/+/, "");
}

function dashboardSearch(query: UsageQuery): string {
  const params = new URLSearchParams();
  if (query.preset) {
    params.set("preset", query.preset);
  }
  if (query.startDate) {
    params.set("start_date", query.startDate);
  }
  if (query.endDate) {
    params.set("end_date", query.endDate);
  }
  if (query.sort) {
    params.set("sort", query.sort);
  }
  if (query.order) {
    params.set("order", query.order);
  }
  if (query.allocationBasis && query.allocationBasis !== "balance") {
    params.set("allocation_basis", query.allocationBasis);
  }
  if (query.allocationAccountIds && query.allocationAccountIds.length > 0) {
    params.set("allocation_account_ids", query.allocationAccountIds.join(","));
  }
  if (query.allocationStartAt) {
    params.set("allocation_start_at", query.allocationStartAt);
  }
  if (query.allocationEndAt) {
    params.set("allocation_end_at", query.allocationEndAt);
  }
  return params.toString();
}

function usageRecordsSearch(query: UsageQuery, limit: number, page: number): string {
  const params = new URLSearchParams();
  if (query.preset) params.set("preset", query.preset);
  if (query.startDate) params.set("start_date", query.startDate);
  if (query.endDate) params.set("end_date", query.endDate);
  if (query.recordUserIds?.length) params.set("user_ids", query.recordUserIds.join(","));
  if (query.recordAccountIds?.length) params.set("account_ids", query.recordAccountIds.join(","));
  if (query.recordModels?.length) params.set("models", query.recordModels.join(","));
  if (query.recordUpstreamEndpoints?.length) params.set("upstream_endpoints", query.recordUpstreamEndpoints.join(","));
  if (query.recordBillingModes?.length) params.set("billing_modes", query.recordBillingModes.join(","));
  if (query.recordRequestTypes?.length) params.set("request_types", query.recordRequestTypes.join(","));
  if (query.recordApiKeyIds?.length) params.set("api_key_ids", query.recordApiKeyIds.join(","));
  if (query.recordUpstreamModelMismatch?.length) params.set("upstream_model_mismatch", query.recordUpstreamModelMismatch.join(","));
  if (query.recordInboundEndpoints?.length) params.set("inbound_endpoints", query.recordInboundEndpoints.join(","));
  if (query.recordGroupIds?.length) params.set("group_ids", query.recordGroupIds.join(","));
  if (query.recordBillingTypes?.length) params.set("billing_types", query.recordBillingTypes.join(","));
  params.set("limit", String(limit));
  params.set("page", String(page));
  return params.toString();
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`login?next=${encodeURIComponent(next)}`);
  }
  if (!response.ok) {
    console.error("API request failed", {
      url: response.url,
      status: response.status,
      payload
    });
    const message = typeof payload.message === "string"
      ? payload.message
      : typeof payload.error === "string"
        ? payload.error
        : `请求失败，HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function fetchDashboard(query: UsageQuery): Promise<DashboardData> {
  const search = dashboardSearch(query);
  const response = await fetch(`${apiPath("api/dashboard")}${search ? `?${search}` : ""}`, {
    credentials: "same-origin"
  });
  return parseJsonResponse<DashboardData>(response);
}

export async function fetchUsageRecords(query: UsageQuery, limit: number, page: number): Promise<UsageRecordsData> {
  const search = usageRecordsSearch(query, limit, page);
  const response = await fetch(`${apiPath("api/usage-records")}?${search}`, { credentials: "same-origin" });
  return parseJsonResponse<UsageRecordsData>(response);
}

export async function fetchUsageRecordFilterOptions(query: UsageQuery): Promise<UsageRecordFilterOptions> {
  const params = new URLSearchParams();
  if (query.preset) params.set("preset", query.preset);
  if (query.startDate) params.set("start_date", query.startDate);
  if (query.endDate) params.set("end_date", query.endDate);
  const search = params.toString();
  const response = await fetch(`${apiPath("api/usage-record-filter-options")}${search ? `?${search}` : ""}`, { credentials: "same-origin" });
  return parseJsonResponse<UsageRecordFilterOptions>(response);
}

export async function fetchUsageAnalysis(query: UsageQuery, granularity: "hour" | "day", includeRecordFilters = true): Promise<UsageAnalysisData> {
  const params = new URLSearchParams({ preset: query.preset || "last_7_days", granularity });
  if (query.startDate) params.set("start_date", query.startDate);
  if (query.endDate) params.set("end_date", query.endDate);
  if (includeRecordFilters) {
    if (query.recordUserIds?.length) params.set("user_ids", query.recordUserIds.join(","));
    if (query.recordAccountIds?.length) params.set("account_ids", query.recordAccountIds.join(","));
    if (query.recordModels?.length) params.set("models", query.recordModels.join(","));
    if (query.recordUpstreamEndpoints?.length) params.set("upstream_endpoints", query.recordUpstreamEndpoints.join(","));
    if (query.recordBillingModes?.length) params.set("billing_modes", query.recordBillingModes.join(","));
    if (query.recordRequestTypes?.length) params.set("request_types", query.recordRequestTypes.join(","));
    if (query.recordApiKeyIds?.length) params.set("api_key_ids", query.recordApiKeyIds.join(","));
    if (query.recordUpstreamModelMismatch?.length) params.set("upstream_model_mismatch", query.recordUpstreamModelMismatch.join(","));
    if (query.recordInboundEndpoints?.length) params.set("inbound_endpoints", query.recordInboundEndpoints.join(","));
    if (query.recordGroupIds?.length) params.set("group_ids", query.recordGroupIds.join(","));
    if (query.recordBillingTypes?.length) params.set("billing_types", query.recordBillingTypes.join(","));
  }
  const response = await fetch(`${apiPath("api/usage-analysis")}?${params}`, { credentials: "same-origin" });
  return parseJsonResponse<UsageAnalysisData>(response);
}

export async function fetchQuotaSnapshots(query: UsageQuery, resetsOnly = false): Promise<QuotaSnapshotsData> {
  const params = new URLSearchParams({ preset: query.preset || "last_7_days", resets_only: String(resetsOnly) });
  if (query.startDate) params.set("start_date", query.startDate);
  if (query.endDate) params.set("end_date", query.endDate);
  const response = await fetch(`${apiPath("api/quota-snapshots")}?${params}`, { credentials: "same-origin" });
  return parseJsonResponse<QuotaSnapshotsData>(response);
}

export async function restoreBalances(params: {
  targetBalance: string;
  userIds: number[];
}): Promise<RestoreResult> {
  const response = await fetch(apiPath("api/balances/restore"), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(params)
  });
  return parseJsonResponse<RestoreResult>(response);
}
