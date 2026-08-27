/*
 * 文件说明: 验证 API 统一错误响应会向前端提供可诊断详情且不泄露堆栈。
 */

import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createApp } from "../src/server/app.js";
import type { AppConfig } from "../src/server/config.js";
import type { Db } from "../src/server/db.js";

const config: AppConfig = {
  host: "127.0.0.1",
  port: 9100,
  basePath: "",
  timezone: "Asia/Shanghai",
  authUser: "admin",
  authPassword: "password",
  defaultRange: "last_14_days",
  maxRows: 100,
  sub2api: { baseUrl: "http://127.0.0.1:8080", adminApiKey: "" },
  databaseUrl: "postgres://localhost/test",
  labDatabaseUrl: "postgres://localhost/sub2api_lab"
};

test("API 服务器异常会返回错误详情但不返回堆栈", async () => {
  const app = createApp({ config, db: {} as Db, labDb: {} as Db, clientDir: path.join(process.cwd(), "docs") });
  app.get("/api/test-error", async () => {
    throw new Error("数据库查询失败");
  });

  const response = await app.inject({ method: "GET", url: "/api/test-error" });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), {
    error: "Internal Server Error",
    message: "数据库查询失败"
  });
  assert.equal(response.body.includes("stack"), false);
  await app.close();
});
