/*
 * 文件说明: Fastify 服务入口，加载环境变量、注册鉴权，托管 React 管理台并提供 JSON API。
 */

import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCookieAuth } from "./auth.js";
import { defaultActualCost, defaultInitialBalance, listBalanceAccounts, normalizeInitialBalance } from "./balances.js";
import type { BalanceAccount } from "./balances.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { resolveDateRange, resolveDateTimeRange } from "./ranges.js";
import { createSub2APIAdminClient, restoreSelectedUserBalances } from "./sub2api.js";
import { getUserUsageSummary } from "./usage.js";
import { getUsageCostBasisReport, listUpstreamAccounts, normalizeAllocationBasis, parseAccountIds } from "./usage_costs.js";
import { getUsageRecords } from "./usage_records.js";

const config = loadConfig();
const db = await createDb(config).catch((error: unknown) => {
  console.error("Failed to initialize database connection", error);
  process.exit(1);
});
const app = Fastify({ logger: true });
const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(projectDir, "dist/client");
const assetsDir = path.join(clientDir, "assets");

app.register(fastifyStatic, {
  root: assetsDir,
  prefix: `${config.basePath}/assets/`
});
app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_request, body, done) => done(null, body)
);

app.get("/health", async () => ({ ok: true }));
if (config.basePath) {
  app.get(`${config.basePath}/health`, async () => ({ ok: true }));
}

const auth = createCookieAuth({
  user: config.authUser,
  password: config.authPassword,
  basePath: config.basePath
});
const requireAuth = auth.requireAuth;

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
};

type RestoreRequestBody = {
  targetBalance?: unknown;
  userIds?: unknown;
};

const restoreClient = config.sub2api.adminApiKey
  ? createSub2APIAdminClient({
      baseUrl: config.sub2api.baseUrl,
      adminApiKey: config.sub2api.adminApiKey
    })
  : null;

function dashboardPath(basePath: string): string {
  return `${basePath}/`.replace("//", "/");
}

function htmlPath(name: "index" | "login"): string {
  return path.join(clientDir, `${name}.html`);
}

async function sendHtml(reply: FastifyReply, name: "index" | "login") {
  const html = await readFile(htmlPath(name), "utf8");
  return reply.type("text/html; charset=utf-8").send(html);
}

function parseBodyUserIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const ids = value.map((raw) => Number(raw));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return null;
  }
  return [...new Set(ids)];
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
    getUserUsageSummary({
      db,
      range,
      timezone: config.timezone,
      limit: config.maxRows,
      sortKey: query.sort,
      sortOrder: query.order
    }),
    listBalanceAccounts(db),
    listUpstreamAccounts(db),
    getUsageCostBasisReport({
      db,
      range: allocationRange,
      basis: allocationBasis,
      accountIds: allocationAccountIds
    })
  ]);

  return {
    title: "Sub2API Lab",
    basePath: config.basePath,
    timezone: config.timezone,
    maxRows: config.maxRows,
    defaults: {
      initialBalance: defaultInitialBalance,
      actualCost: defaultActualCost,
      restoreTargetBalance: defaultInitialBalance
    },
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
  return getUsageRecords({ db, range, limit: query.limit, defaultLimit: config.maxRows });
}

async function restoreBalanceApi(request: FastifyRequest, reply: FastifyReply) {
  if (!restoreClient) {
    return reply.code(503).send({
      error: "未配置 Sub2API 管理员 API Key，不能执行余额设置"
    });
  }

  const body = request.body as RestoreRequestBody;
  const targetBalance = normalizeInitialBalance(body?.targetBalance);
  if (!targetBalance) {
    return reply.code(400).send({ error: "下月新系统额度必须是大于 0 的金额" });
  }

  const userIds = parseBodyUserIds(body?.userIds);
  if (!userIds || userIds.length === 0) {
    return reply.code(400).send({ error: "请选择需要设置系统余额的账号" });
  }

  const accounts = await listBalanceAccounts(db);
  const accountById = new Map(accounts.map((account) => [account.userId, account]));
  const unknownUserIds = userIds.filter((userId) => !accountById.has(userId));
  if (unknownUserIds.length > 0) {
    return reply.code(400).send({
      error: `以下账号不存在或不是可恢复的普通账号：${unknownUserIds.join(", ")}`
    });
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

  return {
    targetBalance,
    selectedUserIds: userIds,
    ...result
  };
}

app.get("/", { preHandler: requireAuth }, async (_request, reply) => sendHtml(reply, "index"));
app.get("/api/dashboard", { preHandler: requireAuth }, dashboardApi);
app.get("/api/usage", { preHandler: requireAuth }, usageApi);
app.get("/api/usage-records", { preHandler: requireAuth }, usageRecordsApi);
app.post("/api/balances/restore", { preHandler: requireAuth }, restoreBalanceApi);
app.get("/login", async (_request, reply) => sendHtml(reply, "login"));
app.post("/login", auth.handleLogin);
app.post("/logout", { preHandler: requireAuth }, auth.handleLogout);

if (config.basePath) {
  app.get(config.basePath, async (request, reply) => {
    const queryIndex = request.url.indexOf("?");
    const queryString = queryIndex >= 0 ? request.url.slice(queryIndex) : "";
    return reply.redirect(`${dashboardPath(config.basePath)}${queryString}`);
  });
  app.get(`${config.basePath}/`, { preHandler: requireAuth }, async (_request, reply) => sendHtml(reply, "index"));
  app.get(`${config.basePath}/api/dashboard`, { preHandler: requireAuth }, dashboardApi);
  app.get(`${config.basePath}/api/usage`, { preHandler: requireAuth }, usageApi);
  app.get(`${config.basePath}/api/usage-records`, { preHandler: requireAuth }, usageRecordsApi);
  app.post(`${config.basePath}/api/balances/restore`, { preHandler: requireAuth }, restoreBalanceApi);
  app.get(`${config.basePath}/login`, async (_request, reply) => sendHtml(reply, "login"));
  app.post(`${config.basePath}/login`, auth.handleLogin);
  app.post(`${config.basePath}/logout`, { preHandler: requireAuth }, auth.handleLogout);
}

const close = async () => {
  await app.close();
  await db.pool.end();
};

process.on("SIGINT", () => {
  close().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  close().finally(() => process.exit(0));
});

await app.listen({ host: config.host, port: config.port }).catch((error: unknown) => {
  app.log.error(error, "Failed to start HTTP server");
  process.exit(1);
});
