/*
 * 文件说明: 生产启动入口，加载运行时依赖并启动 Fastify 应用。
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig } from "./server/config.js";
import { createDb, createLabDb } from "./server/db.js";
import { createApp } from "./server/app.js";
import { createQuotaSnapshotScheduler } from "./server/quota-snapshot-scheduler.js";

const config = loadConfig();
const db = await createDb(config).catch((error: unknown) => {
  console.error("Failed to initialize database connection", error);
  process.exit(1);
});
const labDb = createLabDb(config);
const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = createApp({ config, db, labDb, clientDir: path.join(projectDir, "dist/client") });
const quotaSnapshotScheduler = createQuotaSnapshotScheduler({ sourceDb: db, labDb, timezone: config.timezone, log: (message, error) => error ? console.error(message, error) : console.log(message) });
quotaSnapshotScheduler.start();

const close = async () => {
  await app.close();
  quotaSnapshotScheduler.stop();
  await db.pool.end();
  await labDb.pool.end();
};

process.on("SIGINT", () => {
  close().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  close().finally(() => process.exit(0));
});

const address = await app.listen({ host: config.host, port: config.port }).catch((error: unknown) => {
  console.error("Failed to start HTTP server", error);
  process.exit(1);
});

const accessUrl = new URL(address);
if (accessUrl.hostname === "0.0.0.0" || accessUrl.hostname === "[::]") {
  accessUrl.hostname = "localhost";
}
accessUrl.pathname = `${config.basePath}/`;
console.log(`\n  Sub2API Lab: ${accessUrl.href}\n`);
