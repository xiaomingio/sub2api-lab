/*
 * 文件说明: 将额度快照表名从项目专属长名称统一为 quota_snapshots。
 */

export async function up(client) {
  await client.query(`
    DO $$
    BEGIN
      IF to_regclass('public.sub2api_lab_quota_snapshots') IS NOT NULL
        AND to_regclass('public.quota_snapshots') IS NULL THEN
        ALTER TABLE sub2api_lab_quota_snapshots RENAME TO quota_snapshots;
      END IF;
    END
    $$
  `);
  await client.query(`
    ALTER INDEX IF EXISTS sub2api_lab_quota_snapshots_account_sampled_idx
    RENAME TO quota_snapshots_account_sampled_idx
  `);
  await client.query(`
    ALTER INDEX IF EXISTS sub2api_lab_quota_snapshots_reset_sampled_idx
    RENAME TO quota_snapshots_reset_sampled_idx
  `);
}
