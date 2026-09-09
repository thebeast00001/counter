import {
  buildIndex,
  churnRead,
  firstNinetyDays,
  partyValue,
  reliability,
  startOfDay,
  startOfMonth,
  type Index,
} from '@/domain/analytics';
import { money } from '@/domain/metrics';
import { plural } from '@/domain/words';
import type { BusinessData, BusinessProfile } from '@/domain/model';
import { formatDateFull, formatDayMonth, formatTime, relativeDays } from '@/lib/time';

/**
 * Why every number is what it is.
 *
 * Nothing in the product asserts a figure it cannot break open. That is not a
 * nice-to-have: an owner who cannot see which fourteen people make up "₹68k
 * outstanding" has no reason to believe the ₹68k, and an unbelieved number
 * changes no behaviour. Every long-press in the app resolves to one of these.
 */

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type Contributor = {
  id: string;
  label: string;
  sub?: string;
  /** Rendered amount or count. */
  value: string;
  numeric: number;
  partyId?: string;
};

export type Comparison = {
  label: string;
  value: string;
  /** Signed fraction against the current value; null when not comparable. */
  delta: number | null;
};

export type Cause = {
  label: string;
  /** Signed contribution to the change, in the metric's own units. */
  amount: number;
  share: number;
};

export type Explanation = {
  key: string;
  title: string;
  value: string;
  /** What this number means, in a sentence an owner would say out loud. */
  definition: string;
  /** How it is worked out, in words rather than notation. */
  formula: string;
  /** Daily series for the sparkline, oldest first. */
  series: number[];
  seriesLabel: string;
  comparisons: Comparison[];
  contributors: Contributor[];
  contributorsLabel: string;
  /** Attribution of the most recent movement. Empty when nothing moved. */
  causes: Cause[];
  /** One line naming what the owner can do about it. */
  soWhat?: string;
  action?: { label: string; href: string };
  /** Set when the number rests on too little history to lean on. */
  caveat?: string;
};

/* ------------------------------------------------------------- helpers -- */

function dailySeries(
  data: BusinessData,
  now: number,
  days: number,
  pick: (data: BusinessData, from: number, to: number) => number,
): number[] {
  const out: number[] = [];
  const today = startOfDay(now);
  for (let i = days - 1; i >= 0; i--) {
    const from = today - i * DAY;
    out.push(pick(data, from, from + DAY));
  }
  return out;
}

const revenueIn = (data: BusinessData, from: number, to: number): number =>
  data.money
    .filter((m) => m.direction === 'in' && m.status === 'settled' && m.at >= from && m.at < to)
    .reduce((s, m) => s + m.amount, 0);

const visitsIn = (data: BusinessData, from: number, to: number): number =>
  data.engagements.filter((e) => e.at >= from && e.at < to && !e.noShow).length;

function pct(current: number, past: number): number | null {
  if (past === 0) return null;
  return (current - past) / past;
}

/* ------------------------------------------------------ metric explainers -- */

function explainRevenue(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
): Explanation {
  const monthStart = startOfMonth(now);
  const value = revenueIn(data, monthStart, now);

  const dayOfMonth = new Date(now).getDate();
  const lastMonthStart = new Date(new Date(now).setMonth(new Date(now).getMonth() - 1, 1)).setHours(0, 0, 0, 0);
  const lastMonthSamePoint = lastMonthStart + dayOfMonth * DAY;
  const lastMonthToDate = revenueIn(data, lastMonthStart, lastMonthSamePoint);
  const lastMonthFull = revenueIn(data, lastMonthStart, monthStart);

  const yearAgoStart = new Date(new Date(now).setFullYear(new Date(now).getFullYear() - 1, new Date(now).getMonth(), 1)).setHours(0, 0, 0, 0);
  const yearAgo = revenueIn(data, yearAgoStart, yearAgoStart + dayOfMonth * DAY);

  // Contributors: who paid, biggest first.
  const byParty = new Map<string, number>();
  for (const m of data.money) {
    if (m.direction !== 'in' || m.status !== 'settled' || m.at < monthStart) continue;
    const key = m.partyId ?? '__walkin';
    byParty.set(key, (byParty.get(key) ?? 0) + m.amount);
  }
  const index = buildIndex(data);
  const contributors: Contributor[] = [...byParty.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([id, amount]) => ({
      id,
      label: id === '__walkin' ? 'Not linked to anyone' : (index.partyById.get(id)?.name ?? 'Unknown'),
      value: money(amount),
      numeric: amount,
      partyId: id === '__walkin' ? undefined : id,
    }));

  // Causes: split the month-on-month change into people and amounts.
  const causes: Cause[] = [];
  const delta = value - lastMonthToDate;
  if (lastMonthToDate > 0 && Math.abs(delta) / lastMonthToDate > 0.05) {
    const payersNow = new Set(
      data.money.filter((m) => m.direction === 'in' && m.status === 'settled' && m.at >= monthStart).map((m) => m.partyId),
    ).size;
    const payersThen = new Set(
      data.money
        .filter((m) => m.direction === 'in' && m.status === 'settled' && m.at >= lastMonthStart && m.at < lastMonthSamePoint)
        .map((m) => m.partyId),
    ).size;

    const avgThen = payersThen > 0 ? lastMonthToDate / payersThen : 0;
    // Decomposition: how much of the change is a headcount change at the old
    // average, and how much is the average itself moving.
    const fromCount = (payersNow - payersThen) * avgThen;
    const fromSize = delta - fromCount;

    if (Math.abs(fromCount) > 1) {
      causes.push({
        label:
          payersNow >= payersThen
            ? `${payersNow - payersThen} more people paid`
            : `${payersThen - payersNow} fewer people paid`,
        amount: fromCount,
        share: Math.abs(fromCount) / Math.abs(delta),
      });
    }
    if (Math.abs(fromSize) > 1) {
      causes.push({
        label: fromSize > 0 ? 'Payments were larger on average' : 'Payments were smaller on average',
        amount: fromSize,
        share: Math.abs(fromSize) / Math.abs(delta),
      });
    }
    causes.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }

  return {
    key: 'revenue',
    title: 'Collected this month',
    value: money(value),
    definition:
      'Money that has actually arrived since the first of the month. Anything invoiced but unpaid is not in here — that is Outstanding.',
    formula: `Every payment marked settled, dated on or after ${formatDayMonth(monthStart)}, added together.`,
    series: dailySeries(data, now, 60, revenueIn),
    seriesLabel: 'Daily takings, last 60 days',
    comparisons: [
      { label: 'Same point last month', value: money(lastMonthToDate), delta: pct(value, lastMonthToDate) },
      { label: 'All of last month', value: money(lastMonthFull), delta: pct(value, lastMonthFull) },
      { label: 'Same month last year', value: yearAgo > 0 ? money(yearAgo) : 'No data', delta: pct(value, yearAgo) },
    ],
    contributors,
    contributorsLabel: 'Who it came from',
    causes,
    soWhat:
      delta < 0 && lastMonthToDate > 0
        ? 'Down on last month. The split above says whether that is fewer people or smaller payments — they need different responses.'
        : undefined,
    action: { label: 'Open the ledger', href: '/(tabs)/money' },
  };
}

function explainOutstanding(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
): Explanation {
  const due = data.money.filter((m) => m.direction === 'in' && m.status === 'due');
  const value = due.reduce((s, m) => s + m.amount, 0);
  const index = buildIndex(data);

  const contributors: Contributor[] = due
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 15)
    .map((m) => {
      const age = Math.floor((now - (m.dueAt ?? m.at)) / DAY);
      const rel = m.partyId ? reliability(index, m.partyId) : null;
      return {
        id: m.id,
        label: m.partyId ? (index.partyById.get(m.partyId)?.name ?? 'Unknown') : m.label,
        sub:
          age > 0
            ? `${age} days overdue${rel?.averageDelayDays ? ` · usually ${Math.round(rel.averageDelayDays)} days late` : ''}`
            : 'Not yet due',
        value: money(m.amount),
        numeric: m.amount,
        partyId: m.partyId ?? undefined,
      };
    });

  const overdue = due.filter((m) => (m.dueAt ?? m.at) < now);
  const overdueTotal = overdue.reduce((s, m) => s + m.amount, 0);

  const causes: Cause[] = [];
  if (value > 0) {
    const over60 = due
      .filter((m) => (now - (m.dueAt ?? m.at)) / DAY > 60)
      .reduce((s, m) => s + m.amount, 0);
    if (over60 > 0) {
      causes.push({ label: 'Older than 60 days', amount: over60, share: over60 / value });
    }
    const top = contributors[0];
    if (top && top.numeric / value > 0.25) {
      causes.push({ label: `${top.label} alone`, amount: top.numeric, share: top.numeric / value });
    }
  }

  return {
    key: 'due',
    title: 'Outstanding',
    value: money(value),
    definition:
      'Work you have already done that has not been paid for. It is your money — it is just sitting with someone else.',
    formula: 'Every incoming entry still marked unpaid, added together, regardless of how old it is.',
    series: dailySeries(data, now, 60, (d, from, to) =>
      d.money
        .filter((m) => m.direction === 'in' && m.status === 'due' && (m.dueAt ?? m.at) < to)
        .reduce((s, m) => s + m.amount, 0),
    ),
    seriesLabel: 'Balance outstanding, last 60 days',
    comparisons: [
      { label: 'Past its due date', value: money(overdueTotal), delta: value > 0 ? overdueTotal / value - 1 : null },
      { label: 'People involved', value: String(new Set(due.map((m) => m.partyId)).size), delta: null },
    ],
    contributors,
    contributorsLabel: 'Who owes it',
    causes,
    soWhat:
      overdueTotal > 0
        ? 'Chasing everyone equally spends the same effort on the largest and the smallest. The list is already in the right order.'
        : undefined,
    action: { label: 'Start collecting', href: '/worklist?kind=collect' },
  };
}

function explainActive(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
): Explanation {
  const active = data.commitments.filter((c) => c.status !== 'cancelled' && c.endAt >= now);
  const index = buildIndex(data);
  const term = profile.vocabulary.commitment.many.toLowerCase();

  const expiring = active.filter((c) => c.endAt <= now + 30 * DAY).sort((a, b) => a.endAt - b.endAt);

  const contributors: Contributor[] = expiring.slice(0, 15).map((c) => {
    const days = Math.ceil((c.endAt - now) / DAY);
    const read = churnRead(data, index, c.partyId, now);
    return {
      id: c.id,
      label: index.partyById.get(c.partyId)?.name ?? 'Unknown',
      sub: `Ends in ${days} day${days === 1 ? '' : 's'}${read.risk > 0.5 ? ' · has gone quiet' : ''}`,
      value: money(c.price),
      numeric: c.price,
      partyId: c.partyId,
    };
  });

  const monthAgo = data.commitments.filter(
    (c) => c.status !== 'cancelled' && c.endAt >= now - 30 * DAY && c.startAt <= now - 30 * DAY,
  ).length;

  return {
    key: 'active',
    title: `Active ${term}`,
    value: String(active.length),
    definition: `${profile.vocabulary.party.many} with a ${profile.vocabulary.commitment.one.toLowerCase()} that has not run out yet.`,
    formula: `Counted as: not cancelled, and the end date has not passed. Someone with two overlapping ${term} counts twice.`,
    series: dailySeries(data, now, 60, (d, from, to) =>
      d.commitments.filter((c) => c.status !== 'cancelled' && c.startAt < to && c.endAt >= from).length,
    ),
    seriesLabel: `Active ${term}, last 60 days`,
    comparisons: [
      { label: 'A month ago', value: String(monthAgo), delta: pct(active.length, monthAgo) },
      { label: 'Ending within 30 days', value: String(expiring.length), delta: null },
      {
        label: 'Value ending within 30 days',
        value: money(expiring.reduce((s, c) => s + c.price, 0)),
        delta: null,
      },
    ],
    contributors,
    contributorsLabel: 'Ending soonest',
    causes: [],
    soWhat:
      expiring.length > 0
        ? `${money(expiring.reduce((s, c) => s + c.price, 0))} of this renews or does not in the next month.`
        : undefined,
    action: { label: `See all ${profile.vocabulary.party.many.toLowerCase()}`, href: '/(tabs)/people' },
  };
}

function explainEngagements(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
): Explanation {
  const dayStart = startOfDay(now);
  const today = visitsIn(data, dayStart, now);
  const index = buildIndex(data);

  const weekday = new Date(now).getDay();
  const sameWeekdays: number[] = [];
  for (let w = 1; w <= 8; w++) {
    const ref = dayStart - w * 7 * DAY;
    sameWeekdays.push(visitsIn(data, ref, ref + DAY));
  }
  const normal = sameWeekdays.length
    ? sameWeekdays.reduce((s, v) => s + v, 0) / sameWeekdays.length
    : 0;

  const todayRecords = data.engagements
    .filter((e) => e.at >= dayStart && !e.noShow)
    .sort((a, b) => b.at - a.at);

  const contributors: Contributor[] = todayRecords.slice(0, 20).map((e) => ({
    id: e.id,
    label: index.partyById.get(e.partyId)?.name ?? 'Unknown',
    sub: formatTime(e.at),
    value: e.value ? money(e.value) : '—',
    numeric: e.value ?? 0,
    partyId: e.partyId,
  }));

  return {
    key: 'today',
    title: `${profile.vocabulary.engagement.many} today`,
    value: String(today),
    definition: `Every ${profile.vocabulary.engagement.one.toLowerCase()} recorded since midnight. No-shows are counted separately and are not in here.`,
    formula: 'Counted from records dated today, excluding anything marked as a no-show.',
    series: dailySeries(data, now, 60, visitsIn),
    seriesLabel: `${profile.vocabulary.engagement.many}, last 60 days`,
    comparisons: [
      {
        label: `A normal ${WEEKDAYS[weekday]}`,
        value: normal > 0 ? normal.toFixed(1) : 'No data',
        delta: pct(today, normal),
      },
      { label: 'Yesterday', value: String(visitsIn(data, dayStart - DAY, dayStart)), delta: null },
      { label: 'This week so far', value: String(visitsIn(data, dayStart - 6 * DAY, now)), delta: null },
    ],
    contributors,
    contributorsLabel: 'Who came in',
    causes: [],
    caveat: sameWeekdays.filter((v) => v > 0).length < 3
      ? `Only ${sameWeekdays.filter((v) => v > 0).length} past ${WEEKDAYS[weekday]}s to compare against, so the comparison is weak.`
      : undefined,
    action: { label: 'Record another', href: '/capture' },
  };
}

function explainParties(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
): Explanation {
  const index = buildIndex(data);
  const term = profile.vocabulary.party.many.toLowerCase();
  const live = data.parties.filter((p) => !p.archivedAt);

  const newThisMonth = live.filter((p) => p.joinedAt >= startOfMonth(now)).length;
  const quietDays = profile.shape.engagementFreq === 'high' ? 21 : 45;
  const quiet = live.filter((p) => {
    const seen = index.lastSeen.get(p.id);
    return seen === undefined ? p.joinedAt < now - quietDays * DAY : seen < now - quietDays * DAY;
  });

  const contributors: Contributor[] = live
    .map((p) => ({ p, v: partyValue(index, p.id, now) }))
    .sort((a, b) => b.v.lifetime - a.v.lifetime)
    .slice(0, 12)
    .map(({ p, v }) => ({
      id: p.id,
      label: p.name,
      sub: `${Math.round(v.months)} month${Math.round(v.months) === 1 ? '' : 's'} · ${(index.engagementsByParty.get(p.id) ?? []).length} ${plural((index.engagementsByParty.get(p.id) ?? []).length, profile.vocabulary.engagement).toLowerCase()}`,
      value: money(v.lifetime),
      numeric: v.lifetime,
      partyId: p.id,
    }));

  return {
    key: 'parties',
    title: profile.vocabulary.party.many,
    value: String(live.length),
    definition: `Everyone on the books who has not been archived. It is not the same as everyone who is active — ${quiet.length} of them have gone quiet.`,
    formula: 'A straight count of records, minus anyone archived.',
    series: dailySeries(data, now, 90, (d, from, to) => d.parties.filter((p) => p.joinedAt < to).length),
    seriesLabel: `${profile.vocabulary.party.many} on the books, last 90 days`,
    comparisons: [
      { label: 'Joined this month', value: String(newThisMonth), delta: null },
      { label: 'Gone quiet', value: String(quiet.length), delta: null },
      {
        label: 'Coming regularly',
        value: String(live.length - quiet.length),
        delta: null,
      },
    ],
    contributors,
    contributorsLabel: 'Most valuable, all time',
    causes: [],
    soWhat:
      quiet.length > live.length * 0.2
        ? `More than a fifth of your ${term} have gone quiet. The headline count is flattering the real position.`
        : undefined,
    action: { label: `Open ${profile.vocabulary.party.many.toLowerCase()}`, href: '/(tabs)/people' },
  };
}

function explainExpiring(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
): Explanation {
  const index = buildIndex(data);

  const expiring = data.commitments
    .filter((c) => c.status !== 'cancelled' && c.endAt >= now && c.endAt <= now + 7 * DAY)
    .sort((a, b) => a.endAt - b.endAt);
  const value = expiring.reduce((s, c) => s + c.price, 0);

  const quiet = expiring.filter((c) => churnRead(data, index, c.partyId, now).risk > 0.45);

  return {
    key: 'expiring',
    title: 'Expiring in 7 days',
    value: String(expiring.length),
    definition: `${profile.vocabulary.commitment.many} that run out within the week. Each one is a decision being made right now about whether to carry on, whether or not you take part in it.`,
    formula: `Counted as: not cancelled, end date is after today and within seven days. Anything that has already lapsed is not in here — that has been decided.`,
    series: dailySeries(data, now, 60, (d, from, to) =>
      d.commitments.filter(
        (c) => c.status !== 'cancelled' && c.endAt >= from && c.endAt < to + 7 * DAY,
      ).length,
    ),
    seriesLabel: 'Rolling seven-day expiries, last 60 days',
    comparisons: [
      { label: 'Value at stake', value: money(value), delta: null },
      { label: 'Of those, gone quiet', value: String(quiet.length), delta: null },
      {
        label: 'Expiring within 30 days',
        value: String(
          data.commitments.filter(
            (c) => c.status !== 'cancelled' && c.endAt >= now && c.endAt <= now + 30 * DAY,
          ).length,
        ),
        delta: null,
      },
    ],
    contributors: expiring.map((c) => {
      const days = Math.max(0, Math.ceil((c.endAt - now) / DAY));
      const read = churnRead(data, index, c.partyId, now);
      return {
        id: c.id,
        label: index.partyById.get(c.partyId)?.name ?? 'Unknown',
        sub: `${days === 0 ? 'Ends today' : `${days} day${days === 1 ? '' : 's'} left`}${read.risk > 0.45 ? ' · has gone quiet' : ''}`,
        value: money(c.price),
        numeric: c.price,
        partyId: c.partyId,
      };
    }),
    contributorsLabel: 'Ending soonest',
    causes: [],
    soWhat:
      quiet.length > 0
        ? `${quiet.length} of them have already stopped turning up. Those are the ones that do not renew by themselves.`
        : undefined,
    action:
      expiring.length > 0
        ? { label: 'Work through them', href: '/segments?id=expiring' }
        : undefined,
  };
}

function explainNew(profile: BusinessProfile, data: BusinessData, now: number): Explanation {
  const index = buildIndex(data);
  const term = profile.vocabulary.party.many.toLowerCase();

  const joined = data.parties
    .filter((p) => p.joinedAt >= now - 7 * DAY)
    .sort((a, b) => b.joinedAt - a.joinedAt);

  const reads = firstNinetyDays(data, index, now);
  const stalled = reads.filter((r) => r.daysIn >= 10 && !r.onTrack && r.benchmark > 0);

  const prevWeek = data.parties.filter(
    (p) => p.joinedAt >= now - 14 * DAY && p.joinedAt < now - 7 * DAY,
  ).length;

  return {
    key: 'new',
    title: `New ${term} this week`,
    value: String(joined.length),
    definition: `Anyone who joined in the last seven days. What happens to them over the next few weeks decides whether they are still here in a year.`,
    formula: 'Counted from the joining date on each record, within the last seven days.',
    series: dailySeries(data, now, 60, (d, from, to) =>
      d.parties.filter((p) => p.joinedAt >= from && p.joinedAt < to).length,
    ),
    seriesLabel: `New ${term} per day, last 60 days`,
    comparisons: [
      { label: 'The week before', value: String(prevWeek), delta: pct(joined.length, prevWeek) },
      { label: 'Joined in the last 30 days', value: String(reads.filter((r) => r.daysIn <= 30).length), delta: null },
      { label: 'Behind where they should be', value: String(stalled.length), delta: null },
    ],
    contributors: joined.map((p) => ({
      id: p.id,
      label: p.name,
      sub: `Joined ${relativeDays(p.joinedAt, now).toLowerCase()}${p.referredBy ? ` · referred by ${index.partyById.get(p.referredBy)?.name ?? 'someone'}` : ''}`,
      value: String((index.engagementsByParty.get(p.id) ?? []).length),
      numeric: (index.engagementsByParty.get(p.id) ?? []).length,
      partyId: p.id,
    })),
    contributorsLabel: `Who joined · ${profile.vocabulary.engagement.many.toLowerCase()} so far`,
    causes: [],
    soWhat:
      stalled.length > 0
        ? `${stalled.length} recent joiner${stalled.length === 1 ? ' is' : 's are'} behind where people who stayed had got to by the same point.`
        : undefined,
    action: { label: `See all ${term}`, href: '/(tabs)/people' },
  };
}

/* --------------------------------------------------------------- routing -- */

/**
 * Resolves a metric key to its explanation.
 *
 * Metrics are chosen by shape upstream, so this only ever sees keys that exist
 * for this business. The fallback is deliberately honest rather than a generic
 * blurb: an explanation nobody wrote is worse than an admission that nobody
 * wrote one.
 */
export function explainMetric(
  key: string,
  profile: BusinessProfile,
  data: BusinessData,
  now = Date.now(),
): Explanation {
  switch (key) {
    case 'revenue':
      return explainRevenue(profile, data, now);
    case 'due':
      return explainOutstanding(profile, data, now);
    case 'active':
      return explainActive(profile, data, now);
    // Expiring and new joiners used to fall through to the explanations for the
    // totals they sit beside, so long-pressing "10 expiring" opened a sheet
    // headed "53 active". A deep dive that answers a different question than the
    // one that was pressed is worse than no deep dive.
    case 'expiring':
      return explainExpiring(profile, data, now);
    case 'today':
    case 'week':
      return explainEngagements(profile, data, now);
    case 'parties':
      return explainParties(profile, data, now);
    case 'new':
      return explainNew(profile, data, now);
    default:
      return {
        key,
        title: key,
        value: '—',
        definition: 'This number does not have a written explanation yet.',
        formula: 'Not documented.',
        series: [],
        seriesLabel: '',
        comparisons: [],
        contributors: [],
        contributorsLabel: '',
        causes: [],
      };
  }
}

/* ------------------------------------------------------- person explainer -- */

export type PersonRead = {
  name: string;
  joinedLabel: string;
  visits: number;
  lifetime: string;
  runRate: string;
  outstanding: string;
  reliabilityLabel: string;
  reliabilityScore: number | null;
  churn: ReturnType<typeof churnRead>;
  typicalGapLabel: string;
  lastSeenLabel: string;
  timeline: { id: string; at: number; kind: 'visit' | 'payment' | 'due' | 'joined' | 'commitment'; label: string; value?: string }[];
  /** Daily visit series for the sparkline. */
  series: number[];
};

/** Everything known about one person, assembled for the deep sheet. */
export function explainParty(
  profile: BusinessProfile,
  data: BusinessData,
  partyId: string,
  now = Date.now(),
  index?: Index,
): PersonRead | null {
  const idx = index ?? buildIndex(data);
  const party = idx.partyById.get(partyId);
  if (!party) return null;

  const visits = idx.engagementsByParty.get(partyId) ?? [];
  const value = partyValue(idx, partyId, now);
  const rel = reliability(idx, partyId);
  const churn = churnRead(data, idx, partyId, now);
  const seen = idx.lastSeen.get(partyId) ?? null;

  const timeline: PersonRead['timeline'] = [];
  timeline.push({
    id: `join-${party.id}`,
    at: party.joinedAt,
    kind: 'joined',
    label: `Joined`,
  });
  for (const at of visits) {
    timeline.push({
      id: `v-${at}`,
      at,
      kind: 'visit',
      label: profile.vocabulary.engagement.one,
    });
  }
  for (const m of idx.moneyByParty.get(partyId) ?? []) {
    timeline.push({
      id: m.id,
      at: m.at,
      kind: m.status === 'due' ? 'due' : 'payment',
      label: m.label,
      value: money(m.amount),
    });
  }
  for (const c of data.commitments.filter((c) => c.partyId === partyId)) {
    timeline.push({
      id: c.id,
      at: c.startAt,
      kind: 'commitment',
      label: `${profile.vocabulary.commitment.one} started`,
      value: money(c.price),
    });
  }
  timeline.sort((a, b) => b.at - a.at);

  const series: number[] = [];
  const today = startOfDay(now);
  for (let i = 89; i >= 0; i--) {
    const from = today - i * DAY;
    series.push(visits.filter((at) => at >= from && at < from + DAY).length);
  }

  return {
    name: party.name,
    joinedLabel: formatDateFull(party.joinedAt),
    visits: visits.length,
    lifetime: money(value.lifetime),
    runRate: value.runRate > 0 ? `${money(value.runRate)}/year` : '—',
    outstanding: value.outstanding > 0 ? money(value.outstanding) : 'Nothing',
    reliabilityLabel:
      rel.score === null
        ? 'Not enough history'
        : rel.score > 0.85
          ? 'Pays on time'
          : rel.score > 0.5
            ? `Usually ${Math.round(rel.averageDelayDays ?? 0)} days late`
            : `Often late — around ${Math.round(rel.averageDelayDays ?? 0)} days`,
    reliabilityScore: rel.score,
    churn,
    typicalGapLabel:
      churn.typicalGap === null
        ? 'No pattern yet'
        : `About every ${Math.round(churn.typicalGap)} day${Math.round(churn.typicalGap) === 1 ? '' : 's'}`,
    // Shared helper rather than open-coded arithmetic. The local version had no
    // floor at zero, so a visit recorded a second after the screen last read the
    // clock rendered as "-1 days ago".
    lastSeenLabel: relativeDays(seen, now, 'Never been in'),
    timeline: timeline.slice(0, 60),
    series,
  };
}
