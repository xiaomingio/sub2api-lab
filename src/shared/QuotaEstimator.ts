/*
 * 文件说明: 按账号构建有效额度区间，以稳健非负回归估算单模型窗口容量并检查可识别性。
 */
import type { AccountEstimate, ModelEstimate, ModelTokens, QuotaInterval, QuotaObservation, QuotaSample } from "./quota-estimation.js";

const HOUR = 3_600_000;
const total = (m: ModelTokens) => m.input + m.output + m.cacheRead + m.cacheCreation;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const dot = (a: number[], b: number[]) => sum(a.map((x, i) => x * b[i]!));
const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)]!;

export class QuotaEstimator {
  readonly intervals: QuotaInterval[] = [];
  private readonly discarded = new Map<number, number>();
  private readonly accounts = new Map<number, string>();

  constructor(observations: QuotaObservation[], start: Date, end: Date, hourOffset = 0, accounts: Array<{ accountId: number; accountName: string }> = []) {
    for (const account of accounts) this.accounts.set(account.accountId, account.accountName);
    const groups = new Map<number, QuotaObservation[]>();
    for (const row of observations) {
      this.accounts.set(row.accountId, row.accountName);
      const group = groups.get(row.accountId) || [];
      group.push(row);
      groups.set(row.accountId, group);
    }
    for (const [accountId, rows] of groups) {
      let previous: QuotaObservation | null = null;
      let pending: QuotaInterval | null = null;
      const flush = () => { if (pending) this.intervals.push(pending); pending = null; };
      const discard = () => { flush(); this.discarded.set(accountId, (this.discarded.get(accountId) || 0) + 1); };
      for (const row of rows.sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt))) {
        const at = Date.parse(row.updatedAt || "");
        const reset = Date.parse(row.resetAt || "");
        if (!Number.isFinite(at) || !Number.isFinite(reset) || row.percent === null || !Number.isFinite(row.percent)
          || row.percent < 0 || row.percent > 100 || at > Date.parse(row.sampledAt) + 60_000) {
          discard(); previous = null; continue;
        }
        if (!previous) { previous = row; continue; }
        const from = Date.parse(previous.updatedAt!);
        if (at === from && row.percent === previous.percent && row.resetAt === previous.resetAt) continue;
        const old = previous;
        previous = row;
        const oldReset = Date.parse(old.resetAt!);
        // Exclude the complete local hour containing either edge of a weekly reset.
        const crossesResetHour = [oldReset, reset - 168 * HOUR].some((r) => {
          const hour = Math.floor((r + hourOffset) / HOUR) * HOUR - hourOffset;
          return from < hour + HOUR && at > hour;
        });
        if (from < start.getTime() || at > end.getTime()) { flush(); continue; }
        if (at <= from || oldReset <= from || reset <= at || at - from > 6 * HOUR
          || Math.abs(reset - oldReset) > 5 * 60_000 || row.percent < old.percent! || crossesResetHour) {
          discard(); continue;
        }
        const interval = { id: 0, accountId, start: new Date(from).toISOString(), end: new Date(at).toISOString(), percent: row.percent - old.percent! };
        if (pending && pending.end === interval.start) {
          pending.end = interval.end; pending.percent += interval.percent;
        } else { flush(); pending = interval; }
        if (pending && Date.parse(pending.end) - Date.parse(pending.start) >= 3 * HOUR - 5 * 60_000) flush();
      }
      flush();
    }
    this.intervals.forEach((interval, id) => { interval.id = id; });
  }

  estimate(samples: QuotaSample[], end: Date, compare = true): AccountEstimate[] {
    return [...this.accounts].map(([accountId, accountName]) => {
      const rows = samples.filter((row) => row.accountId === accountId).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      const result = this.fitAccount(rows);
      const comparison = compare ? this.fitAccount(rows.filter((row) => Date.parse(row.start) >= end.getTime() - 72 * HOUR)) : null;
      for (const model of result.models) {
        const recent = comparison?.models.find((m) => m.model === model.model);
        model.comparisonCapacity = recent?.capacity ?? null;
        model.comparisonReason = comparison && !model.comparisonCapacity ? recent?.reasons.join("；") || "最近 3 天没有足够的有效用量" : null;
        if (model.capacity && model.comparisonCapacity && Math.abs(model.capacity / model.comparisonCapacity - 1) > 0.3) {
          model.status = "估算不稳定"; model.reasons.push("7 天与 3 天容量相差超过 30%");
        }
      }
      return { accountId, accountName, discardedIntervals: this.discarded.get(accountId) || 0, ...result };
    });
  }

  private fitAccount(rows: QuotaSample[]): Omit<AccountEstimate, "accountId" | "accountName" | "discardedIntervals"> {
    const names = [...new Set(rows.flatMap((r) => r.models.map((m) => m.model)))].sort();
    const totals = names.map((model) => rows.reduce<ModelTokens>((acc, r) => {
      const m = r.models.find((x) => x.model === model);
      if (m) { acc.input += m.input; acc.output += m.output; acc.cacheRead += m.cacheRead; acc.cacheCreation += m.cacheCreation; acc.officialPricing ??= m.officialPricing; }
      return acc;
    }, { model, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }));
    const allTokens = sum(totals.map(total));
    const tokenTypes = ["input", "output", "cacheRead", "cacheCreation"] as const;
    const x = rows.map((r) => names.map((name) => sum(r.models.filter((m) => m.model === name).map(total)) / 1e6));
    const y = rows.map((r) => r.percent);
    const percent = sum(y);
    const reasons: string[] = [];
    if (rows.length < Math.max(8, names.length * 3)) reasons.push("有效时段不足，请扩大时间范围或继续积累数据");
    if (percent < 5) reasons.push("有效额度增量不足 5 个百分点");
    if (!names.length) reasons.push("有效区间内没有本地 Token 记录");
    if (names.length > 20) reasons.push("模型种类过多，当前样本不足以稳定拆分");
    if (names.length && !this.identifiable(x)) reasons.push("模型用量比例过于相似，无法可靠拆分");
    if (percent > 0 && sum(rows.filter((r) => !r.models.some((m) => total(m) > 0)).map((r) => r.percent)) / percent > 0.1) reasons.push("超过 10% 的额度增量没有对应的本地 Token，无法可靠归因");
    const canFit = reasons.length === 0;
    const beta = canFit ? this.solve(x, y) : [];
    const tokenX = rows.map((r) => names.flatMap((name) => tokenTypes.map((type) => r.models.filter((m) => m.model === name).reduce((value, m) => value + m[type], 0) / 1e6)));
    // Token 类型模式独立判断可识别性，不受模型级拟合结果影响。
    const tokenBeta = this.canSolve(tokenX, y) ? this.solve(tokenX, y) : [];
    const split = Math.floor(rows.length * 0.75);
    let validationError: number | null = null;
    if (canFit && split >= Math.max(6, names.length * 2) && this.identifiable(x.slice(0, split))) {
      const training = this.solve(x.slice(0, split), y.slice(0, split));
      const actual = sum(y.slice(split));
      if (actual >= 1) validationError = sum(x.slice(split).map((r, i) => Math.abs(dot(r, training) - y[split + i]!))) / actual;
    }
    // Moving-block bootstrap retains short-range dependence. Seed fixes display jitter.
    const capacities = names.map(() => [] as number[]);
    if (canFit) {
      let seed = 7241;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      for (let b = 0; b < 80; b++) {
        const indices: number[] = [];
        while (indices.length < rows.length) {
          const i = Math.floor(random() * rows.length);
          indices.push(i);
          if (indices.length < rows.length && i + 1 < rows.length && Date.parse(rows[i + 1]!.start) - Date.parse(rows[i]!.end) < 60_000) indices.push(i + 1);
        }
        const present = names.map((_, j) => j).filter((j) => indices.some((i) => x[i]![j]! > 0));
        const bx = indices.map((i) => present.map((j) => x[i]![j]!));
        if (!this.identifiable(bx)) continue;
        const coefficients = this.solve(bx, indices.map((i) => y[i]!));
        coefficients.forEach((v, j) => { if (v > 1e-8) capacities[present[j]!]!.push(100e6 / v); });
      }
    }
    const models = totals.map<ModelEstimate>((m, j) => {
      const tokens = total(m);
      const modelRows = rows.flatMap((r) => r.models.filter((v) => v.model === m.model && total(v) > 0));
      const capacity = canFit && modelRows.length >= 6 && beta[j]! > 1e-8 ? 100e6 / beta[j]! : null;
      const samples = modelRows.length;
      const draws = capacities[j]!;
      const interval: [number, number] | null = capacity && draws.length >= 64 ? [quantile(draws, 0.05), quantile(draws, 0.95)] : null;
      const modelReasons = [...reasons];
      if (canFit && beta[j]! <= 1e-8) modelReasons.push("消耗系数接近零，无法换算容量");
      if (canFit && !interval) modelReasons.push("重复取样结果不足，容量区间无法稳定确定");
      if (samples < 6) modelReasons.push("该模型出现的有效时段不足 6 个");
      if (validationError === null && canFit) modelReasons.push("缺少可用的后续时段预测验证");
      if (validationError !== null && validationError > 0.3) modelReasons.push("后续时段预测误差超过 30%");
      if (interval && capacity && (interval[1] - interval[0]) / capacity > 0.6) modelReasons.push("容量区间较宽");
      const structure = modelRows.map((r) => ({ cache: r.cacheRead / Math.max(1, r.input + r.cacheRead + r.cacheCreation), output: r.output / total(r), weight: total(r) }));
      const cacheRate = m.cacheRead / Math.max(1, m.input + m.cacheRead + m.cacheCreation);
      const outputRate = m.output / Math.max(1, tokens);
      if (structure.length && (Math.sqrt(sum(structure.map((r) => r.weight * (r.cache - cacheRate) ** 2)) / tokens) > 0.15
        || Math.sqrt(sum(structure.map((r) => r.weight * (r.output - outputRate) ** 2)) / tokens) > 0.1)) modelReasons.push("缓存率或输出比例随时段变化较大");
      const tokenEstimates = tokenTypes.map((type, typeIndex) => { const coefficient = tokenBeta[j * tokenTypes.length + typeIndex]; return { tokenType: type, tokens: m[type], coefficient: coefficient > 1e-8 ? coefficient : null, capacity: coefficient > 1e-8 ? 100e6 / coefficient : null }; });
      return { ...m, totalTokens: tokens, share: tokens / Math.max(1, allTokens), cacheRate, outputRate, samples, tokenEstimates,
        capacity, interval, comparisonCapacity: null, comparisonReason: null, status: !capacity ? "无法可靠估算" : modelReasons.length ? "估算不稳定" : "参考估算", reasons: modelReasons };
    }).sort((a, b) => b.totalTokens - a.totalTokens);
    return { samples: rows.length, effectiveHours: sum(rows.map((r) => (Date.parse(r.end) - Date.parse(r.start)) / HOUR)),
      start: rows[0]?.start ?? null, end: rows.at(-1)?.end ?? null, percent, validationError, reasons, models };
  }

  private canSolve(x: number[][], y: number[]): boolean { return x.length > 0 && x[0]!.length > 0 && x.length >= x[0]!.length && this.identifiable(x); }

  private identifiable(x: number[][]): boolean {
    if (!x.length || !x[0]!.length || x.length < x[0]!.length) return false;
    const basis: number[][] = [];
    for (let j = 0; j < x[0]!.length; j++) {
      let column = x.map((r) => r[j]!);
      const norm = Math.sqrt(dot(column, column));
      if (norm < 1e-12) return false;
      column = column.map((v) => v / norm);
      for (let pass = 0; pass < 2; pass++) for (const b of basis) {
        const projection = dot(column, b); column = column.map((v, i) => v - projection * b[i]!);
      }
      const residual = Math.sqrt(dot(column, column));
      if (residual < 0.05) return false;
      basis.push(column.map((v) => v / residual));
    }
    return true;
  }

  private solve(x: number[][], y: number[]): number[] {
    const n = x[0]!.length;
    const scales = Array.from({ length: n }, (_, j) => Math.sqrt(sum(x.map((r) => r[j]! ** 2))) || 1);
    const matrix = x.map((r) => r.map((v, j) => v / scales[j]!));
    const beta = Array<number>(n).fill(0);
    let weights = y.map(() => 1);
    for (let robust = 0; robust < 4; robust++) {
      const prediction = matrix.map((r) => dot(r, beta));
      for (let iteration = 0; iteration < 1000; iteration++) {
        let change = 0;
        for (let j = 0; j < n; j++) {
          let numerator = 0; let denominator = 0;
          for (let i = 0; i < matrix.length; i++) {
            const v = matrix[i]![j]!;
            numerator += weights[i]! * v * (y[i]! - prediction[i]! + v * beta[j]!);
            denominator += weights[i]! * v * v;
          }
          const next = Math.max(0, numerator / (denominator || 1));
          const delta = next - beta[j]!;
          change = Math.max(change, Math.abs(delta)); beta[j] = next;
          for (let i = 0; i < matrix.length; i++) prediction[i] = prediction[i]! + matrix[i]![j]! * delta;
        }
        if (change < 1e-7) break;
      }
      const errors = matrix.map((r, i) => Math.abs(y[i]! - dot(r, beta)));
      const threshold = Math.max(0.5, 1.5 * 1.4826 * quantile(errors, 0.5));
      weights = errors.map((e) => Math.min(1, threshold / Math.max(e, 1e-12)));
    }
    return beta.map((v, j) => v / scales[j]!);
  }
}
