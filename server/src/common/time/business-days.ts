/**
 * Business-day calendar on America/Bogotá time (UTC−5, no daylight saving).
 * Dates are handled as 'YYYY-MM-DD' keys of the Bogotá calendar.
 */
export type DateKey = string;

const OFFSET_MS = -5 * 3_600_000;
const DAY_MS = 86_400_000;

const keyToUtcMidnight = (key: DateKey): number =>
  Date.parse(`${key}T00:00:00.000Z`);
const nextKey = (key: DateKey): DateKey =>
  new Date(keyToUtcMidnight(key) + DAY_MS).toISOString().slice(0, 10);

export function localDateKey(date: Date): DateKey {
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function isBusinessDay(
  key: DateKey,
  holidays: ReadonlySet<string>,
): boolean {
  const weekday = new Date(keyToUtcMidnight(key)).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.has(key);
}

/** 23:59:59.999 Bogotá of the given local date. */
export function endOfLocalDay(key: DateKey): Date {
  return new Date(keyToUtcMidnight(key) + DAY_MS - 1 - OFFSET_MS);
}

/** End of the n-th business day after `from`'s local date (the start day itself never counts). */
export function addBusinessDays(
  from: Date,
  n: number,
  holidays: ReadonlySet<string>,
): Date {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError('n must be a non-negative integer');
  let key = localDateKey(from);
  let counted = 0;
  while (counted < n) {
    key = nextKey(key);
    if (isBusinessDay(key, holidays)) counted++;
  }
  return endOfLocalDay(key);
}

/** Business days in (today, deadline day]; 0 on the deadline day and after it. */
export function businessDaysRemaining(
  now: Date,
  deadline: Date,
  holidays: ReadonlySet<string>,
): number {
  if (deadline.getTime() < now.getTime()) return 0;
  const end = localDateKey(deadline);
  let key = localDateKey(now);
  let count = 0;
  while (key < end) {
    key = nextKey(key);
    if (isBusinessDay(key, holidays)) count++;
  }
  return count;
}

/** Business days elapsed in (from's local day, to's local day]; 0 when `to` is not after `from`. */
export function businessDaysBetween(
  from: Date,
  to: Date,
  holidays: ReadonlySet<string>,
): number {
  return businessDaysRemaining(from, to, holidays);
}

export function calendarDaysBetween(from: Date, to: Date): number {
  const diff =
    keyToUtcMidnight(localDateKey(to)) - keyToUtcMidnight(localDateKey(from));
  return Math.max(0, Math.round(diff / DAY_MS));
}
