/*
 * 文件说明: 注册根路径、鉴权页面和业务 API 路由。
 */

import type { FastifyInstance } from "fastify";
import { createCookieAuth } from "./auth.js";
import type { AppOptions, RouteHandlers } from "./app.js";

function pathFor(basePath: string, suffix: string): string {
  return `${basePath}${suffix}` || "/";
}

export function registerRoutes(app: FastifyInstance, options: AppOptions, handlers: RouteHandlers): void {
  const { config } = options;
  const auth = createCookieAuth({ user: config.authUser, password: config.authPassword, basePath: config.basePath });
  const requireAuth = auth.requireAuth;
  const scopes = config.basePath ? ["", config.basePath] : [""];

  app.get("/health", async () => ({ ok: true }));
  for (const scope of scopes) {
    const page = pathFor(scope, "/");
    const api = (suffix: string) => pathFor(scope, suffix);
    if (scope) app.get(api("/health"), async () => ({ ok: true }));
    app.get(page, { preHandler: requireAuth }, async (_request, reply) => handlers.sendHtml(reply, "index"));
    app.get(api("/api/dashboard"), { preHandler: requireAuth }, handlers.dashboardApi);
    app.get(api("/api/usage"), { preHandler: requireAuth }, handlers.usageApi);
    app.get(api("/api/usage-records"), { preHandler: requireAuth }, handlers.usageRecordsApi);
    app.get(api("/api/usage-record-filter-options"), { preHandler: requireAuth }, handlers.usageRecordFilterOptionsApi);
    app.post(api("/api/balances/restore"), { preHandler: requireAuth }, handlers.restoreBalanceApi);
    app.get(api("/login"), async (_request, reply) => handlers.sendHtml(reply, "login"));
    app.post(api("/login"), auth.handleLogin);
    app.post(api("/logout"), { preHandler: requireAuth }, auth.handleLogout);
    if (scope) {
      app.get(scope, async (request, reply) => {
        const queryIndex = request.url.indexOf("?");
        const queryString = queryIndex >= 0 ? request.url.slice(queryIndex) : "";
        return reply.redirect(page + queryString);
      });
    }
  }
}
