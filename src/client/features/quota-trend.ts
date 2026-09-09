import type { QuotaSnapshot } from "../types.js";

export type TrendPoint = [number, number | null];

const HOUR_MS = 60 * 60 * 1000;

function hourlyLine(startAt: number, startUsage: number, endAt: number, endUsage: number): TrendPoint[] {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return [];
  const points: TrendPoint[] = [];
  for (let at = startAt; at < endAt; at += HOUR_MS) {
    const progress = (at - startAt) / (endAt - startAt);
    points.push([at, startUsage + (endUsage - startUsage) * progress]);
  }
  points.push([endAt, endUsage]);
  return points;
}

export function buildQuotaTrend(rows: QuotaSnapshot[]) {
  const groups = new Map<number, QuotaSnapshot[]>();
  for (const row of [...rows].sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt))) {
    groups.set(row.accountId, [...(groups.get(row.accountId) || []), row]);
  }
  return [...groups].sort(([a], [b]) => a - b).map(([id, history]) => {
    const latest = history.at(-1);
    const currentAt = Date.parse(latest?.sampledAt || "");
    const used = latest?.sevenDayUsedPercent;
    const resetAt = Date.parse(latest?.sevenDayResetAt || "");
    // The trend is intentionally based only on downloaded hourly snapshots.
    const points: TrendPoint[] = history.map((row) => [Date.parse(row.sampledAt), row.sevenDayUsedPercent]);
    const cycleStart = Number.isFinite(resetAt) ? resetAt - 7 * 24 * 60 * 60 * 1000 : -Infinity;
    const resetTimes = new Set<number>();
    let previous: QuotaSnapshot | null = null;
    for (const row of history) {
      if (row.sevenDayUsedPercent === null) continue;
      if (previous?.sevenDayUsedPercent !== null && previous?.sevenDayUsedPercent !== undefined
        && row.sevenDayUsedPercent < previous.sevenDayUsedPercent) {
        const previousResetAt = Date.parse(previous.sevenDayResetAt || "");
        const currentResetAt = Date.parse(row.sevenDayResetAt || "");
        // A lower downloaded value alone is ambiguous. Require the upstream
        // window identity to advance before drawing a reset marker.
        if (Number.isFinite(previousResetAt) && Number.isFinite(currentResetAt) && currentResetAt > previousResetAt) {
          resetTimes.add(Date.parse(row.sampledAt));
        }
      }
      previous = row;
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
    const nextResetAt = Number.isFinite(resetAt) && resetAt > currentAt ? resetAt : null;
    const resetPrediction = baseline !== null && nextResetAt !== null && baseline[0] < nextResetAt
      ? hourlyLine(baseline[0], baseline[1]!, nextResetAt, 100)
      : [];
    return {
      id, name: latest?.accountName || `账号 #${id}`, points,
      resets: [...resetTimes],
      resetAt: nextResetAt,
      exhaustedAt: validEnd,
      baseline, estimatedBaseline,
      predictionUnavailableReason: used == null ? "暂无当前使用率"
        : !Number.isFinite(currentAt) ? "暂无有效用量时间"
        : !baseline ? "缺少有效重置基点"
        : currentAt <= baseline[0] ? "重置后尚无可计算的时间跨度"
        : rate <= 0 ? "本轮尚无正向消耗，暂无预计耗尽时间"
        : "预计耗尽时间超出可显示范围",
      prediction: validEnd !== null && used != null ? hourlyLine(currentAt, used, validEnd, 100) : [],
      resetPrediction
    };
  });
}
