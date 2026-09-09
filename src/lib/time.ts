import { useEffect, useState } from 'react';

/**
 * The current time, as state.
 *
 * Reading `Date.now()` during render is an impure read, and with the React
 * Compiler on it can be memoised — which is how a clock silently freezes. Every
 * screen that shows a relative time threads the value in from here instead.
 *
 * The interval is aligned to the next whole period so a per-minute tick lands on
 * the minute rather than at whatever second the screen happened to mount.
 */
export function useTick(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const align = everyMs - (Date.now() % everyMs);

    const timeout = setTimeout(() => {
      setNow(Date.now());
      interval = setInterval(() => setNow(Date.now()), everyMs);
    }, align);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [everyMs]);

  return now;
}

/** `24:31`, or `1:04:12` once past an hour. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** `2h 15m`, `45m`, `0m`. Compact form for metrics and chart labels. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/** Single-letter weekday for chart axes, e.g. `M`. */
export function weekdayLetter(ts: number): string {
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(ts).getDay()];
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * `Monday, 24 August`.
 *
 * Formatted by hand rather than via toLocaleDateString: Intl data varies by
 * Hermes build and Android version, and a header that silently renders a
 * different format on the demo device is not worth the convenience.
 */
export function formatDateLong(ts: number = Date.now()): string {
  const d = new Date(ts);
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

export function shortDay(ts: number): string {
  return DAY_NAMES[new Date(ts).getDay()].slice(0, 3);
}

export function dayName(ts: number): string {
  return DAY_NAMES[new Date(ts).getDay()];
}

/** `24 Aug`. */
export function formatDateShort(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
}

/** `Mon 24 Aug`. */
export function formatDateMedium(ts: number): string {
  const d = new Date(ts);
  return `${DAY_NAMES[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
}

/** `24 August 2025`. */
export function formatDateFull(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** `24 August`. */
export function formatDayMonth(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

/** `August 2025`. */
export function formatMonthYear(ts: number): string {
  const d = new Date(ts);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export function monthName(index: number): string {
  return MONTH_NAMES[((index % 12) + 12) % 12];
}

/** `5:30pm`, `9am`. */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

/**
 * `3 days ago`, `Today`, `6 weeks ago`.
 *
 * Timestamps in the future collapse to "Today" rather than going negative. They
 * happen constantly and legitimately: screens read the clock once a minute and
 * hold it, so anything recorded in the seconds after that read is a moment ahead
 * of the screen's own idea of now, and a freshly recorded visit printed itself as
 * "-1 days ago".
 */
export function relativeDays(ts: number | null, now: number, neverLabel = 'Never'): string {
  if (ts === null) return neverLabel;
  const days = Math.floor((now - ts) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Winding down';
}
