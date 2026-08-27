/*
 * 文件说明: 定义空的 Sub2API Lab 数据库需要的最终 Schema。
 * 参考资料: @xiaomingio/tiny-db-migrate
 */

export async function up(client) {
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
  await client.query(
    "CREATE INDEX sub2api_lab_quota_snapshots_account_sampled_idx ON sub2api_lab_quota_snapshots (account_id, sampled_at DESC)"
  );
  await client.query(
    "CREATE INDEX sub2api_lab_quota_snapshots_reset_sampled_idx ON sub2api_lab_quota_snapshots (is_reset, sampled_at DESC)"
  );
}
