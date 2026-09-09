/*
 * 文件说明: 验证单模型容量恢复、多账号隔离、共线拒绝及重置和陈旧快照的取样边界。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { QuotaEstimator } from "../src/shared/QuotaEstimator.js";
import type { ModelTokens, QuotaObservation, QuotaSample } from "../src/shared/quota-estimation.js";

const HOUR = 3_600_000;
const origin = Date.parse("2026-09-01T00:00:00Z");
const at = (hour: number) => new Date(origin + hour * HOUR).toISOString();
function observation(hour: number, percent: number, extra: Partial<QuotaObservation> = {}): QuotaObservation {
  return { accountId: 1, accountName: "账号", sampledAt: at(hour), updatedAt: at(hour), percent, resetAt: at(168), ...extra };
}
function tokens(model: string, millions: number): ModelTokens {
  return { model, input: millions * 1e6 * 0.2, output: millions * 1e6 * 0.1, cacheRead: millions * 1e6 * 0.7, cacheCreation: 0 };
}
function sample(i: number, a: number, b: number, accountId = 1): QuotaSample {
  return { id: i, accountId, start: at(3 + i * 3), end: at(6 + i * 3), percent: (a * 0.5 + b * 2) * accountId, models: [tokens("A", a), tokens("B", b)] };
}
function estimator() { return new QuotaEstimator([observation(1, 0), observation(1, 0, { accountId: 2 })], new Date(at(0)), new Date(at(168))); }

test("恢复不同模型容量，低占比模型参与拟合，账号独立计算", () => {
  const samples = Array.from({ length: 32 }, (_, i) => sample(i, 2 + i % 4, 0.05 + (i % 5) * 0.08));
  const results = estimator().estimate([...samples, ...samples.map((s) => ({ ...s, accountId: 2, percent: s.percent * 2 }))], new Date(at(168)), false);
  for (const [index, result] of results.entries()) {
    const a = result.models.find((m) => m.model === "A")!;
    const b = result.models.find((m) => m.model === "B")!;
    assert.ok(b.share < 0.1);
    assert.ok(Math.abs(a.capacity! / (200e6 / (index + 1)) - 1) < 0.001);
    assert.ok(Math.abs(b.capacity! / (50e6 / (index + 1)) - 1) < 0.001);
    assert.ok(a.interval && a.interval[0] > 0);
    assert.ok(result.validationError! < 0.001);
    assert.ok(Math.abs(a.cacheRate - 7 / 9) < 1e-10);
  }
});

test("模型始终按固定比例使用时不编造单模型容量", () => {
  const result = estimator().estimate(Array.from({ length: 24 }, (_, i) => sample(i, i + 1, (i + 1) * 2)), new Date(at(168)), false)[0]!;
  assert.ok(result.models.every((m) => m.capacity === null));
  assert.ok(result.reasons.some((r) => r.includes("无法可靠拆分")));
});

test("剔除完整重置小时，重置前后有效区间可以同时保留", () => {
  const reset = 10.5;
  const rows = Array.from({ length: 20 }, (_, i) => observation(i, i <= 10 ? i : i - 11, { resetAt: at(i <= 10 ? reset : reset + 168) }));
  const e = new QuotaEstimator(rows, new Date(at(0)), new Date(at(20)));
  assert.ok(e.intervals.some((r) => Date.parse(r.end) <= Date.parse(at(10))));
  assert.ok(e.intervals.some((r) => Date.parse(r.start) >= Date.parse(at(11))));
  assert.ok(e.intervals.every((r) => !(Date.parse(r.start) < Date.parse(at(11)) && Date.parse(r.end) > Date.parse(at(10)))));
});

test("重复陈旧快照不产生零消耗样本，按真实更新时间合并", () => {
  const e = new QuotaEstimator([observation(1, 2), observation(2, 2, { updatedAt: at(1) }), observation(3, 2, { updatedAt: at(1) }), observation(4, 5)], new Date(at(0)), new Date(at(8)));
  assert.equal(e.intervals.length, 1);
  assert.equal(e.intervals[0]!.percent, 3);
  assert.equal(e.intervals[0]!.start, at(1));
  assert.equal(e.intervals[0]!.end, at(4));
});

test("未知下降、长缺口及范围之外的用量不进入有效样本", () => {
  const e = new QuotaEstimator([observation(0, 0), observation(2, 2), observation(4, 4), observation(5, 1), observation(13, 8), observation(16, 11)], new Date(at(1)), new Date(at(17)));
  assert.deepEqual(e.intervals.map((r) => [r.start, r.end, r.percent]), [[at(2), at(4), 2], [at(13), at(16), 3]]);
});

test("样本少或没有足够额度消耗时不外推容量", () => {
  const results = estimator().estimate([sample(0, 1, 1)], new Date(at(168)), false);
  assert.equal(results[0]!.models[0]!.capacity, null);
  assert.equal(results[1]!.models.length, 0);
});

test("异常时段降权，保留异常影响的后续预测误差", () => {
  const samples = Array.from({ length: 40 }, (_, i) => sample(i, 2 + i % 4, 0.05 + (i % 5) * 0.08));
  samples[35]!.percent += 30;
  const result = estimator().estimate(samples, new Date(at(168)), false)[0]!;
  assert.ok(Math.abs(result.models.find((m) => m.model === "A")!.capacity! / 200e6 - 1) < 0.1);
  assert.ok(result.validationError! > 0.3);
  assert.ok(result.models.every((m) => m.status === "估算不稳定"));
});
