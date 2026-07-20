/*
 * 文件说明: 验证 Sub2API 管理接口写入请求和所选账号余额恢复汇总规则。
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { BalanceAccount } from "../src/balances.js";
import { createSub2APIAdminClient, restoreSelectedUserBalances } from "../src/sub2api.js";
import type { SetBalanceInput, Sub2APIAdminClient } from "../src/sub2api.js";

function account(userId: number, currentBalance: string): BalanceAccount {
  return {
    userId,
    email: `user${userId}@example.com`,
    username: "",
    status: "active",
    currentBalance
  };
}

test("覆盖余额请求使用管理员 API、幂等键和 set 操作", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createSub2APIAdminClient({
    baseUrl: "http://sub2api.example",
    adminApiKey: "test-admin-key",
    fetchImplementation: (async (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch
  });

  await client.setUserBalance({
    userId: 42,
    targetBalance: "5000",
    idempotencyKey: "idem-42",
    notes: "test"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://sub2api.example/api/v1/admin/users/42/balance");
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal((calls[0]?.init.headers as Record<string, string>)["x-api-key"], "test-admin-key");
  assert.equal((calls[0]?.init.headers as Record<string, string>)["Idempotency-Key"], "idem-42");
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    balance: 5000,
    operation: "set",
    notes: "test"
  });
});

test("余额恢复只写入传入的所选账号", async () => {
  const writtenUserIds: number[] = [];
  const client: Sub2APIAdminClient = {
    async setUserBalance(input: SetBalanceInput) {
      writtenUserIds.push(input.userId);
    }
  };

  const result = await restoreSelectedUserBalances({
    accounts: [account(1, "4200"), account(3, "100")],
    targetBalance: "5000",
    operationId: "operation",
    client
  });

  assert.deepEqual(writtenUserIds, [1, 3]);
  assert.deepEqual(result.updatedUserIds, [1, 3]);
});

test("余额已经等于目标额度的账号会跳过写入", async () => {
  const writtenUserIds: number[] = [];
  const client: Sub2APIAdminClient = {
    async setUserBalance(input: SetBalanceInput) {
      writtenUserIds.push(input.userId);
    }
  };

  const result = await restoreSelectedUserBalances({
    accounts: [account(1, "5000"), account(2, "4200")],
    targetBalance: "5000",
    operationId: "operation",
    client
  });

  assert.deepEqual(writtenUserIds, [2]);
  assert.deepEqual(result.updatedUserIds, [2]);
  assert.deepEqual(result.unchangedUserIds, [1]);
});

test("部分账号写入失败时返回失败明细并保留成功结果", async () => {
  const client: Sub2APIAdminClient = {
    async setUserBalance(input: SetBalanceInput) {
      if (input.userId === 2) {
        throw new Error("上游拒绝写入");
      }
    }
  };

  const result = await restoreSelectedUserBalances({
    accounts: [account(1, "4200"), account(2, "3900")],
    targetBalance: "5000",
    operationId: "operation",
    client,
    concurrency: 1
  });

  assert.deepEqual(result.updatedUserIds, [1]);
  assert.deepEqual(result.failures, [
    {
      userId: 2,
      displayName: "user2@example.com",
      reason: "上游拒绝写入"
    }
  ]);
});
