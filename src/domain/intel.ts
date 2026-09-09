import {
  buildIndex,
  churnRead,
  partyValue,
  quietThresholdDays,
  reliability,
  type Index,
} from '@/domain/analytics';
import { money } from '@/domain/metrics';
import type {
  BusinessData,
  BusinessProfile,
  BusinessShape,
  Forecast,
  Party,
} from '@/domain/model';
import { formatDayMonth } from '@/lib/time';

/**
 * The parts that are hard to copy.
 *
 * Segments, simulation, deduplication, drift and counterfactuals. What they have
 * in common is that each one needs the business's own accumulated history to be
 * worth anything — a competitor can ship the same feature and it will be blank
 * for a year. That is the moat, and it is why these live together.
 */

const DAY = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------- segments -- */

export type Segment = {
  id: string;
  /** Written as the owner would say it, not as a query. */
  label: string;
  description: string;
  partyIds: string[];
  /** Total lifetime value of the segment, for ranking. */
  value: number;
};

/**
 * Named groups computed from behaviour rather than declared by the owner.
 *
 * Deliberately a fixed set rather than a query builder. A query builder is a
 * feature for people who enjoy software; the owner of a tuition centre wants
 * "the ones who used to come weekly and stopped", which is one tap.
 */
export function segments(
  profile: BusinessProfile,
  data: BusinessData,
  now = Date.now(),
  index?: Index,
): Segment[] {
  const idx = index ?? buildIndex(data);
  const live = data.parties.filter((p) => !p.archivedAt);
  const quietDays = quietThresholdDays(profile, data, idx);
  const out: Segment[] = [];

  const build = (id: string, label: string, description: string, members: Party[]) => {
    if (members.length === 0) return;
    out.push({
      id,
      label,
      description,
      partyIds: members.map((p) => p.id),
      value: members.reduce((s, p) => s + partyValue(idx, p.id, now).lifetime, 0),
    });
  };

  build(
    'lapsing',
    'Used to come, then stopped',
    `Had a settled routine and have now been away more than ${quietDays} days. The most recoverable group there is.`,
    live.filter((p) => {
      const visits = idx.engagementsByParty.get(p.id) ?? [];
      if (visits.length < 4) return false;
      const seen = idx.lastSeen.get(p.id) ?? 0;
      return seen < now - quietDays * DAY;
    }),
  );

  build(
    'never-started',
    'Joined but never came',
    'Signed up and never turned up. Usually a broken first week rather than a bad fit.',
    live.filter((p) => !idx.engagementsByParty.has(p.id) && now - p.joinedAt > 14 * DAY),
  );

  build(
    'best',
    'Your best people',
    'Top fifth by what they have actually spent. Worth knowing by name.',
    (() => {
      const ranked = live
        .map((p) => ({ p, v: partyValue(idx, p.id, now).lifetime }))
        .sort((a, b) => b.v - a.v);
      return ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.2))).map((x) => x.p);
    })(),
  );

  build(
    'new',
    'Still finding their feet',
    'Joined in the last month. What happens now decides whether they stay a year.',
    live.filter((p) => now - p.joinedAt <= 30 * DAY),
  );

  build(
    'owing',
    'Owe you money',
    'Has at least one unpaid entry. Ordered by how much.',
    live
      .filter((p) => partyValue(idx, p.id, now).outstanding > 0)
      .sort((a, b) => partyValue(idx, b.id, now).outstanding - partyValue(idx, a.id, now).outstanding),
  );

  build(
    'slow-payers',
    'Reliably late',
    'Pay eventually, but never on the day. Worth different terms rather than more chasing.',
    live.filter((p) => {
      const r = reliability(idx, p.id);
      return r.samples >= 3 && r.score !== null && r.score < 0.5;
    }),
  );

  build(
    'loyal',
    'Been with you longest',
    'A year or more and still coming. The group most businesses never thank.',
    live.filter((p) => {
      const seen = idx.lastSeen.get(p.id) ?? 0;
      return now - p.joinedAt > 365 * DAY && seen > now - quietDays * DAY;
    }),
  );

  if (profile.shape.commitmentWeight > 0.4) {
    const expiring = new Set(
      data.commitments
        .filter((c) => c.status !== 'cancelled' && c.endAt >= now && c.endAt <= now + 14 * DAY)
        .map((c) => c.partyId),
    );
    build(
      'expiring',
      'Up for renewal',
      'Their plan ends within a fortnight. The decision is being made now whether you take part or not.',
      live.filter((p) => expiring.has(p.id)),
    );
  }

  return out.sort((a, b) => b.value - a.value);
}

/* ------------------------------------------------------------- simulator -- */

export type PriceScenario = {
  changePct: number;
  /** Revenue if nobody left. The number owners imagine. */
  naive: number;
  /** Revenue after expected departures. The number that happens. */
  expected: number;
  /** How many people are likely to go. */
  likelyToLeave: number;
  leavingIds: string[];
  currentAnnual: number;
  verdict: string;
};

/**
 * What a price change would actually do.
 *
 * The naive figure is included on purpose, because it is the one the owner has
 * already worked out in their head, and showing the gap between it and the
 * expected figure is the entire value of the feature.
 *
 * Sensitivity is not a market constant — it is estimated from each person's own
 * behaviour. Someone who comes twice a week and has been for two years absorbs a
 * rise; someone who already comes irregularly and pays late does not.
 */
export function simulatePriceChange(
  profile: BusinessProfile,
  data: BusinessData,
  changePct: number,
  now = Date.now(),
  index?: Index,
): PriceScenario {
  const idx = index ?? buildIndex(data);
  const live = data.parties.filter((p) => !p.archivedAt);

  let currentAnnual = 0;
  let expected = 0;
  const leavingIds: string[] = [];

  for (const p of live) {
    const value = partyValue(idx, p.id, now);
    const annual = value.runRate;
    if (annual <= 0) continue;
    currentAnnual += annual;

    // Attachment: high means they absorb a rise. Built from tenure, frequency
    // and payment behaviour, all of which the business already knows.
    const tenureYears = (now - p.joinedAt) / (365 * DAY);
    const visits = (idx.engagementsByParty.get(p.id) ?? []).length;
    const rel = reliability(idx, p.id);
    const churn = churnRead(data, idx, p.id, now);

    let attachment = 0.35;
    attachment += Math.min(tenureYears, 2) * 0.15;
    attachment += Math.min(visits / 40, 1) * 0.2;
    if (rel.score !== null) attachment += (rel.score - 0.5) * 0.2;
    attachment -= churn.risk * 0.35;
    attachment = Math.max(0.05, Math.min(attachment, 0.95));

    // Only rises cause departures. A cut is modelled as revenue forgone, since
    // predicting the new customers a discount attracts would be invention.
    const leaveChance = changePct > 0 ? Math.min((changePct / 100) * (1 - attachment) * 3, 0.9) : 0;

    if (leaveChance > 0.5) leavingIds.push(p.id);
    expected += annual * (1 + changePct / 100) * (1 - leaveChance);
  }

  const naive = currentAnnual * (1 + changePct / 100);
  const net = expected - currentAnnual;

  const verdict =
    changePct === 0
      ? 'No change.'
      : net > 0
        ? `About ${money(net)} a year better off, after roughly ${leavingIds.length} people leave.`
        : `About ${money(Math.abs(net))} a year worse off — the departures cost more than the rise brings in.`;

  return {
    changePct,
    naive,
    expected,
    likelyToLeave: leavingIds.length,
    leavingIds,
    currentAnnual,
    verdict,
  };
}

/* ------------------------------------------------------------ duplicates -- */

export type DuplicatePair = {
  a: Party;
  b: Party;
  score: number;
  reason: string;
};

/** Levenshtein, capped — only used on short names, so the naive version is fine. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[n];
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Likely duplicate records.
 *
 * Phone matches are certain; name matches are a suggestion and are scored below
 * the threshold at which anything is proposed automatically. Two brothers called
 * Sharma at the same tuition centre are not a duplicate, and merging them would
 * destroy history that cannot be reconstructed.
 */
export function findDuplicates(data: BusinessData): DuplicatePair[] {
  const live = data.parties.filter((p) => !p.archivedAt);
  const out: DuplicatePair[] = [];

  const byPhone = new Map<string, Party[]>();
  for (const p of live) {
    if (!p.phone) continue;
    const key = p.phone.replace(/\D/g, '').slice(-10);
    if (key.length < 10) continue;
    const list = byPhone.get(key);
    if (list) list.push(p);
    else byPhone.set(key, [p]);
  }
  for (const group of byPhone.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        out.push({ a: group[i], b: group[j], score: 0.98, reason: 'Same phone number' });
      }
    }
  }

  const seen = new Set(out.map((p) => `${p.a.id}|${p.b.id}`));
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (seen.has(`${a.id}|${b.id}`)) continue;
      const na = normalise(a.name);
      const nb = normalise(b.name);
      if (na === nb) {
        out.push({ a, b, score: 0.75, reason: 'Same name, different record' });
        continue;
      }
      if (na.length > 5 && editDistance(na, nb) <= 1) {
        out.push({ a, b, score: 0.6, reason: 'Names differ by one letter' });
      }
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

/** Folds `loser` into `keeper`, preserving every record on both sides. */
export function mergeParties(data: BusinessData, keeperId: string, loserId: string): BusinessData {
  const keeper = data.parties.find((p) => p.id === keeperId);
  const loser = data.parties.find((p) => p.id === loserId);
  if (!keeper || !loser) return data;

  return {
    ...data,
    parties: data.parties
      .filter((p) => p.id !== loserId)
      .map((p) =>
        p.id === keeperId
          ? {
              ...p,
              phone: p.phone ?? loser.phone,
              detail: p.detail ?? loser.detail,
              notes: [p.notes, loser.notes].filter(Boolean).join('\n') || undefined,
              // Earliest join date wins: the relationship started when it started.
              joinedAt: Math.min(p.joinedAt, loser.joinedAt),
              mergedFrom: [...(p.mergedFrom ?? []), loserId],
            }
          : p,
      ),
    engagements: data.engagements.map((e) => (e.partyId === loserId ? { ...e, partyId: keeperId } : e)),
    commitments: data.commitments.map((c) => (c.partyId === loserId ? { ...c, partyId: keeperId } : c)),
    money: data.money.map((m) => (m.partyId === loserId ? { ...m, partyId: keeperId } : m)),
    obligations: data.obligations.map((o) => (o.partyId === loserId ? { ...o, partyId: keeperId } : o)),
  };
}

/* ----------------------------------------------------------------- drift -- */

export type DriftFinding = {
  key: keyof BusinessShape;
  label: string;
  /** What the business was compiled as. */
  was: string;
  /** What the records now say. */
  now: string;
  /** Plain-language proposal. */
  proposal: string;
};

/**
 * Whether the business has stopped matching the shape it was compiled into.
 *
 * This is the feature that makes the compiler a living thing rather than a
 * one-off setup wizard. A tuition centre that starts selling books is no longer
 * the business it described, and the software should notice before the owner has
 * to go and change a setting they have long forgotten exists.
 */
export function detectDrift(
  profile: BusinessProfile,
  data: BusinessData,
  now = Date.now(),
): DriftFinding[] {
  const out: DriftFinding[] = [];

  // Drift is a claim that the business has changed since it was described. A
  // business described last week has not changed — any disagreement there is the
  // compiler having misread the description, which is a different problem with a
  // different fix, and telling someone their business has transformed six days
  // after they set it up destroys confidence in everything else on the screen.
  if (now - profile.createdAt < 60 * DAY) return out;

  const recent = data.money.filter(
    (m) => m.direction === 'in' && m.status !== 'due' && m.at >= now - 90 * DAY,
  );
  if (recent.length < 15) return out;

  // Commitment weight: how much of recent income came from plan-shaped offerings.
  const planIds = new Set(data.offerings.filter((o) => o.durationDays).map((o) => o.id));
  const fromPlans = recent
    .filter((m) => m.offeringId && planIds.has(m.offeringId))
    .reduce((s, m) => s + m.amount, 0);
  const total = recent.reduce((s, m) => s + m.amount, 0);
  const observedWeight = total > 0 ? fromPlans / total : profile.shape.commitmentWeight;

  if (Math.abs(observedWeight - profile.shape.commitmentWeight) > 0.3) {
    out.push({
      key: 'commitmentWeight',
      label: 'How you earn',
      was:
        profile.shape.commitmentWeight > 0.4
          ? 'mostly plans people renew'
          : 'mostly one-off sales',
      now: observedWeight > 0.4 ? 'mostly plans people renew' : 'mostly one-off sales',
      proposal:
        observedWeight < profile.shape.commitmentWeight
          ? 'Most of your income is no longer coming from plans. Renewal and expiry may be taking up space that sales figures should have.'
          : 'Most of your income now comes from plans. Renewals and expiry dates matter more than they did.',
    });
  }

  // Payment timing: is money arriving before, at, or after the work.
  const withBoth = data.money.filter(
    (m) => m.direction === 'in' && m.status === 'settled' && m.dueAt && m.settledAt,
  );
  if (withBoth.length >= 12) {
    const avgDelay =
      withBoth.reduce((s, m) => s + ((m.settledAt as number) - (m.dueAt as number)) / DAY, 0) /
      withBoth.length;
    const observedTiming: BusinessShape['paymentTiming'] =
      avgDelay > 3 ? 'after' : avgDelay < -1 ? 'before' : 'at';
    if (observedTiming !== profile.shape.paymentTiming) {
      const say = (t: BusinessShape['paymentTiming']) =>
        t === 'before' ? 'up front' : t === 'at' ? 'on the day' : 'afterwards, often late';
      out.push({
        key: 'paymentTiming',
        label: 'When you get paid',
        was: say(profile.shape.paymentTiming),
        now: say(observedTiming),
        proposal:
          observedTiming === 'after'
            ? 'Money is arriving later than the setup assumed. Chasing unpaid balances should be more prominent.'
            : 'Money is arriving sooner than the setup assumed. The outstanding column may be cluttering things up for nothing.',
      });
    }
  }

  // Staff attribution: has anyone started working here.
  const activeStaff = data.staff.filter((s) => s.active !== false).length;
  if (activeStaff > 0 && !profile.shape.staffAttribution) {
    out.push({
      key: 'staffAttribution',
      label: 'Working with you',
      was: 'on your own',
      now: `${activeStaff} on the books`,
      proposal: 'Now that others are working with you, takings and retention can be shown per person.',
    });
  }

  return out;
}

/* -------------------------------------------------------- counterfactual -- */

export type Counterfactual = {
  headline: string;
  detail: string;
  amount: number;
};

/**
 * What a missed action cost.
 *
 * Regret is the most motivating number in business software, and it is also the
 * easiest to abuse — so this only fires on actions the app actually raised and
 * the owner actually skipped, never on hypotheticals it invented afterwards.
 */
export function counterfactuals(
  profile: BusinessProfile,
  data: BusinessData,
  now = Date.now(),
  index?: Index,
): Counterfactual[] {
  const idx = index ?? buildIndex(data);
  const out: Counterfactual[] = [];

  const skipped = data.actions.filter(
    (a) =>
      a.outcome === 'skipped' &&
      a.kind === 'contact' &&
      a.createdAt < now - 21 * DAY &&
      a.createdAt > now - 120 * DAY,
  );

  for (const action of skipped) {
    // Only count people who did in fact go quiet after being skipped.
    const lost = action.partyIds.filter((id) => {
      const seen = idx.lastSeen.get(id);
      return seen === undefined || seen < action.createdAt;
    });
    if (lost.length === 0) continue;

    const value = lost.reduce((s, id) => {
      const v = partyValue(idx, id, now);
      // A quarter of their annual run rate: the horizon a win-back plausibly buys.
      return s + v.runRate * 0.25;
    }, 0);
    if (value < 500) continue;

    out.push({
      headline: `${lost.length} of the ${action.partyIds.length} you skipped have not come back`,
      detail: `On ${formatDayMonth(action.createdAt)} this suggested "${action.label}". Nobody has seen them since — worth roughly ${money(value)} over a quarter.`,
      amount: value,
    });
  }

  return out.sort((a, b) => b.amount - a.amount).slice(0, 2);
}

/* ------------------------------------------------------- shadow forecast -- */

export type Calibration = {
  samples: number;
  /** Mean absolute error as a share of actual. Null when untested. */
  error: number | null;
  verdict: string;
};

/**
 * How wrong the app's own predictions have been.
 *
 * Publishing this is the point. Every business tool makes forecasts; almost none
 * will tell you how they did, because the answer is usually embarrassing. Showing
 * it is what earns the right to make the next one.
 */
export function calibration(data: BusinessData, now = Date.now()): Calibration {
  const scored = data.forecasts.filter((f) => f.actual != null && f.forDay < now);
  if (scored.length < 5) {
    return {
      samples: scored.length,
      error: null,
      verdict: 'Not enough predictions have been checked yet to say how accurate this is.',
    };
  }

  const errors = scored.map((f) => {
    const actual = f.actual as number;
    if (actual === 0) return f.predicted === 0 ? 0 : 1;
    return Math.abs(f.predicted - actual) / actual;
  });
  const mean = errors.reduce((s, e) => s + e, 0) / errors.length;

  return {
    samples: scored.length,
    error: mean,
    verdict:
      mean < 0.15
        ? `Typically within ${Math.round(mean * 100)}% over ${scored.length} checks. Reasonably trustworthy.`
        : mean < 0.35
          ? `Typically out by about ${Math.round(mean * 100)}% over ${scored.length} checks. Treat it as a direction, not a figure.`
          : `Out by about ${Math.round(mean * 100)}% on average. Not yet good enough to plan against.`,
  };
}

/** Records today's prediction so it can be scored tomorrow. */
export function makeForecast(data: BusinessData, now = Date.now()): Forecast | null {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const forDay = tomorrow.getTime();

  if (data.forecasts.some((f) => f.forDay === forDay && f.metric === 'revenue')) return null;

  const samples: number[] = [];
  for (let w = 1; w <= 8; w++) {
    const ref = forDay - w * 7 * DAY;
    samples.push(
      data.money
        .filter((m) => m.direction === 'in' && m.status === 'settled' && m.at >= ref && m.at < ref + DAY)
        .reduce((s, m) => s + m.amount, 0),
    );
  }
  if (samples.filter((s) => s > 0).length < 3) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  return {
    id: `fc-${forDay}`,
    metric: 'revenue',
    forDay,
    predicted: median,
    madeAt: now,
  };
}

/** Fills in what actually happened for any forecast whose day has passed. */
export function scoreForecasts(data: BusinessData, now = Date.now()): Forecast[] {
  return data.forecasts.map((f) => {
    if (f.actual != null || f.forDay + DAY > now) return f;
    const actual = data.money
      .filter((m) => m.direction === 'in' && m.status === 'settled' && m.at >= f.forDay && m.at < f.forDay + DAY)
      .reduce((s, m) => s + m.amount, 0);
    return { ...f, actual };
  });
}
