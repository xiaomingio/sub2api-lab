/*
 * 文件说明: 生产启动入口，加载运行时依赖并启动 Fastify 应用。
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig } from "./server/config.js";
import { createDb } from "./server/db.js";
import { createApp } from "./server/app.js";

const config = loadConfig();
const db = await createDb(config).catch((error: unknown) => {
  console.error("Failed to initialize database connection", error);
  process.exit(1);
});
const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = createApp({ config, db, clientDir: path.join(projectDir, "dist/client") });

const close = async () => {
  await app.close();
  await db.pool.end();
};

process.on("SIGINT", () => {
  close().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  close().finally(() => process.exit(0));
});

await app.listen({ host: config.host, port: config.port }).catch((error: unknown) => {
  app.log.error(error, "Failed to start HTTP server");
  process.exit(1);
});
