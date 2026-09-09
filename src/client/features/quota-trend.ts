import type { QuotaSnapshot, UsageAnalysisData } from "../types.js";

export type QuotaTrendAccount = UsageAnalysisData["quota"]["accounts"][number];
export type TrendPoint = [number, number | null];

export function buildQuotaTrend(rows: QuotaSnapshot[], accounts: QuotaTrendAccount[]) {
  const groups = new Map<number, QuotaSnapshot[]>();
  for (const row of [...rows].sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt))) {
    groups.set(row.accountId, [...(groups.get(row.accountId) || []), row]);
  }
  for (const account of accounts) if (!groups.has(account.accountId)) groups.set(account.accountId, []);
  return [...groups].sort(([a], [b]) => a - b).map(([id, history]) => {
    const account = accounts.find((item) => item.accountId === id);
    const latest = history.at(-1);
    const liveAt = Date.parse(account?.usageUpdatedAt || "");
    const useLive = account?.sevenDayUsedPercent != null && Number.isFinite(liveAt)
      && (!latest || liveAt >= Date.parse(latest.sampledAt));
    const currentAt = useLive ? liveAt : Date.parse(latest?.sampledAt || "");
    const used = useLive ? account!.sevenDayUsedPercent : latest?.sevenDayUsedPercent;
    const resetAt = Date.parse((useLive ? account?.sevenDayResetAt : latest?.sevenDayResetAt) || "");
    const points: TrendPoint[] = history.map((row) => [Date.parse(row.sampledAt), row.sevenDayUsedPercent]);
    if (useLive && (!latest || liveAt > Date.parse(latest.sampledAt))) points.push([liveAt, used!]);
    const windowStart = Date.parse(account?.sevenDayWindowStart || "");
    const sameWindow = account?.sevenDayResetAt != null && Date.parse(account.sevenDayResetAt) === resetAt;
    // Window times only delimit the cycle; baseline usage always comes from a real sample.
    const cycleStart = sameWindow && Number.isFinite(windowStart) ? windowStart
      : Number.isFinite(resetAt) ? resetAt - 7 * 24 * 60 * 60 * 1000 : -Infinity;
    const resetTimes = new Set(history.filter((row) => row.isReset || (
      row.sevenDayUsedPercent !== null && row.previousSevenDayUsedPercent !== null
      && row.sevenDayUsedPercent < row.previousSevenDayUsedPercent
    )).map((row) => Date.parse(row.sampledAt)));
    let previousUsage: number | null = null;
    for (const [at, usage] of points) {
      if (usage === null) continue;
      if (previousUsage !== null && usage < previousUsage) resetTimes.add(at);
      previousUsage = usage;
    }
    const cyclePoints = points.filter(([at, usage]) => usage !== null && at >= cycleStart && at <= currentAt);
    const detectedReset = cyclePoints.filter(([at]) => resetTimes.has(at)).at(-1);
    const baseline: TrendPoint | null = detectedReset || cyclePoints[0] || null;
    const estimatedBaseline = baseline !== null && !detectedReset;
    const rate = baseline && used != null && currentAt > baseline[0]
      ? (used - baseline[1]!) / (currentAt - baseline[0]) : 0;
    const exhaustedAt = used != null && used >= 100 ? currentAt
      : rate > 0 && used != null ? currentAt + (100 - used) / rate : null;
    const validEnd = exhaustedAt !== null && Number.isFinite(exhaustedAt) && exhaustedAt <= 8.64e15 ? exhaustedAt : null;
    return {
      id, name: account?.name || latest?.accountName || `账号 #${id}`, points,
      resets: [...resetTimes],
      resetAt: Number.isFinite(resetAt) && resetAt > currentAt ? resetAt : null,
      exhaustedAt: validEnd,
      baseline, estimatedBaseline,
      predictionUnavailableReason: used == null ? "暂无当前使用率"
        : !Number.isFinite(currentAt) ? "暂无有效用量时间"
        : !baseline ? "缺少有效重置基点"
        : currentAt <= baseline[0] ? "重置后尚无可计算的时间跨度"
        : rate <= 0 ? "本轮尚无正向消耗，暂无预计耗尽时间"
        : "预计耗尽时间超出可显示范围",
      prediction: validEnd !== null && used != null ? [[currentAt, used], [validEnd, 100]] as TrendPoint[] : []
    };
  });
}
