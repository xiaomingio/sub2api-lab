import assert from "node:assert/strict";
import test from "node:test";
import { buildQuotaTrend } from "../src/client/features/quota-trend.js";
import type { QuotaSnapshot } from "../src/client/types.js";

const account = {
  accountId: 1, name: "A", platform: "test", tokens: 0, actualCost: 0, standardCost: 0,
  fiveHourUsedPercent: null, sevenDayUsedPercent: 50, fiveHourWindowStart: null,
  sevenDayWindowStart: "2026-09-01T00:00:00Z", fiveHourResetAt: null,
  sevenDayResetAt: "2026-09-08T00:00:00Z", usageUpdatedAt: "2026-09-03T00:00:00Z"
};

function snapshot(at: string, usage: number, reset = false, resetAt = account.sevenDayResetAt): QuotaSnapshot {
  return { id: Date.parse(at), accountId: 1, accountName: "A", platform: "test", sampledAt: at,
    sevenDayUsedPercent: usage, sevenDayResetAt: resetAt,
    fiveHourUsedPercent: null, fiveHourResetAt: null, sub2apiUsageUpdatedAt: null,
    previousSevenDayUsedPercent: null, isReset: reset };
}

test("uses the nonzero post-reset sample even when a window start exists", () => {
  const rows = [snapshot("2026-08-31T23:00:00Z", 95), snapshot("2026-09-01T00:00:00Z", 2), snapshot("2026-09-02T00:00:00Z", 26)];
  const [trend] = buildQuotaTrend(rows);
  assert.deepEqual(trend.baseline, [Date.parse("2026-09-01T00:00:00Z"), 2]);
  assert.equal(trend.estimatedBaseline, true);
  const expected = Date.parse("2026-09-02T00:00:00Z") + 74 / (24 / 86400000);
  assert.equal(trend.exhaustedAt, expected);
  assert.equal(trend.prediction.length, 75);
  assert.ok(trend.exhaustedAt! < trend.resetAt!);
});

test("uses the hourly sample timestamp and does not predict from one sample", () => {
  const [trend] = buildQuotaTrend([snapshot("2026-09-01T01:00:00Z", 3, true)]);
  assert.deepEqual(trend.baseline, [Date.parse("2026-09-01T01:00:00Z"), 3]);
  assert.equal(trend.prediction.length, 0);
});

test("uses the latest reset rather than an earlier cycle", () => {
  const [trend] = buildQuotaTrend([
    snapshot("2026-09-01T00:00:00Z", 1, true), snapshot("2026-09-01T12:00:00Z", 80),
    snapshot("2026-09-02T00:00:00Z", 4, false, "2026-09-09T00:00:00Z"), snapshot("2026-09-03T00:00:00Z", 28, false, "2026-09-09T00:00:00Z")
  ]);
  assert.deepEqual(trend.baseline, [Date.parse("2026-09-02T00:00:00Z"), 4]);
  assert.equal(trend.exhaustedAt, Date.parse("2026-09-06T00:00:00Z"));
  assert.equal(trend.resetPrediction.length, 169);
  assert.deepEqual(trend.resetPrediction.at(0), [Date.parse("2026-09-02T00:00:00Z"), 4]);
  assert.deepEqual(trend.resetPrediction.at(-1), [Date.parse("2026-09-09T00:00:00Z"), 100]);
});

test("does not predict beyond the reset without a second local sample", () => {
  const [trend] = buildQuotaTrend([snapshot("2026-09-02T00:00:00Z", 8)]);
  assert.deepEqual(trend.baseline, [Date.parse("2026-09-02T00:00:00Z"), 8]);
  assert.equal(trend.estimatedBaseline, true);
  assert.equal(trend.prediction.length, 0);
  assert.equal(trend.resetPrediction.length, 145);
});

test("does not draw the reset exhaustion line for a past reset", () => {
  const [trend] = buildQuotaTrend([snapshot("2026-09-10T00:00:00Z", 8, false, "2026-09-08T00:00:00Z")]);
  assert.equal(trend.resetAt, null);
  assert.deepEqual(trend.resetPrediction, []);
});

test("one point or flat usage cannot establish a positive slope", () => {
  assert.deepEqual(buildQuotaTrend([]), []);
  assert.deepEqual(buildQuotaTrend([snapshot("2026-09-02T00:00:00Z", 50)])[0].prediction, []);
});

test("a live decrease without a local sample does not become a reset", () => {
  const [trend] = buildQuotaTrend([snapshot("2026-09-02T00:00:00Z", 90)]);
  assert.deepEqual(trend.baseline, [Date.parse("2026-09-02T00:00:00Z"), 90]);
  assert.deepEqual(trend.points, [[Date.parse("2026-09-02T00:00:00Z"), 90]]);
  assert.deepEqual(trend.resets, []);
  assert.deepEqual(trend.prediction, []);
});
