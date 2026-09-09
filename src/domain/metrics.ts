import { plural } from '@/domain/words';
import type { BusinessData, BusinessProfile } from '@/domain/model';

const DAY = 24 * 60 * 60 * 1000;

/** A number worth putting on the home screen. */
export type Metric = {
  key: string;
  label: string;
  value: string;
  /** One line under the number, when the number alone is not enough. */
  sub?: string;
  tone?: 'neutral' | 'good' | 'warn';
};

export function money(n: number): string {
  const rounded = Math.round(n);
  // Compact on the magnitude, not the signed value. Comparing a negative against
  // the thresholds means it never reaches them, so every loss printed long-form:
  // "₹-6624" beside "₹66k". The sign goes outside the symbol, as it is written.
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${sign}₹${abs}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth(ts: number): number {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ------------------------------------------------------------ primitives -- */

export function activeCommitments(data: BusinessData, now: number) {
  return data.commitments.filter((c) => c.status !== 'cancelled' && c.endAt >= now);
}

export function expiringWithin(data: BusinessData, now: number, days: number) {
  const limit = now + days * DAY;
  return activeCommitments(data, now)
    .filter((c) => c.endAt <= limit)
    .sort((a, b) => a.endAt - b.endAt);
}

export function engagementsBetween(data: BusinessData, from: number, to: number) {
  return data.engagements.filter((e) => e.at >= from && e.at < to);
}

export function revenueBetween(data: BusinessData, from: number, to: number): number {
  return data.money
    .filter((m) => m.direction === 'in' && m.status === 'settled' && m.at >= from && m.at < to)
    .reduce((sum, m) => sum + m.amount, 0);
}

export function outstanding(data: BusinessData): number {
  return data.money
    .filter((m) => m.direction === 'in' && m.status === 'due')
    .reduce((sum, m) => sum + m.amount, 0);
}

/** Parties with no engagement in the window — the quiet leavers. */
export function lapsedParties(data: BusinessData, now: number, quietDays: number) {
  const cutoff = now - quietDays * DAY;
  const lastSeen = new Map<string, number>();
  for (const e of data.engagements) {
    const prev = lastSeen.get(e.partyId) ?? 0;
    if (e.at > prev) lastSeen.set(e.partyId, e.at);
  }
  return data.parties.filter((p) => {
    const seen = lastSeen.get(p.id);
    // Never seen counts only if they joined long enough ago to have shown up.
    if (seen === undefined) return p.joinedAt < cutoff;
    return seen < cutoff;
  });
}

export function lastSeenAt(data: BusinessData, partyId: string): number | null {
  let latest: number | null = null;
  for (const e of data.engagements) {
    if (e.partyId === partyId && (latest === null || e.at > latest)) latest = e.at;
  }
  return latest;
}

/* --------------------------------------------------------------- summary -- */

/**
 * The four or five numbers that lead the home screen.
 *
 * Chosen by business shape, never by trade. A café is not shown expiring
 * commitments because it has none; a gym is not shown receivables because it is
 * paid in advance. The metric is not hidden behind a setting — it is never
 * generated.
 */
export function headlineMetrics(
  profile: BusinessProfile,
  data: BusinessData,
  now = Date.now(),
): Metric[] {
  const { shape, vocabulary } = profile;
  const out: Metric[] = [];

  const todayStart = startOfDay(now);
  const monthStart = startOfMonth(now);

  /*
    Windows close at the end of the period, not at `now`.

    Screens read the clock through `useTick`, which advances once a minute, so
    the home screen's `now` can be up to a minute behind the timestamp a record
    was just written with — the capture screen has its own tick. Ending a window
    at `now` therefore excluded a visit recorded seconds ago, and the home screen
    showed "0 visits today" directly above a ring reading "1 visit written down
    today". Two counters of the same thing, disagreeing, because one of them was
    bounded by a stale clock and the other was not.

    A record dated slightly ahead of a stale tick is not in the future; it is
    now. Counting to the end of the period is both what the labels say — "today",
    "this month" — and immune to which screen last read the clock.
  */
  const todayEnd = todayStart + DAY;
  const monthEnd = startOfMonth(now + 32 * DAY);

  if (shape.commitmentWeight > 0.4) {
    const active = activeCommitments(data, now);
    const expiring = expiringWithin(data, now, 7);
    out.push({
      key: 'active',
      label: `Active ${vocabulary.commitment.many.toLowerCase()}`,
      value: String(active.length),
    });
    if (expiring.length > 0) {
      out.push({
        key: 'expiring',
        label: 'Expiring in 7 days',
        value: String(expiring.length),
        tone: 'warn',
      });
    }
  } else {
    out.push({
      key: 'parties',
      label: plural(data.parties.length, vocabulary.party),
      value: String(data.parties.length),
    });
  }

  if (shape.engagementFreq !== 'low') {
    const today = engagementsBetween(data, todayStart, todayEnd);
    out.push({
      key: 'today',
      label: `${plural(today.length, vocabulary.engagement)} today`,
      value: String(today.length),
    });
  } else {
    const week = engagementsBetween(data, now - 7 * DAY, todayEnd);
    out.push({
      key: 'week',
      label: `${vocabulary.engagement.many} this week`,
      value: String(week.length),
    });
  }

  out.push({
    key: 'revenue',
    label: 'Collected this month',
    value: money(revenueBetween(data, monthStart, monthEnd)),
  });

  if (shape.paymentTiming === 'after') {
    const due = outstanding(data);
    if (due > 0) {
      out.push({ key: 'due', label: 'Outstanding', value: money(due), tone: 'warn' });
    }
  }

  const joinedThisWeek = data.parties.filter((p) => p.joinedAt >= now - 7 * DAY).length;
  if (joinedThisWeek > 0) {
    out.push({
      key: 'new',
      label: `New ${vocabulary.party.many.toLowerCase()} this week`,
      value: String(joinedThisWeek),
      tone: 'good',
    });
  }

  // Five is the ceiling. A sixth number is one nobody reads.
  return out.slice(0, 5);
}
