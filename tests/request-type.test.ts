/*
 * 文件说明: 验证使用记录请求类型数字枚举的展示映射。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { requestTypeLabel } from "../src/shared/request-type.js";

test("请求类型数字映射为具体响应类型", () => {
  assert.equal(requestTypeLabel(0), "未知响应（unknown）");
  assert.equal(requestTypeLabel("1"), "同步响应（sync）");
  assert.equal(requestTypeLabel(2), "流式响应（stream）");
  assert.equal(requestTypeLabel(3), "WebSocket V2（ws_v2）");
  assert.equal(requestTypeLabel(4), "安全策略拦截（cyber）");
  assert.equal(requestTypeLabel(5), "Live 响应（live）");
});

test("未知请求类型不伪造枚举名称", () => {
  assert.equal(requestTypeLabel(6), null);
  assert.equal(requestTypeLabel(""), null);
  assert.equal(requestTypeLabel(true), null);
});
