import { startOfDay } from '@/domain/analytics';
import type { BusinessData, BusinessProfile, Template } from '@/domain/model';

/**
 * Templates turned into dated occurrences.
 *
 * A template is a rule — "Batch A, Mon/Wed/Fri, 17:30". A calendar needs
 * instances. Rather than materialising rows into storage, occurrences are
 * derived on demand: a recurring schedule that changes should change history
 * going forward and leave what actually happened alone, and the only way to keep
 * both true is to generate the future and read the past from real records.
 */

const DAY = 24 * 60 * 60 * 1000;

export type Occurrence = {
  id: string;
  templateId: string;
  name: string;
  /** Local start time. */
  at: number;
  durationMin: number;
  partyIds: string[];
  staffId?: string | null;
  /** True once records exist for this template on this day. */
  recorded: boolean;
  attended: number;
  /** Set when the business declared itself shut that day. */
  closed?: string;
};

export const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
export const WEEKDAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** `17:30` from minutes past midnight, for editing rather than display. */
export function minutesToClock(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function clockToMinutes(clock: string): number | null {
  const match = clock.trim().match(/^(\d{1,2})[:. ]?(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** How the schedule reads in one line: `Mon, Wed, Fri · 5:30pm`. */
export function describeTemplate(template: Template): string {
  if (template.weekdays.length === 0) return 'No days set';
  const days =
    template.weekdays.length === 7
      ? 'Every day'
      : template.weekdays.length === 5 && [1, 2, 3, 4, 5].every((d) => template.weekdays.includes(d))
        ? 'Weekdays'
        : template.weekdays
            .slice()
            .sort()
            .map((d) => WEEKDAY_LONG[d].slice(0, 3))
            .join(', ');

  const h = Math.floor(template.minuteOfDay / 60);
  const m = template.minuteOfDay % 60;
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  const time = m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`;

  return `${days} · ${time}`;
}

/**
 * Every occurrence between two dates.
 *
 * `recorded` is resolved against real engagements rather than assumed, because
 * the whole point of a schedule screen is showing which sessions have been
 * captured and which have quietly gone unrecorded.
 */
export function occurrencesBetween(
  data: BusinessData,
  from: number,
  to: number,
): Occurrence[] {
  const out: Occurrence[] = [];
  const closures = new Map(data.closures.map((c) => [startOfDay(c.date), c.label]));

  // One pass over engagements, bucketed by template and day, so the lookup below
  // does not rescan the whole history for every occurrence.
  const recorded = new Map<string, { total: number; attended: number }>();
  for (const e of data.engagements) {
    if (!e.templateId) continue;
    const key = `${e.templateId}:${startOfDay(e.at)}`;
    const entry = recorded.get(key) ?? { total: 0, attended: 0 };
    entry.total += 1;
    if (!e.noShow) entry.attended += 1;
    recorded.set(key, entry);
  }

  for (let day = startOfDay(from); day <= to; day += DAY) {
    const weekday = new Date(day).getDay();
    const closed = closures.get(day);

    for (const template of data.templates) {
      if (!template.active || !template.weekdays.includes(weekday)) continue;
      const key = `${template.id}:${day}`;
      const hit = recorded.get(key);

      out.push({
        id: key,
        templateId: template.id,
        name: template.name,
        at: day + template.minuteOfDay * 60 * 1000,
        durationMin: template.durationMin ?? 60,
        partyIds: template.partyIds,
        staffId: template.staffId,
        recorded: Boolean(hit),
        attended: hit?.attended ?? 0,
        closed,
      });
    }
  }

  return out.sort((a, b) => a.at - b.at);
}

/** Which days in a range have anything scheduled. Drives the calendar dots. */
export function scheduledDays(data: BusinessData, from: number, to: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const occurrence of occurrencesBetween(data, from, to)) {
    const day = startOfDay(occurrence.at);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

/**
 * Sessions that ran and were never recorded.
 *
 * The most useful thing a schedule screen can surface: not what is coming, but
 * what already happened and left no trace. Yesterday and earlier only — today's
 * evening class is not missing, it just has not happened yet.
 */
export function unrecorded(data: BusinessData, now: number, days = 14): Occurrence[] {
  return occurrencesBetween(data, now - days * DAY, startOfDay(now) - 1).filter(
    (o) => !o.recorded && !o.closed,
  );
}

export function nextOccurrence(data: BusinessData, now: number): Occurrence | null {
  const upcoming = occurrencesBetween(data, now, now + 8 * DAY).filter(
    (o) => o.at + o.durationMin * 60 * 1000 > now && !o.closed,
  );
  return upcoming[0] ?? null;
}

/**
 * Two sessions in the same place at the same time.
 *
 * Only a conflict when both are pinned to the same resource — a business with
 * one room genuinely cannot run two batches at once, but a tutor with two
 * teachers and two rooms can, and flagging that would be noise.
 */
export type Clash = { a: Template; b: Template; weekday: number };

export function clashes(data: BusinessData): Clash[] {
  const out: Clash[] = [];
  const active = data.templates.filter((t) => t.active);

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];

      const sameResource = a.resourceId && b.resourceId && a.resourceId === b.resourceId;
      const sameStaff = a.staffId && b.staffId && a.staffId === b.staffId;
      if (!sameResource && !sameStaff) continue;

      const aEnd = a.minuteOfDay + (a.durationMin ?? 60);
      const bEnd = b.minuteOfDay + (b.durationMin ?? 60);
      const overlaps = a.minuteOfDay < bEnd && b.minuteOfDay < aEnd;
      if (!overlaps) continue;

      const shared = a.weekdays.find((d) => b.weekdays.includes(d));
      if (shared === undefined) continue;

      out.push({ a, b, weekday: shared });
    }
  }

  return out;
}

/**
 * Whether people arrive here in *groups*, on a repeating timetable.
 *
 * This is the question that decides how a visit gets recorded, and frequency
 * alone answers it wrongly. The first version asked only whether customers come
 * often, which correctly excluded a garage and then handed a salon an attendance
 * grid — asking a hairdresser to tick off a class of fourteen when clients
 * arrive one at a time.
 *
 * The real discriminator is a group commitment: a tuition batch and a gym class
 * are many people booked into the same slot, so ticking a roster is the fastest
 * possible capture. A salon, a garage and a café serve one customer at a time,
 * and for them the useful question is not "who came" but "what was it, and did
 * they pay".
 *
 * An owner who has set up a timetable anyway keeps it — a declared schedule
 * outranks anything inferred from the shape.
 */
export function usesSchedule(profile: BusinessProfile, data?: BusinessData): boolean {
  if (data?.templates.some((t) => t.active)) return true;
  return profile.shape.engagementFreq === 'high' && profile.shape.commitmentWeight > 0.4;
}

/* ------------------------------------------------------------- calendar -- */

export type CalendarCell = {
  date: number;
  inMonth: boolean;
  isToday: boolean;
  count: number;
  closed?: string;
};

/**
 * Six weeks of cells covering the given month.
 *
 * Always six rows, so the grid does not change height between months — a
 * calendar that resizes as you page through it makes everything below it jump.
 */
export function monthGrid(data: BusinessData, monthOf: number, now: number): CalendarCell[] {
  const anchor = new Date(monthOf);
  const month = anchor.getMonth();
  const first = new Date(anchor.getFullYear(), month, 1);
  const start = startOfDay(first.getTime() - first.getDay() * DAY);
  const end = start + 42 * DAY;

  const counts = scheduledDays(data, start, end);
  const closures = new Map(data.closures.map((c) => [startOfDay(c.date), c.label]));
  const today = startOfDay(now);

  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    // Rebuilt from parts rather than added as milliseconds: adding 24h across a
    // daylight-saving boundary lands at 23:00 the previous day and shifts every
    // remaining cell by one.
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const date = startOfDay(d.getTime());
    cells.push({
      date,
      inMonth: d.getMonth() === month,
      isToday: date === today,
      count: counts.get(date) ?? 0,
      closed: closures.get(date),
    });
  }
  return cells;
}
