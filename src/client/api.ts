/*
 * 文件说明: 封装 React 管理台调用 Fastify JSON API 的请求与错误处理。
 */

import type { DashboardData, RestoreResult, UsageQuery } from "./types.js";

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
  return params.toString();
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`login?next=${encodeURIComponent(next)}`);
  }
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : `请求失败，HTTP ${response.status}`;
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
