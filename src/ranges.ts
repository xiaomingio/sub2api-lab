/*
 * 文件说明: 计算仪表盘可选时间范围，把今天、近 7 天、本月等选项转换为查询边界和显示文案。
 */

type RangePreset =
  | "today"
  | "yesterday"
  | "last_24_hours"
  | "sub2api_last_24_hours"
  | "last_7_days"
  | "last_14_days"
  | "last_30_days"
  | "this_month"
  | "last_month"
  | "custom";

type DateRange = {
  preset: RangePreset;
  label: string;
  start: Date;
  end: Date;
  startDate: string;
  endDate: string;
};

const presetLabels: Record<RangePreset, string> = {
  today: "今天",
  yesterday: "昨天",
  last_24_hours: "近 24 小时（当前时刻往前滚动 24 小时）",
  sub2api_last_24_hours: "Sub2API 近 24 小时（昨日 0 点至当前时刻）",
  last_7_days: "近 7 天",
  last_14_days: "近 14 天",
  last_30_days: "近 30 天",
  this_month: "本月",
  last_month: "上月",
  custom: "自定义"
};

function zonedDateParts(date: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day")
  };
}

function formatDateKey(date: Date, timezone: string): string {
  const parts = zonedDateParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function utcFromZonedDate(year: number, month: number, day: number, timezone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(utcGuess);
  const zoneName = offsetParts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = zoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return utcGuess;
  }
  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || "0");
  const offsetMinutes = sign * (hours * 60 + minutes);
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  return {
    year: Math.floor(zeroBased / 12),
    month: (zeroBased % 12) + 1
  };
}

function parseDateInput(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function fromDateKey(dateKey: string, timezone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return utcFromZonedDate(year, month, day, timezone);
}

function formatInclusiveEndDateKey(end: Date, timezone: string): string {
  const endDateKey = formatDateKey(end, timezone);
  const endDayStart = fromDateKey(endDateKey, timezone);
  if (endDayStart.getTime() === end.getTime()) {
    return formatDateKey(addDays(end, -1), timezone);
  }
  return endDateKey;
}

export function resolveDateRange(params: {
  preset?: string;
  startDate?: string;
  endDate?: string;
  timezone: string;
  defaultPreset: string;
}): DateRange {
  const allowed = new Set(Object.keys(presetLabels));
  const preset = (allowed.has(params.preset || "") ? params.preset : params.defaultPreset) as RangePreset;
  const now = new Date();
  const todayParts = zonedDateParts(now, params.timezone);
  const todayStart = utcFromZonedDate(todayParts.year, todayParts.month, todayParts.day, params.timezone);
  const tomorrowStart = addDays(todayStart, 1);

  if (preset === "custom") {
    const fallbackStart = formatDateKey(addDays(todayStart, -6), params.timezone);
    const fallbackEnd = formatDateKey(todayStart, params.timezone);
    const startDate = parseDateInput(params.startDate, fallbackStart);
    const endDate = parseDateInput(params.endDate, fallbackEnd);
    const start = fromDateKey(startDate, params.timezone);
    const end = addDays(fromDateKey(endDate, params.timezone), 1);
    return { preset, label: "自定义", start, end, startDate, endDate };
  }

  let start = addDays(todayStart, -6);
  let end = tomorrowStart;

  if (preset === "today") {
    start = todayStart;
  } else if (preset === "yesterday") {
    start = addDays(todayStart, -1);
    end = todayStart;
  } else if (preset === "last_24_hours") {
    start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    end = now;
  } else if (preset === "sub2api_last_24_hours") {
    start = addDays(todayStart, -1);
    end = now;
  } else if (preset === "last_14_days") {
    start = addDays(todayStart, -13);
  } else if (preset === "last_30_days") {
    start = addDays(todayStart, -29);
  } else if (preset === "this_month") {
    start = utcFromZonedDate(todayParts.year, todayParts.month, 1, params.timezone);
  } else if (preset === "last_month") {
    const previous = addMonths(todayParts.year, todayParts.month, -1);
    start = utcFromZonedDate(previous.year, previous.month, 1, params.timezone);
    end = utcFromZonedDate(todayParts.year, todayParts.month, 1, params.timezone);
  }

  return {
    preset,
    label: presetLabels[preset],
    start,
    end,
    startDate: formatDateKey(start, params.timezone),
    endDate: formatInclusiveEndDateKey(end, params.timezone)
  };
}

export { presetLabels };
export type { DateRange, RangePreset };
