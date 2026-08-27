/*
 * 文件说明: 维护 Sub2API Lab 独立数据库的正式 Schema 迁移。
 */

import type pg from "pg";

const schemaVersion = 1;

export async function migrateLabDatabase(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_schema_state (
        id integer PRIMARY KEY,
        current_version integer NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("INSERT INTO app_schema_state (id, current_version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING");
    const state = await client.query<{ current_version: number }>("SELECT current_version FROM app_schema_state WHERE id = 1 FOR UPDATE");
    const currentVersion = Number(state.rows[0]?.current_version || 0);
    if (currentVersion > schemaVersion) throw new Error(`Lab database schema version ${currentVersion} is newer than ${schemaVersion}`);
    if (currentVersion < 1) {
      await client.query(`
        CREATE TABLE sub2api_lab_quota_snapshots (
          id bigserial PRIMARY KEY,
          sampled_at timestamptz NOT NULL,
          account_id bigint NOT NULL,
          account_name text NOT NULL,
          platform text NOT NULL,
          five_hour_used_percent numeric(8, 4),
          seven_day_used_percent numeric(8, 4),
          five_hour_reset_at timestamptz,
          seven_day_reset_at timestamptz,
          sub2api_usage_updated_at timestamptz,
          previous_seven_day_used_percent numeric(8, 4),
          is_reset boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (sampled_at, account_id)
        )
      `);
      await client.query("CREATE INDEX sub2api_lab_quota_snapshots_account_sampled_idx ON sub2api_lab_quota_snapshots (account_id, sampled_at DESC)");
      await client.query("CREATE INDEX sub2api_lab_quota_snapshots_reset_sampled_idx ON sub2api_lab_quota_snapshots (is_reset, sampled_at DESC)");
      await client.query("UPDATE app_schema_state SET current_version = 1, updated_at = now() WHERE id = 1");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export { schemaVersion };
