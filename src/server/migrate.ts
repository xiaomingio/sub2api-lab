/*
 * 文件说明: 独立 sub2api_lab 数据库的发布前迁移命令入口。
 */

import { loadConfig } from "./config.js";
import { createLabDb } from "./db.js";
import { migrateLabDatabase } from "./lab-migrations.js";

const config = loadConfig();
const db = createLabDb(config);
try {
  await migrateLabDatabase(db.pool);
} finally {
  await db.pool.end();
}
