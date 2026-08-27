/*
 * 文件说明: 每小时整点调度额度快照采集，并保证同一时间窗口只执行一次。
 */

import type { Db, LabDb } from "./db.js";
import { recordQuotaSnapshot, withLabJobLock } from "./quota-snapshots.js";

const jobLockKey = 8_327_451;

function localHourParts(date: Date, timezone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function hourKey(date: Date, timezone: string): string { const parts = localHourParts(date, timezone); return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`; }
function isOnTheHour(date: Date, timezone: string): boolean { return localHourParts(date, timezone).minute === "00"; }
function hourBucketStart(date: Date, timezone: string): Date {
  const parts = localHourParts(date, timezone);
  const localExactAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offset = localExactAsUtc - date.getTime();
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour)) - offset);
}

export function createQuotaSnapshotScheduler(params: { sourceDb: Db; labDb: LabDb; timezone: string; log?: (message: string, error?: unknown) => void }) {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let lastHour = "";
  const log = params.log || ((message, error) => console.error(message, error));
  const tick = async () => {
    const now = new Date();
    const key = hourKey(now, params.timezone);
    if (stopped || !isOnTheHour(now, params.timezone) || key === lastHour) return;
    try {
      const result = await withLabJobLock(params.labDb, jobLockKey, () => recordQuotaSnapshot({ sourceDb: params.sourceDb, labDb: params.labDb, sampledAt: hourBucketStart(now, params.timezone) }));
      if (result) {
        lastHour = key;
        log(`Quota snapshot recorded for ${key}: ${result.inserted} accounts`);
      }
    } catch (error) { log(`Quota snapshot failed for ${key}`, error); }
  };
  const start = () => { if (timer) return; timer = setInterval(() => { void tick(); }, 30_000); void tick(); };
  const stop = () => { stopped = true; if (timer) clearInterval(timer); timer = null; };
  return { start, stop, tick };
}

export { hourBucketStart, hourKey, isOnTheHour };
