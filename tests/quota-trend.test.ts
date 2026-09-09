import assert from "node:assert/strict";
import test from "node:test";
import { buildQuotaTrend, type QuotaTrendAccount } from "../src/client/features/quota-trend.js";
import type { QuotaSnapshot } from "../src/client/types.js";

const account: QuotaTrendAccount = {
  accountId: 1, name: "A", platform: "test", tokens: 0, actualCost: 0, standardCost: 0,
  fiveHourUsedPercent: null, sevenDayUsedPercent: 50, fiveHourWindowStart: null,
  sevenDayWindowStart: "2026-09-01T00:00:00Z", fiveHourResetAt: null,
  sevenDayResetAt: "2026-09-08T00:00:00Z", usageUpdatedAt: "2026-09-03T00:00:00Z"
};

function snapshot(at: string, usage: number, reset = false): QuotaSnapshot {
  return { id: Date.parse(at), accountId: 1, accountName: "A", platform: "test", sampledAt: at,
    sevenDayUsedPercent: usage, sevenDayResetAt: account.sevenDayResetAt,
    fiveHourUsedPercent: null, fiveHourResetAt: null, sub2apiUsageUpdatedAt: null,
    previousSevenDayUsedPercent: null, isReset: reset };
}

test("uses the nonzero post-reset sample even when a window start exists", () => {
  const rows = [snapshot("2026-08-31T23:00:00Z", 95), snapshot("2026-09-01T00:00:00Z", 2), snapshot("2026-09-02T00:00:00Z", 26)];
  const [trend] = buildQuotaTrend(rows, [account]);
  assert.deepEqual(trend.baseline, [Date.parse("2026-09-01T00:00:00Z"), 2]);
  assert.equal(trend.estimatedBaseline, false);
  const expected = Date.parse(account.usageUpdatedAt!) + 50 / (48 / (2 * 86400000));
  assert.equal(trend.exhaustedAt, expected);
  assert.ok(trend.exhaustedAt! < trend.resetAt!);
});

test("preserves the hourly sample timestamp rather than backdating it to the window start", () => {
  const [trend] = buildQuotaTrend([snapshot("2026-09-01T01:00:00Z", 3, true)], [account]);
  assert.deepEqual(trend.baseline, [Date.parse("2026-09-01T01:00:00Z"), 3]);
  assert.equal(trend.prediction.length, 2);
});

test("uses the latest reset rather than an earlier cycle", () => {
  const [trend] = buildQuotaTrend([
    snapshot("2026-09-01T00:00:00Z", 1, true), snapshot("2026-09-01T12:00:00Z", 80),
    snapshot("2026-09-02T00:00:00Z", 4), snapshot("2026-09-03T00:00:00Z", 28)
  ], []);
  assert.deepEqual(trend.baseline, [Date.parse("2026-09-02T00:00:00Z"), 4]);
  assert.equal(trend.exhaustedAt, Date.parse("2026-09-06T00:00:00Z"));
});

test("falls back to a real sample and can predict beyond the reset", () => {
  const [trend] = buildQuotaTrend([snapshot("2026-09-02T00:00:00Z", 8)], [{ ...account, sevenDayUsedPercent: 10 }]);
  assert.deepEqual(trend.baseline, [Date.parse("2026-09-02T00:00:00Z"), 8]);
  assert.equal(trend.estimatedBaseline, true);
  assert.ok(trend.exhaustedAt! > trend.resetAt!);
});

test("one point or flat usage cannot establish a positive slope", () => {
  assert.deepEqual(buildQuotaTrend([], [account])[0].prediction, []);
  assert.deepEqual(buildQuotaTrend([snapshot("2026-09-02T00:00:00Z", 50)], [account])[0].prediction, []);
});

test("a newly observed live decrease starts a new baseline instead of projecting the old cycle", () => {
  const [trend] = buildQuotaTrend([snapshot("2026-09-02T00:00:00Z", 90)], [{ ...account, sevenDayUsedPercent: 2 }]);
  assert.deepEqual(trend.baseline, [Date.parse(account.usageUpdatedAt!), 2]);
  assert.deepEqual(trend.prediction, []);
});
