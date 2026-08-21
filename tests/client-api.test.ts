/*
 * 文件说明: 验证客户端 API 错误解析优先展示服务端返回的详细信息。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonResponse } from "../src/client/api.js";

test("客户端错误解析使用服务端 message 详情", async () => {
  await assert.rejects(
    parseJsonResponse(new Response(JSON.stringify({ error: "Internal Server Error", message: "数据库查询失败" }), { status: 500 })),
    (error: unknown) => error instanceof Error && error.message === "数据库查询失败"
  );
});
