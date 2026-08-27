/*
 * 文件说明: 组装 Fastify 应用、注册页面和 JSON API 路由。
 */

import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultActualCost, defaultInitialBalance, listBalanceAccounts, normalizeInitialBalance } from "../shared/allocation.js";
import type { BalanceAccount } from "../shared/allocation.js";
import type { AppConfig } from "./config.js";
import type { Db, LabDb } from "./db.js";
import { resolveDateRange, resolveDateTimeRange } from "../shared/ranges.js";
import { createSub2APIAdminClient, restoreSelectedUserBalances } from "./sub2api-admin.js";
import { getUserUsageSummary } from "../shared/usage.js";
import { getUsageCostBasisReport, listUpstreamAccounts, normalizeAllocationBasis, parseAccountIds } from "../shared/usage-costs.js";
import { getUsageRecordFilterOptions, getUsageRecords } from "./usage-records.js";
import { getUsageAnalysis } from "./usage-analysis.js";
import { listQuotaSnapshots } from "./quota-snapshots.js";
import { registerRoutes } from "./routes.js";

type UsageQuery = {
  preset?: string;
  start_date?: string;
  end_date?: string;
  sort?: string;
  order?: string;
  allocation_basis?: string;
  allocation_account_ids?: string | string[];
  allocation_start_at?: string;
  allocation_end_at?: string;
  limit?: string;
  page?: string;
  user_ids?: string | string[];
  account_ids?: string | string[];
  models?: string | string[];
  upstream_endpoints?: string | string[];
  billing_modes?: string | string[];
  request_types?: string | string[];
  api_key_ids?: string | string[];
  upstream_model_mismatch?: string | string[];
  inbound_endpoints?: string | string[];
  group_ids?: string | string[];
  billing_types?: string | string[];
  granularity?: string;
  resets_only?: string;
};

type RestoreRequestBody = {
  targetBalance?: unknown;
  userIds?: unknown;
};

type AppOptions = {
  config: AppConfig;
  db: Db;
  labDb: LabDb;
  clientDir: string;
};

function pathFor(basePath: string, suffix: string): string {
  return `${basePath}${suffix}` || "/";
}

function isApiRequest(request: FastifyRequest, basePath: string): boolean {
  const requestPath = request.url.split("?", 1)[0];
  return requestPath.startsWith("/api/") || Boolean(basePath && requestPath.startsWith(`${basePath}/api/`));
}

function errorStatusCode(error: unknown): number {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return 500;
  }
  const statusCode = error.statusCode;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 600 ? statusCode : 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "服务器处理请求时发生未知错误";
}

function parseBodyUserIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map((raw) => Number(raw));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return null;
  return [...new Set(ids)];
}

export function createHandlers({ config, db, labDb, clientDir }: AppOptions) {
  const restoreClient = config.sub2api.adminApiKey
    ? createSub2APIAdminClient({ baseUrl: config.sub2api.baseUrl, adminApiKey: config.sub2api.adminApiKey })
    : null;

  async function sendHtml(reply: FastifyReply, name: "index" | "login") {
    const html = await readFile(path.join(clientDir, `${name}.html`), "utf8");
    return reply.type("text/html; charset=utf-8").send(html);
  }

  async function dashboardApi(request: FastifyRequest) {
    const query = request.query as UsageQuery;
    const range = resolveDateRange({
      preset: query.preset,
      startDate: query.start_date,
      endDate: query.end_date,
      timezone: config.timezone,
      defaultPreset: config.defaultRange
    });
    const allocationBasis = normalizeAllocationBasis(query.allocation_basis);
    const allocationRange = resolveDateTimeRange({
      startAt: query.allocation_start_at,
      endAt: query.allocation_end_at,
      timezone: config.timezone,
      fallback: range
    });
    const allocationAccountIds = allocationBasis === "balance" ? [] : parseAccountIds(query.allocation_account_ids);
    const [usage, balanceAccounts, upstreamAccounts, allocationUsage] = await Promise.all([
      getUserUsageSummary({ db, range, timezone: config.timezone, limit: config.maxRows, sortKey: query.sort, sortOrder: query.order }),
      listBalanceAccounts(db),
      listUpstreamAccounts(db),
      getUsageCostBasisReport({ db, range: allocationRange, basis: allocationBasis, accountIds: allocationAccountIds })
    ]);

    return {
      title: "Sub2API Lab",
      basePath: config.basePath,
      timezone: config.timezone,
      maxRows: config.maxRows,
      defaults: { initialBalance: defaultInitialBalance, actualCost: defaultActualCost, restoreTargetBalance: defaultInitialBalance },
      restore: {
        enabled: Boolean(restoreClient),
        disabledReason: restoreClient ? "" : "未配置 Sub2API 管理员 API Key，暂时不能执行余额写入"
      },
      balanceAccounts,
      upstreamAccounts,
      allocationRange,
      allocationUsage,
      usage
    };
  }

  async function usageApi(request: FastifyRequest) {
    const query = request.query as UsageQuery;
    const range = resolveDateRange({
      preset: query.preset,
      startDate: query.start_date,
      endDate: query.end_date,
      timezone: config.timezone,
      defaultPreset: config.defaultRange
    });
    return getUserUsageSummary({
      db,
      range,
      timezone: config.timezone,
      limit: config.maxRows,
      sortKey: query.sort,
      sortOrder: query.order
    });
  }

  async function usageRecordsApi(request: FastifyRequest) {
    const query = request.query as UsageQuery;
    const range = resolveDateRange({
      preset: query.preset,
      startDate: query.start_date,
      endDate: query.end_date,
      timezone: config.timezone,
      defaultPreset: config.defaultRange
    });
    return getUsageRecords({ db, range, limit: query.limit, page: query.page, defaultLimit: config.maxRows, userIds: parseQueryList(query.user_ids), accountIds: parseQueryList(query.account_ids), models: parseQueryList(query.models), upstreamEndpoints: parseQueryList(query.upstream_endpoints), billingModes: parseQueryList(query.billing_modes), requestTypes: parseQueryList(query.request_types), apiKeyIds: parseQueryList(query.api_key_ids), upstreamModelMismatch: parseQueryList(query.upstream_model_mismatch), inboundEndpoints: parseQueryList(query.inbound_endpoints), groupIds: parseQueryList(query.group_ids), billingTypes: parseQueryList(query.billing_types) });
  }

  async function usageRecordFilterOptionsApi(request: FastifyRequest) {
    const query = request.query as UsageQuery;
    const range = resolveDateRange({
      preset: query.preset,
      startDate: query.start_date,
      endDate: query.end_date,
      timezone: config.timezone,
      defaultPreset: config.defaultRange
    });
    return getUsageRecordFilterOptions(db, range);
  }

  async function usageAnalysisApi(request: FastifyRequest) {
    const query = request.query as UsageQuery;
    const range = resolveDateRange({ preset: query.preset || "last_7_days", startDate: query.start_date, endDate: query.end_date, timezone: config.timezone, defaultPreset: "last_7_days" });
    const granularity = query.granularity === "day" ? "day" : "hour";
    return getUsageAnalysis({ db, range, timezone: config.timezone, granularity, filters: { userIds: parseQueryList(query.user_ids), accountIds: parseQueryList(query.account_ids), models: parseQueryList(query.models), upstreamEndpoints: parseQueryList(query.upstream_endpoints), billingModes: parseQueryList(query.billing_modes), requestTypes: parseQueryList(query.request_types), apiKeyIds: parseQueryList(query.api_key_ids), upstreamModelMismatch: parseQueryList(query.upstream_model_mismatch), inboundEndpoints: parseQueryList(query.inbound_endpoints), groupIds: parseQueryList(query.group_ids), billingTypes: parseQueryList(query.billing_types) } });
  }

  async function quotaSnapshotsApi(request: FastifyRequest) {
    const query = request.query as UsageQuery;
    const range = resolveDateRange({ preset: query.preset || "last_7_days", startDate: query.start_date, endDate: query.end_date, timezone: config.timezone, defaultPreset: "last_7_days" });
    return {
      range: { start: range.start.toISOString(), end: range.end.toISOString(), startDate: range.startDate, endDate: range.endDate },
      snapshots: await listQuotaSnapshots({ labDb, start: range.start, end: range.end, accountIds: parseQueryList(query.account_ids).map(Number), resetsOnly: query.resets_only === "true" })
    };
  }

  async function restoreBalanceApi(request: FastifyRequest, reply: FastifyReply) {
    if (!restoreClient) return reply.code(503).send({ error: "未配置 Sub2API 管理员 API Key，不能执行余额设置" });
    const body = request.body as RestoreRequestBody;
    const targetBalance = normalizeInitialBalance(body?.targetBalance);
    if (!targetBalance) return reply.code(400).send({ error: "下月新系统额度必须是大于 0 的金额" });
    const userIds = parseBodyUserIds(body?.userIds);
    if (!userIds || userIds.length === 0) return reply.code(400).send({ error: "请选择需要设置系统余额的账号" });

    const accounts = await listBalanceAccounts(db);
    const accountById = new Map(accounts.map((account) => [account.userId, account]));
    const unknownUserIds = userIds.filter((userId) => !accountById.has(userId));
    if (unknownUserIds.length > 0) {
      return reply.code(400).send({ error: `以下账号不存在或不是可恢复的普通账号：${unknownUserIds.join(", ")}` });
    }
    const selectedAccounts = userIds
      .map((userId) => accountById.get(userId))
      .filter((account): account is BalanceAccount => account !== undefined);
    const result = await restoreSelectedUserBalances({
      accounts: selectedAccounts,
      targetBalance,
      operationId: randomUUID(),
      client: restoreClient
    });
    return { targetBalance, selectedUserIds: userIds, ...result };
  }

  return { dashboardApi, usageApi, usageRecordsApi, usageRecordFilterOptionsApi, usageAnalysisApi, quotaSnapshotsApi, sendHtml, restoreBalanceApi };
}

function parseQueryList(value: string | string[] | undefined): string[] {
  return [...new Set((Array.isArray(value) ? value : value ? [value] : []).flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean))];
}

type RouteHandlers = ReturnType<typeof createHandlers>;

export function createApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: { level: "warn" } });
  app.setErrorHandler((error, request, reply) => {
    const statusCode = errorStatusCode(error);
    request.log.error({ err: error }, "HTTP request failed");
    if (isApiRequest(request, options.config.basePath)) {
      return reply.code(statusCode).send({
        error: statusCode >= 500 ? "Internal Server Error" : error instanceof Error ? error.name : "Bad Request",
        message: errorMessage(error)
      });
    }
    return reply.send(error);
  });
  app.register(fastifyStatic, {
    root: path.join(options.clientDir, "assets"),
    prefix: pathFor(options.config.basePath, "/assets/")
  });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => done(null, body)
  );
  registerRoutes(app, options, createHandlers(options));
  return app;
}

export type { AppOptions, RouteHandlers };
