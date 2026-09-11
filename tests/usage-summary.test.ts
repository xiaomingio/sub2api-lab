/*
 * 文件说明: 在独立临时 PostgreSQL 中验证用户用量总计与列表限量、排序和时间范围的关系。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { getUserUsageSummary } from "../src/shared/usage.js";
import { getUsageAnalysis } from "../src/server/usage-analysis.js";
import { resolveDateRange } from "../src/shared/ranges.js";

const exec = promisify(execFile);
const hasPostgres = ["initdb", "pg_ctl"].every((command) => spawnSync(command, ["--version"]).status === 0);

test("列表限量与排序不改变全量总计，时间过滤和空范围正确", { skip: !hasPostgres && "需要本地 PostgreSQL 测试工具" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "lab-usage-test-"));
  const data = join(directory, "data");
  const pool = new pg.Pool({ host: directory, user: "postgres", database: "postgres", port: 5432 });
  let started = false;
  try {
    await exec("initdb", ["-D", data, "-U", "postgres", "-A", "trust", "--no-locale", "-E", "UTF8"]);
    await exec("pg_ctl", ["-D", data, "-l", join(directory, "postgres.log"), "-o", `-F -h '' -k '${directory}'`, "-w", "start"]);
    started = true;
    await pool.query(`
      CREATE TABLE users (id bigint PRIMARY KEY, email text, username text);
      CREATE TABLE usage_logs (
        user_id bigint, created_at timestamptz, input_tokens bigint, output_tokens bigint,
        cache_creation_tokens bigint, cache_read_tokens bigint, image_output_tokens bigint,
        total_cost numeric, actual_cost numeric
      );
      INSERT INTO users SELECT i, 'user' || i, '' FROM generate_series(1, 1001) i;
      INSERT INTO usage_logs SELECT i, '2026-09-01T12:00:00Z', i, 2, 3, 4, 5, i * 2, i FROM generate_series(1, 1001) i;
      INSERT INTO usage_logs VALUES (1, '2026-08-01T12:00:00Z', 999999, 0, 0, 0, 0, 999999, 999999);
    `);
    const params = {
      db: { pool, hasImageOutputTokens: true },
      range: resolveDateRange({ preset: "custom", startDate: "2026-09-01", endDate: "2026-09-01", timezone: "UTC", defaultPreset: "today" }),
      timezone: "UTC", limit: 1000, sortKey: "actual_cost", sortOrder: "desc"
    };
    const expected = { requests: 1001, users: 1001, totalTokens: 515515, actualCost: 501501, standardCost: 1003002 };
    const descending = await getUserUsageSummary(params);
    const ascending = await getUserUsageSummary({ ...params, sortOrder: "asc" });
    assert.equal(descending.rows.length, 1000);
    assert.equal(descending.rows[0]!.userId, 1001);
    assert.equal(ascending.rows[0]!.userId, 1);
    assert.deepEqual(descending.summary, expected);
    assert.deepEqual(ascending.summary, expected);
    const withoutImage = await getUserUsageSummary({ ...params, db: { pool, hasImageOutputTokens: false }, limit: 1 });
    assert.deepEqual(withoutImage.summary, { ...expected, totalTokens: 510510 });
    const empty = await getUserUsageSummary({ ...params, range: { ...params.range, start: new Date("2027-01-01"), end: new Date("2027-01-02") } });
    assert.equal(empty.rows.length, 0);
    assert.deepEqual(empty.summary, { requests: 0, users: 0, totalTokens: 0, actualCost: 0, standardCost: 0 });
    await pool.query(`
      CREATE TABLE accounts (id bigint PRIMARY KEY, name text, platform text, deleted_at timestamptz, extra jsonb);
      CREATE TABLE groups (id bigint PRIMARY KEY, name text);
      ALTER TABLE usage_logs ADD account_id bigint, ADD model text, ADD requested_model text,
        ADD inbound_endpoint text, ADD group_id bigint, ADD input_cost numeric DEFAULT 0,
        ADD output_cost numeric DEFAULT 0, ADD cache_read_cost numeric DEFAULT 0, ADD cache_creation_cost numeric DEFAULT 0;
      INSERT INTO accounts VALUES (1, 'A', 'openai', NULL, '{"codex_7d_reset_at":"2026-09-08T00:00:00Z"}');
      INSERT INTO usage_logs (account_id, user_id, created_at, input_tokens, actual_cost, total_cost) VALUES
        (1, 1, '2026-09-01T11:59:59Z', 10, 1, 2),
        (1, 1, '2026-09-01T12:00:00Z', 100, 10, 20),
        (1, 1, '2026-09-01T12:00:01Z', 1000, 100, 200);
    `);
    const analysis = await getUsageAnalysis({ db: params.db, range: params.range, timezone: "UTC", now: new Date("2026-09-01T12:00:00Z"), granularity: "hour" });
    assert.equal(analysis.quota.accounts[0]!.tokens, 10);
    assert.equal(analysis.quota.accounts[0]!.actualCost, 1);
    assert.equal(analysis.quota.accounts[0]!.standardCost, 2);

  } finally {
    await pool.end();
    if (started) await exec("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    await rm(directory, { recursive: true, force: true });
  }
});
