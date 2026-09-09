import {
  FIXED_EXPENSES,
  type BusinessData,
  type BusinessProfile,
  type Commitment,
  type MoneyEntry,
  type Party,
} from '@/domain/model';

/**
 * Everything derived rather than recorded.
 *
 * Two rules hold this file together. First, nothing here reads the archetype —
 * a churn date for a gym and for a garage come out of the same function with
 * different intervals, because the interval is measured from the business's own
 * history rather than assumed from its trade. Second, every function returns the
 * evidence alongside the answer, because a number an owner cannot interrogate is
 * a number they will not act on.
 */

const DAY = 24 * 60 * 60 * 1000;

export const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const startOfMonth = (ts: number): number => {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const monthKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/* ------------------------------------------------------------- indexing -- */

/**
 * One pass over the records, reused by everything below.
 *
 * Built because the naive version was O(parties × engagements): with 90 parties
 * and 1,200 engagements the roster screen was doing 108,000 comparisons on every
 * keystroke of the search field.
 */
export type Index = {
  engagementsByParty: Map<string, number[]>;
  moneyByParty: Map<string, MoneyEntry[]>;
  commitmentsByParty: Map<string, Commitment[]>;
  partyById: Map<string, Party>;
  lastSeen: Map<string, number>;
  firstSeen: Map<string, number>;
  /**
   * Median gap between visits, per person, computed once.
   *
   * The single most-requested number in the app — churn, lapse detection and the
   * roster all need it — and the most expensive, because it sorts each person's
   * gaps. Computing it inside `churnRead` meant re-sorting ninety arrays every
   * time a filter changed.
   */
  typicalGap: Map<string, number>;
};

export function buildIndex(data: BusinessData): Index {
  const engagementsByParty = new Map<string, number[]>();
  const moneyByParty = new Map<string, MoneyEntry[]>();
  const commitmentsByParty = new Map<string, Commitment[]>();
  const partyById = new Map<string, Party>();
  const lastSeen = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  const typicalGap = new Map<string, number>();

  for (const p of data.parties) partyById.set(p.id, p);

  for (const e of data.engagements) {
    if (e.noShow) continue;
    const list = engagementsByParty.get(e.partyId);
    if (list) list.push(e.at);
    else engagementsByParty.set(e.partyId, [e.at]);

    const last = lastSeen.get(e.partyId);
    if (last === undefined || e.at > last) lastSeen.set(e.partyId, e.at);
    const first = firstSeen.get(e.partyId);
    if (first === undefined || e.at < first) firstSeen.set(e.partyId, e.at);
  }

  // Sorted once, then the gap median falls out of the same pass — both are
  // needed by everything downstream and neither changes until the records do.
  for (const [partyId, list] of engagementsByParty) {
    list.sort((a, b) => a - b);
    if (list.length < 3) continue;

    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) gaps.push((list[i] - list[i - 1]) / DAY);
    gaps.sort((a, b) => a - b);

    const mid = Math.floor(gaps.length / 2);
    const median = gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
    typicalGap.set(partyId, Math.max(median, 0.5));
  }

  for (const m of data.money) {
    if (!m.partyId) continue;
    const list = moneyByParty.get(m.partyId);
    if (list) list.push(m);
    else moneyByParty.set(m.partyId, [m]);
  }

  // Without this, `churnRead` scanned every commitment for every person — ninety
  // people against ninety commitments is eight thousand comparisons each time a
  // filter changed, which is exactly where the roster's lag was coming from.
  for (const c of data.commitments) {
    const list = commitmentsByParty.get(c.partyId);
    if (list) list.push(c);
    else commitmentsByParty.set(c.partyId, [c]);
  }

  return {
    engagementsByParty,
    moneyByParty,
    commitmentsByParty,
    partyById,
    lastSeen,
    firstSeen,
    typicalGap,
  };
}

/* --------------------------------------------------------------- rhythm -- */

/**
 * How often this person normally comes, in days.
 *
 * The median gap, not the mean: one six-week holiday would drag a mean far
 * enough to make a weekly regular look monthly, and the whole churn model rests
 * on this number being the person's actual habit.
 */
export function typicalGapDays(index: Index, partyId: string): number | null {
  // Precomputed during indexing; this is now a lookup rather than a sort.
  return index.typicalGap.get(partyId) ?? null;
}

/** The business's own definition of "gone quiet", learned rather than assumed. */
export function quietThresholdDays(profile: BusinessProfile, data: BusinessData, index: Index): number {
  const gaps: number[] = [];
  for (const p of data.parties) {
    const gap = typicalGapDays(index, p.id);
    if (gap !== null) gaps.push(gap);
  }

  if (gaps.length < 5) {
    // Not enough history to learn from, so fall back to the shape.
    return profile.shape.engagementFreq === 'high'
      ? 21
      : profile.shape.engagementFreq === 'medium'
        ? 45
        : 90;
  }

  gaps.sort((a, b) => a - b);
  // The 75th percentile of normal gaps: past this, a person is behaving unlike
  // three quarters of the people who are still coming.
  const p75 = gaps[Math.floor(gaps.length * 0.75)];
  return Math.round(Math.min(Math.max(p75 * 2.5, 7), 120));
}

/* ----------------------------------------------------------------- churn -- */

export type ChurnRead = {
  partyId: string;
  /** 0..1. Not a probability — a rank, and labelled as one wherever it is shown. */
  risk: number;
  /** When they are expected to stop, if nothing changes. Null when unknowable. */
  expectedLossAt: number | null;
  daysSinceSeen: number | null;
  typicalGap: number | null;
  /** The plain-language reasons, in the order they contributed. */
  reasons: string[];
};

/**
 * Who is about to leave, and roughly when.
 *
 * A flag is useless — every owner already knows some people drift away. A date
 * is actionable, because it tells you whether you have a week or an afternoon.
 * The date is the point at which this person will have been absent for twice
 * their own normal gap, which is where the historical renew rate collapses.
 */
export function churnRead(
  data: BusinessData,
  index: Index,
  partyId: string,
  now: number,
): ChurnRead {
  const reasons: string[] = [];
  const seen = index.lastSeen.get(partyId) ?? null;
  const gap = typicalGapDays(index, partyId);
  const party = index.partyById.get(partyId);

  // Floored at zero: a visit recorded moments after a screen last read the clock
  // is fractionally in the future, and a negative gap would print as "-1 days
  // ago" and make the overdue ratio come out backwards.
  const daysSince = seen === null ? null : Math.max(0, Math.floor((now - seen) / DAY));

  let risk = 0;

  if (seen === null) {
    // Joined and never turned up: the highest-risk state there is, and the
    // easiest to fix, because they have not formed a habit of staying away.
    const daysSinceJoin = party ? Math.floor((now - party.joinedAt) / DAY) : 0;
    if (daysSinceJoin > 14) {
      risk = 0.95;
      reasons.push('Has never been in since joining');
    }
    return { partyId, risk, expectedLossAt: null, daysSinceSeen: null, typicalGap: null, reasons };
  }

  if (gap !== null && daysSince !== null) {
    const overdue = daysSince / gap;
    if (overdue > 1.2) {
      risk = Math.min((overdue - 1) / 2, 1);
      reasons.push(
        `Normally comes every ${Math.round(gap)} day${Math.round(gap) === 1 ? '' : 's'}, last seen ${daysSince} day${daysSince === 1 ? '' : 's'} ago`,
      );
    }
  } else if (daysSince !== null && daysSince > 30) {
    risk = Math.min(daysSince / 90, 0.8);
    reasons.push(`Not enough history to judge, but ${daysSince} days is a long absence`);
  }

  // An unpaid balance sharply raises the chance a quiet person never returns —
  // people avoid places they owe money to.
  const owed = (index.moneyByParty.get(partyId) ?? [])
    .filter((m) => m.direction === 'in' && m.status === 'due')
    .reduce((s, m) => s + m.amount, 0);
  if (owed > 0 && risk > 0.15) {
    risk = Math.min(risk + 0.15, 1);
    reasons.push('Has an unpaid balance, which people tend to avoid rather than settle');
  }

  // Someone whose commitment already lapsed has crossed the line formally.
  // Read from the index rather than scanning every commitment in the business.
  const lapsed = (index.commitmentsByParty.get(partyId) ?? []).some(
    (c) => c.status !== 'cancelled' && c.endAt < now,
  );
  if (lapsed) {
    risk = Math.min(risk + 0.2, 1);
    reasons.push('Their plan has already run out and was not renewed');
  }

  const expectedLossAt = gap !== null ? seen + gap * 2 * DAY : null;

  return { partyId, risk, expectedLossAt, daysSinceSeen: daysSince, typicalGap: gap, reasons };
}

export function atRiskParties(
  data: BusinessData,
  index: Index,
  now: number,
  min = 0.4,
): ChurnRead[] {
  return data.parties
    .filter((p) => !p.archivedAt)
    .map((p) => churnRead(data, index, p.id, now))
    .filter((r) => r.risk >= min)
    .sort((a, b) => b.risk - a.risk);
}

/* ------------------------------------------------------------------ value -- */

export type PartyValue = {
  partyId: string;
  /** Everything settled, ever. */
  lifetime: number;
  /** Settled in the last 90 days, annualised. The number that predicts, not the one that flatters. */
  runRate: number;
  outstanding: number;
  firstPaidAt: number | null;
  months: number;
};

export function partyValue(index: Index, partyId: string, now: number): PartyValue {
  const entries = index.moneyByParty.get(partyId) ?? [];
  let lifetime = 0;
  let recent = 0;
  let out = 0;
  let firstPaidAt: number | null = null;

  for (const m of entries) {
    if (m.direction !== 'in') continue;
    if (m.status === 'due') {
      out += m.amount;
      continue;
    }
    lifetime += m.amount;
    if (firstPaidAt === null || m.at < firstPaidAt) firstPaidAt = m.at;
    if (m.at >= now - 90 * DAY) recent += m.amount;
  }

  const months = firstPaidAt === null ? 0 : Math.max((now - firstPaidAt) / (30 * DAY), 1);
  return {
    partyId,
    lifetime,
    runRate: (recent / 90) * 365,
    outstanding: out,
    firstPaidAt,
    months,
  };
}

/**
 * How dependably this person pays, from actual delay rather than reputation.
 *
 * Returns null rather than a flattering default when there is no history — an
 * unearned score of 100% is worse than an honest blank, because the owner will
 * lend against it.
 */
export type Reliability = {
  score: number | null;
  averageDelayDays: number | null;
  onTime: number;
  late: number;
  samples: number;
};

export function reliability(index: Index, partyId: string): Reliability {
  const entries = (index.moneyByParty.get(partyId) ?? []).filter(
    (m) => m.direction === 'in' && m.status === 'settled' && m.dueAt,
  );
  if (entries.length === 0) {
    return { score: null, averageDelayDays: null, onTime: 0, late: 0, samples: 0 };
  }

  let totalDelay = 0;
  let onTime = 0;
  let late = 0;
  for (const m of entries) {
    const delay = ((m.settledAt ?? m.at) - (m.dueAt as number)) / DAY;
    totalDelay += Math.max(delay, 0);
    if (delay <= 1) onTime += 1;
    else late += 1;
  }

  const avg = totalDelay / entries.length;
  // Ten days late is where a small business starts having to chase, so that is
  // the point the score is anchored to reach zero.
  const score = Math.max(0, Math.min(1, 1 - avg / 10));
  return { score, averageDelayDays: avg, onTime, late, samples: entries.length };
}

/* ------------------------------------------------------------ receivables -- */

export type AgingBucket = { label: string; from: number; to: number; amount: number; count: number };

export function agingBuckets(data: BusinessData, now: number): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: 'Not yet due', from: -Infinity, to: 0, amount: 0, count: 0 },
    { label: '1–30 days', from: 0, to: 30, amount: 0, count: 0 },
    { label: '31–60 days', from: 30, to: 60, amount: 0, count: 0 },
    { label: 'Over 60 days', from: 60, to: Infinity, amount: 0, count: 0 },
  ];

  for (const m of data.money) {
    if (m.direction !== 'in' || m.status !== 'due') continue;
    const due = m.dueAt ?? m.at;
    const age = (now - due) / DAY;
    const bucket = buckets.find((b) => age > b.from && age <= b.to) ?? buckets[buckets.length - 1];
    bucket.amount += m.amount;
    bucket.count += 1;
  }

  return buckets;
}

/* -------------------------------------------------------------- forecast -- */

export type CashForecast = {
  /** Expected to land in the next 30 days. */
  expected: number;
  /** From commitments due to renew. */
  fromRenewals: number;
  /** From invoices already raised and unpaid, discounted by reliability. */
  fromReceivables: number;
  /** From ordinary trade, extrapolated from the last 90 days. */
  fromTrade: number;
  /** 0..1 — how much history this rests on. Shown, never hidden. */
  confidence: number;
};

/**
 * What is likely to come in over the next thirty days.
 *
 * Receivables are discounted by the payer's own reliability rather than counted
 * at face value. Counting them in full is how small businesses talk themselves
 * into spending money that never arrives.
 */
export function cashForecast(
  profile: BusinessProfile,
  data: BusinessData,
  index: Index,
  now: number,
): CashForecast {
  const horizon = now + 30 * DAY;

  let fromRenewals = 0;
  if (profile.shape.commitmentWeight > 0.3) {
    for (const c of data.commitments) {
      if (c.status === 'cancelled') continue;
      if (c.endAt < now || c.endAt > horizon) continue;
      const read = churnRead(data, index, c.partyId, now);
      // Renewal likelihood is the inverse of churn risk, floored so that even a
      // high-risk plan contributes something.
      fromRenewals += c.price * Math.max(0.15, 1 - read.risk);
    }
  }

  let fromReceivables = 0;
  for (const m of data.money) {
    if (m.direction !== 'in' || m.status !== 'due') continue;
    const r = m.partyId ? reliability(index, m.partyId) : { score: null };
    fromReceivables += m.amount * (r.score ?? 0.6);
  }

  const trade90 = data.money
    .filter(
      (m) =>
        m.direction === 'in' &&
        m.status === 'settled' &&
        m.at >= now - 90 * DAY &&
        !data.commitments.some((c) => c.partyId === m.partyId && Math.abs(c.startAt - m.at) < DAY),
    )
    .reduce((s, m) => s + m.amount, 0);
  const fromTrade = (trade90 / 90) * 30;

  const settledCount = data.money.filter((m) => m.status === 'settled').length;
  const confidence = Math.min(settledCount / 60, 1);

  return {
    expected: fromRenewals + fromReceivables + fromTrade,
    fromRenewals,
    fromReceivables,
    fromTrade,
    confidence,
  };
}

/* ----------------------------------------------------------- break-even -- */

export type BreakEven = {
  monthlyFixed: number;
  collectedThisMonth: number;
  /** Still to collect this month to cover fixed costs. Negative means covered. */
  remaining: number;
  /** Day of the month it is expected to be crossed, or null if not on pace. */
  expectedDay: number | null;
  covered: boolean;
};

export function breakEven(data: BusinessData, now: number): BreakEven {
  const declared = data.fixedCosts.reduce((s, f) => s + f.amount, 0);

  // Fall back to observed fixed spend when nothing has been declared, so the
  // line appears without requiring setup and sharpens once it is done.
  const observed = declared > 0
    ? 0
    : (() => {
        const threeMonths = data.money.filter(
          (m) =>
            m.direction === 'out' &&
            m.at >= now - 90 * DAY &&
            m.category &&
            FIXED_EXPENSES.includes(m.category),
        );
        return (threeMonths.reduce((s, m) => s + m.amount, 0) / 3);
      })();

  const monthlyFixed = declared > 0 ? declared : observed;
  const monthStart = startOfMonth(now);
  const collected = data.money
    .filter((m) => m.direction === 'in' && m.status === 'settled' && m.at >= monthStart)
    .reduce((s, m) => s + m.amount, 0);

  const dayOfMonth = new Date(now).getDate();
  const perDay = collected / Math.max(dayOfMonth, 1);
  const remaining = monthlyFixed - collected;
  const expectedDay =
    remaining <= 0 ? dayOfMonth : perDay > 0 ? Math.ceil(monthlyFixed / perDay) : null;

  return {
    monthlyFixed,
    collectedThisMonth: collected,
    remaining,
    expectedDay: expectedDay && expectedDay <= 31 ? expectedDay : null,
    covered: remaining <= 0,
  };
}

/* ---------------------------------------------------------------- cohorts -- */

export type Cohort = {
  key: string;
  label: string;
  size: number;
  /** Share still active at month 1, 2, 3… from joining. */
  retention: number[];
};

/**
 * Retention by joining month.
 *
 * The single most diagnostic chart in any recurring business: it separates "we
 * are losing people" from "we were always losing people and used to replace
 * them faster".
 */
export function cohorts(data: BusinessData, index: Index, now: number, maxMonths = 6): Cohort[] {
  const groups = new Map<string, Party[]>();
  for (const p of data.parties) {
    const key = monthKey(p.joinedAt);
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, members]) => {
      const [y, m] = key.split('-').map(Number);
      const retention: number[] = [];

      for (let month = 0; month < maxMonths; month++) {
        const windowStart = new Date(y, m - 1 + month, 1).getTime();
        const windowEnd = new Date(y, m + month, 1).getTime();
        // A month that has not happened yet is not zero retention, it is unknown.
        if (windowStart > now) break;

        const active = members.filter((p) => {
          const visits = index.engagementsByParty.get(p.id) ?? [];
          return visits.some((at) => at >= windowStart && at < windowEnd);
        }).length;
        retention.push(members.length === 0 ? 0 : active / members.length);
      }

      return {
        key,
        label: `${months[m - 1]} ${String(y).slice(2)}`,
        size: members.length,
        retention,
      };
    })
    .filter((c) => c.size > 0);
}

/* --------------------------------------------------------------- capacity -- */

export type CapacityCell = { weekday: number; hour: number; count: number };

/** Which hours are full and which are dead, over the trailing eight weeks. */
export function capacityGrid(data: BusinessData, now: number): CapacityCell[] {
  const grid = new Map<string, number>();
  for (const e of data.engagements) {
    if (e.at < now - 56 * DAY || e.at > now) continue;
    const d = new Date(e.at);
    const key = `${d.getDay()}:${d.getHours()}`;
    grid.set(key, (grid.get(key) ?? 0) + 1);
  }

  const out: CapacityCell[] = [];
  for (const [key, count] of grid) {
    const [weekday, hour] = key.split(':').map(Number);
    out.push({ weekday, hour, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Hours with any activity, so a heatmap does not render 24 mostly-empty rows. */
export function activeHourRange(cells: CapacityCell[]): { from: number; to: number } {
  if (cells.length === 0) return { from: 9, to: 20 };
  let from = 23;
  let to = 0;
  for (const c of cells) {
    if (c.hour < from) from = c.hour;
    if (c.hour > to) to = c.hour;
  }
  return { from: Math.max(from - 1, 0), to: Math.min(to + 1, 23) };
}

/* ------------------------------------------------------------ seasonality -- */

export type SeasonPoint = { month: number; label: string; total: number; index: number };

/**
 * This business's own annual shape.
 *
 * Requires more than a year of history to mean anything, and says so rather than
 * drawing a confident curve through four months of data.
 */
export function seasonality(data: BusinessData, now: number): { points: SeasonPoint[]; usable: boolean } {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const totals = new Array(12).fill(0);
  const seen = new Set<string>();

  for (const m of data.money) {
    if (m.direction !== 'in' || m.status !== 'settled') continue;
    const d = new Date(m.at);
    totals[d.getMonth()] += m.amount;
    seen.add(monthKey(m.at));
  }

  const mean = totals.reduce((s, t) => s + t, 0) / 12 || 1;
  const points = totals.map((total, month) => ({
    month,
    label: months[month],
    total,
    index: total / mean,
  }));

  return { points, usable: seen.size >= 13 };
}

/* --------------------------------------------------------------- no-shows -- */

export type NoShowRead = { count: number; rate: number; cost: number };

export function noShows(data: BusinessData, now: number, days = 56): NoShowRead {
  const window = data.engagements.filter((e) => e.at >= now - days * DAY && e.at <= now);
  const missed = window.filter((e) => e.noShow);
  const averageValue =
    window.filter((e) => !e.noShow && e.value).reduce((s, e) => s + (e.value ?? 0), 0) /
    Math.max(window.filter((e) => !e.noShow && e.value).length, 1);

  return {
    count: missed.length,
    rate: window.length === 0 ? 0 : missed.length / window.length,
    cost: missed.length * averageValue,
  };
}

/* -------------------------------------------------------------- referrals -- */

export type ReferralNode = { partyId: string; name: string; broughtIn: number; value: number };

export function referralGraph(data: BusinessData, index: Index, now: number): ReferralNode[] {
  const counts = new Map<string, string[]>();
  for (const p of data.parties) {
    if (!p.referredBy) continue;
    const list = counts.get(p.referredBy);
    if (list) list.push(p.id);
    else counts.set(p.referredBy, [p.id]);
  }

  return [...counts.entries()]
    .map(([partyId, brought]) => ({
      partyId,
      name: index.partyById.get(partyId)?.name ?? 'Unknown',
      broughtIn: brought.length,
      // The referrer's real worth is their own spend plus everything they brought.
      value: brought.reduce((s, id) => s + partyValue(index, id, now).lifetime, 0),
    }))
    .sort((a, b) => b.value - a.value);
}

/* ------------------------------------------------------------ follow-up -- */

/**
 * People already reached out to, and recently enough that asking again is nagging.
 *
 * Without this the app has no memory of effort. Ticking eight names off a
 * check-in list changes no visit record — contacting someone does not make them
 * turn up — so the lapse detector saw the same eight the moment you returned to
 * the home screen and asked for them again. Correct arithmetic, useless
 * behaviour: it made doing the work look identical to ignoring it.
 *
 * The window is a fortnight because that is roughly how long a nudge takes to
 * work or fail. After it, someone who still has not come back is a genuinely new
 * finding rather than a repeat of the old one, and worth raising again.
 */
export function recentlyContacted(data: BusinessData, now: number, days = 14): Set<string> {
  const cutoff = now - days * DAY;
  const out = new Set<string>();
  for (const o of data.obligations) {
    if (o.kind !== 'followUp' || !o.done || !o.partyId) continue;
    if ((o.doneAt ?? o.dueAt) >= cutoff) out.add(o.partyId);
  }
  return out;
}

/* ---------------------------------------------------------------- staff -- */

export type StaffRead = {
  staffId: string;
  /** People assigned to them, where the business attributes at all. */
  parties: number;
  /** Sessions they ran in the window. */
  sessions: number;
  /** Money attributable to those sessions. */
  revenue: number;
  /** Share of the whole business's takings in the same window. */
  share: number;
  /**
   * How many of their people are drifting, against how many they have.
   *
   * The number worth having and the one nobody measures. Two staff can look
   * identical on takings while one quietly loses a third of their list.
   */
  atRisk: number;
  retention: number | null;
  noShows: number;
};

/**
 * Per-person performance, over a trailing window.
 *
 * Deliberately reports retention alongside revenue. Ranking staff on takings
 * alone rewards whoever was handed the best customers, and punishes the one
 * doing the work of keeping difficult ones.
 */
export function staffRead(
  data: BusinessData,
  index: Index,
  staffId: string,
  now: number,
  days = 56,
): StaffRead {
  const from = now - days * DAY;

  const mine = data.parties.filter((p) => !p.archivedAt && p.staffId === staffId);
  const sessions = data.engagements.filter(
    (e) => e.staffId === staffId && e.at >= from && e.at <= now,
  );

  /**
   * Two ways money attaches to a person, and the business decides which.
   *
   * Where each visit carries its own value — a salon, a garage — attribution is
   * simply the sum of the sessions they ran. Where the money sits on a renewing
   * plan instead, sessions carry no value at all and that sum is zero for
   * everybody; the tuition centre's staff chart came out flat with a ₹1 axis.
   * There, the honest attribution is what the people assigned to them paid.
   */
  const fromSessions = sessions.reduce((s, e) => s + (e.value ?? 0), 0);
  const inWindow = (partyId: string) =>
    (index.moneyByParty.get(partyId) ?? [])
      .filter((m) => m.direction === 'in' && m.status === 'settled' && m.at >= from && m.at <= now)
      .reduce((s, m) => s + m.amount, 0);

  const fromParties = mine.reduce((s, p) => s + inWindow(p.id), 0);
  const perSession = fromSessions > 0;

  const revenue = perSession ? fromSessions : fromParties;
  const total = perSession
    ? data.engagements
        .filter((e) => e.at >= from && e.at <= now)
        .reduce((s, e) => s + (e.value ?? 0), 0)
    : data.money
        .filter((m) => m.direction === 'in' && m.status === 'settled' && m.at >= from && m.at <= now)
        .reduce((s, m) => s + m.amount, 0);

  const risky = mine.filter((p) => churnRead(data, index, p.id, now).risk >= 0.5);

  return {
    staffId,
    parties: mine.length,
    sessions: sessions.filter((e) => !e.noShow).length,
    revenue,
    share: total > 0 ? revenue / total : 0,
    atRisk: risky.length,
    retention: mine.length === 0 ? null : 1 - risky.length / mine.length,
    noShows: sessions.filter((e) => e.noShow).length,
  };
}

/* ------------------------------------------------------------ first days -- */

export type OnboardingRead = {
  party: Party;
  daysIn: number;
  visits: number;
  /** Visits a person who stayed had made by this point. */
  benchmark: number;
  onTrack: boolean;
};

/**
 * The first ninety days, where churn is actually decided.
 *
 * Compares each new party against what the business's own long-term members had
 * done by the same age. A generic "come more often" is ignorable; "people who
 * stayed had been in four times by now, they have been twice" is not.
 */
export function firstNinetyDays(data: BusinessData, index: Index, now: number): OnboardingRead[] {
  const survivors = data.parties.filter((p) => now - p.joinedAt > 180 * DAY);

  const benchmarkAt = (days: number): number => {
    if (survivors.length === 0) return 0;
    const counts = survivors.map((p) => {
      const visits = index.engagementsByParty.get(p.id) ?? [];
      return visits.filter((at) => at <= p.joinedAt + days * DAY).length;
    });
    counts.sort((a, b) => a - b);
    return counts[Math.floor(counts.length / 2)];
  };

  return data.parties
    .filter((p) => now - p.joinedAt <= 90 * DAY)
    .map((p) => {
      const daysIn = Math.max(Math.floor((now - p.joinedAt) / DAY), 1);
      const visits = (index.engagementsByParty.get(p.id) ?? []).length;
      const benchmark = benchmarkAt(daysIn);
      return { party: p, daysIn, visits, benchmark, onTrack: visits >= benchmark };
    })
    .sort((a, b) => a.visits - b.visits);
}
