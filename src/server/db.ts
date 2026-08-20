/*
 * 文件说明: 建立 PostgreSQL 连接池，并提供 Sub2API usage_logs 结构能力探测。
 */

import pg from "pg";
import type { AppConfig } from "./config.js";

type Db = {
  pool: pg.Pool;
  hasImageOutputTokens: boolean;
};

function shouldUseSsl(databaseUrl: string): boolean {
  const sslmode = new URL(databaseUrl).searchParams.get("sslmode");
  return Boolean(sslmode && sslmode !== "disable");
}

export async function createDb(config: AppConfig): Promise<Db> {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: shouldUseSsl(config.databaseUrl) ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });

  const result = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'usage_logs'
          AND column_name = 'image_output_tokens'
      ) AS exists
    `
  );

  return {
    pool,
    hasImageOutputTokens: result.rows[0]?.exists ?? false
  };
}

export type { Db };
