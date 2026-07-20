/*
 * 文件说明: 验证系统余额消耗比例分摊实际采购成本的核心金额规则。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { compareSystemBalancesDesc, createBalanceReport } from "../src/balances.js";
import type { BalanceAccount } from "../src/balances.js";

function account(userId: number, currentBalance: string): BalanceAccount {
  return {
    userId,
    email: `user${userId}@example.com`,
    username: "",
    status: "active",
    currentBalance
  };
}

test("按系统消耗比例把实际采购成本精确分摊到分", () => {
  const report = createBalanceReport({
    initialBalance: "5000",
    actualCost: "1100",
    accounts: [account(1, "4200"), account(2, "2200")]
  });

  assert.deepEqual(
    report.rows.map((row) => ({
      userId: row.userId,
      systemConsumed: row.systemConsumed,
      sharePercent: row.sharePercent,
      allocatedCost: row.allocatedCost
    })),
    [
      { userId: 2, systemConsumed: "2800", sharePercent: "77.7778%", allocatedCost: "855.56" },
      { userId: 1, systemConsumed: "800", sharePercent: "22.2222%", allocatedCost: "244.44" }
    ]
  );
  assert.equal(report.summary.allocatedCost, "1100.00");
});

test("最大余数法保证三人平均分 1 元时总额仍精确", () => {
  const report = createBalanceReport({
    initialBalance: "5000",
    actualCost: "1",
    accounts: [account(1, "4999"), account(2, "4999"), account(3, "4999")]
  });

  assert.deepEqual(
    report.rows.map((row) => [row.userId, row.allocatedCost]),
    [
      [1, "0.34"],
      [2, "0.33"],
      [3, "0.33"]
    ]
  );
  assert.equal(report.rows.reduce((sum, row) => sum + Number(row.allocatedCost), 0), 1);
});

test("未传入的账号不参与分摊", () => {
  const report = createBalanceReport({
    initialBalance: "5000",
    actualCost: "1100",
    accounts: [account(1, "4200")]
  });

  assert.equal(report.summary.accounts, 1);
  assert.equal(report.summary.totalSystemConsumed, "800");
  assert.equal(report.rows[0]?.allocatedCost, "1100.00");
});

test("余额高于初始系统额度时系统消耗记为 0", () => {
  const report = createBalanceReport({
    initialBalance: "5000",
    actualCost: "1100",
    accounts: [account(1, "5200")]
  });

  assert.equal(report.rows[0]?.systemConsumed, "0");
  assert.equal(report.rows[0]?.allocatedCost, "0.00");
  assert.equal(report.summary.unallocatedCost, "1100.00");
});

test("总系统消耗为 0 时采购成本保持未分配", () => {
  const report = createBalanceReport({
    initialBalance: "5000",
    actualCost: "1100",
    accounts: [account(1, "5000"), account(2, "5000")]
  });

  assert.equal(report.summary.totalSystemConsumed, "0");
  assert.equal(report.summary.allocatedCost, "0.00");
  assert.equal(report.summary.unallocatedCost, "1100.00");
});

test("系统余额字符串按金额数值从高到低比较", () => {
  const balances = ["9.9", "10", "10.00000001", "0", "5000"];

  assert.deepEqual([...balances].sort(compareSystemBalancesDesc), ["5000", "10.00000001", "10", "9.9", "0"]);
});
