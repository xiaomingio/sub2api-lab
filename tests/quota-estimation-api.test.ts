/*
 * 文件说明: 验证额度估算接口的登录保护、时间范围校验和子路径响应契约。
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createApp } from "../src/server/app.js";
import type { AppConfig } from "../src/server/config.js";
import type { Db, LabDb } from "../src/server/db.js";

const config: AppConfig = {
  host: "127.0.0.1", port: 9100, basePath: "/lab", timezone: "Asia/Shanghai", fakeNow: new Date("2026-09-09T00:00:00Z"),
  authUser: "admin", authPassword: "test-password", defaultRange: "last_7_days", maxRows: 100,
  sub2api: { baseUrl: "", adminApiKey: "" }, databaseUrl: "", databaseUrlSub2Api: ""
};

test("额度估算需要登录，拒绝无效范围，空样本保留账号和原因", async () => {
  let reads = 0;
  const db = { pool: { query: async () => { reads++; return { rows: [{ id: 42, name: "测试账号" }] }; } } } as unknown as Db;
  const labDb = { pool: { query: async () => { reads++; return { rows: [] }; } } } as unknown as LabDb;
  const app = createApp({ config, db, labDb, clientDir: path.join(process.cwd(), "docs") });
  try {
    const anonymous = await app.inject({ method: "GET", url: "/lab/api/quota-estimation" });
    assert.equal(anonymous.statusCode, 401);
    assert.equal(reads, 0);
    const login = await app.inject({ method: "POST", url: "/lab/login", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "username=admin&password=test-password" });
    assert.equal(login.statusCode, 302);
    const rawCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(rawCookie) ? rawCookie[0]! : rawCookie!).split(";")[0]!;
    const invalid = await app.inject({ method: "GET", url: "/lab/api/quota-estimation?hours=999", headers: { cookie } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(reads, 0);
    const result = await app.inject({ method: "GET", url: "/lab/api/quota-estimation?hours=72", headers: { cookie } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["cache-control"], "no-store");
    const body = result.json();
    assert.equal(body.hours, 72);
    assert.equal(Date.parse(body.end) - Date.parse(body.start), 72 * 3_600_000);
    assert.equal(body.accounts[0].accountId, 42);
    assert.deepEqual(body.accounts[0].models, []);
    assert.ok(body.accounts[0].reasons.length);
  } finally { await app.close(); }
});
