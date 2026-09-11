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
  const results = estimator().estimate([...samples, ...samples.map((s) => ({ ...s, accountId: 2, percent: s.percent * 2 }))]);
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
  const result = estimator().estimate(Array.from({ length: 24 }, (_, i) => sample(i, i + 1, (i + 1) * 2)))[0]!;
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
  const results = estimator().estimate([sample(0, 1, 1)]);
  assert.equal(results[0]!.models[0]!.capacity, null);
  assert.equal(results[1]!.models.length, 0);
});

test("异常时段降权，保留异常影响的后续预测误差", () => {
  const samples = Array.from({ length: 40 }, (_, i) => sample(i, 2 + i % 4, 0.05 + (i % 5) * 0.08));
  samples[35]!.percent += 30;
  const result = estimator().estimate(samples)[0]!;
  assert.ok(Math.abs(result.models.find((m) => m.model === "A")!.capacity! / 200e6 - 1) < 0.1);
  assert.ok(result.validationError! > 0.3);
  assert.ok(result.models.every((m) => m.status === "估算不稳定"));
});


function typedSamples(count: number, scale = 1, withCreation = false): QuotaSample[] {
  return Array.from({ length: count }, (_, i) => {
    const input = 1 + i % 3;
    const output = 1 + i % 5;
    const cacheRead = 1 + i % 7;
    const cacheCreation = withCreation ? 1 + i % 11 : 0;
    return { id: i, accountId: 1, start: at(3 + i * 3), end: at(6 + i * 3),
      percent: scale * (input * 0.5 + output * 2 + cacheRead * 0.1 + cacheCreation * 0.2),
      models: [{ model: "A", input: input * 1e6, output: output * 1e6, cacheRead: cacheRead * 1e6, cacheCreation: cacheCreation * 1e6 }] };
  });
}

test("类型估算保留可识别的非零类型，空类型不阻塞其他容量", () => {
  const model = estimator().estimate(typedSamples(40))[0]!.models[0]!;
  for (const [i, expected] of [200e6, 50e6, 1000e6].entries()) {
    assert.ok(Math.abs(model.tokenEstimates[i]!.capacity! / expected - 1) < 0.001);
  }
  assert.equal(model.tokenEstimates[3]!.capacity, null);
});

test("类型估算拒绝少样本、低消耗和缺失日志的归因", () => {
  const short = typedSamples(4, 1, true).map((row, i) => ({ ...row, percent: 2, models: [{
    model: "A", input: (i === 0 ? 2 : 1) * 1e6, output: (i === 1 ? 2 : 1) * 1e6,
    cacheRead: (i === 2 ? 2 : 1) * 1e6, cacheCreation: (i === 3 ? 2 : 1) * 1e6
  }] }));
  const missing = typedSamples(40, 1, true);
  missing.push({ ...missing[0]!, id: 40, start: at(123), end: at(126), models: [], percent: 80 });
  for (const rows of [short, typedSamples(40, 0.001, true), missing]) {
    const model = estimator().estimate(rows)[0]!.models[0]!;
    assert.ok(model.tokenEstimates.every((item) => item.capacity === null));
  }
});


test("类型估算用自身后续预测误差标记异常结果", () => {
  const rows = typedSamples(40);
  rows[35]!.percent += 100;
  const model = estimator().estimate(rows)[0]!.models[0]!;
  for (const item of model.tokenEstimates.slice(0, 3)) {
    assert.ok(item.validationError! > 0.3);
    assert.equal(item.status, "估算不稳定");
  }
});

test("更新时间倒退不回退基点，日志区间互不重叠", () => {
  for (const withGap of [false, true]) {
    const rows = [observation(1, 1), observation(4, 4)];
    if (withGap) rows.push(observation(4.5, 4, { updatedAt: null }));
    rows.push(observation(5, 2, { updatedAt: at(2) }), observation(6, 6), observation(9, 9));
    const e = new QuotaEstimator(rows, new Date(at(0)), new Date(at(12)));
    for (let i = 1; i < e.intervals.length; i++) {
      assert.ok(Date.parse(e.intervals[i]!.start) >= Date.parse(e.intervals[i - 1]!.end));
    }
    assert.equal(e.intervals.reduce((sum, interval) => sum + interval.percent, 0), withGap ? 6 : 8);
  }
});

test("高度相关模型的求解未收敛时不返回失真的容量", () => {
  const rows = Array.from({ length: 40 }, (_, i) => sample(i, 1, 1 + (i % 2 ? 0.06 : -0.06)));
  const result = estimator().estimate(rows)[0]!;
  assert.ok(result.models.every((model) => model.capacity === null));
});

test("重采样中的零系数保留为无界容量，不能只用正系数给出有限区间", () => {
  const rows = Array.from({ length: 40 }, (_, i) => {
    const a = 2 + i % 4;
    const b = 0.5 + (i % 5) * 0.08;
    return { ...sample(i, a, b), percent: a * 0.5 + b * 0.1 + 0.2 * ((i * 17 % 11) / 5 - 1) };
  });
  const model = estimator().estimate(rows)[0]!.models.find((m) => m.model === "B")!;
  assert.ok(model.capacity! > 0);
  assert.equal(model.interval, null);
  assert.ok(model.reasons.some((reason) => reason.includes("上界无法确定")));
  assert.equal(model.status, "估算不稳定");
  assert.ok(!JSON.stringify(model).includes("Infinity"));
});
