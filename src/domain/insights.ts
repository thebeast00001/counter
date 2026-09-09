import {
  agingBuckets,
  atRiskParties,
  breakEven,
  buildIndex,
  capacityGrid,
  cohorts,
  firstNinetyDays,
  noShows,
  partyValue,
  recentlyContacted,
  referralGraph,
  startOfDay,
  type Index,
} from '@/domain/analytics';
import { counterfactuals, detectDrift } from '@/domain/intel';
import { anniversaries, reconcile } from '@/domain/memory';
import {
  engagementsBetween,
  expiringWithin,
  lastSeenAt,
  money,
  outstanding,
  revenueBetween,
} from '@/domain/metrics';
import type { BusinessData, BusinessProfile } from '@/domain/model';
import { plural } from '@/domain/words';
import { formatDateFull, formatDayMonth } from '@/lib/time';

const DAY = 24 * 60 * 60 * 1000;

export type InsightAction = {
  label: string;
  /** Parties the action applies to, in the order they should be worked through. */
  partyIds: string[];
  kind: 'contact' | 'collect' | 'review';
};

export type Insight = {
  id: string;
  /** The finding, in one line. */
  title: string;
  /** The causal chain — why this is true and what it rests on. */
  detail: string;
  action?: InsightAction;
  score: number;
  /** Kept so a dismissal can down-weight this whole class, not one instance. */
  family: string;
  /**
   * The underlying movement this describes.
   *
   * Two findings can be separately true and still be one story — customers
   * lapsing and takings falling are cause and effect. Showing both spends half
   * the daily budget saying the same thing twice, so only the strongest survives
   * per story, and the one with names and an action attached always outscores
   * the one without.
   */
  story?: string;
  /**
   * Positive findings and outcome reports.
   *
   * Kept distinct because an app that only ever reports problems gets read as
   * nagging and then not read at all. Tone also decides the card's colour.
   */
  tone?: 'attention' | 'good' | 'neutral';
  /** Where "show me the evidence" goes. */
  evidence?: { label: string; href: string };
};

/* --------------------------------------------------------------- salience --
 *
 * Three factors, multiplied so that a zero on any one kills the insight. A
 * finding that is surprising but unactionable is trivia; one that is actionable
 * but immaterial is noise. Only things that clear all three deserve the screen.
 */
type Factors = {
  /** How far outside this business's normal range. 0..1 */
  surprise: number;
  /** How much money or how many people, relative to this business. 0..1 */
  materiality: number;
  /** Can she do something before it stops being true. 0..1 */
  actionability: number;
};

function score({ surprise, materiality, actionability }: Factors): number {
  return surprise * materiality * actionability;
}

/** Scales a count against what is normal for this business, not an absolute. */
function relative(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(part / whole, 1);
}

type Ctx = {
  profile: BusinessProfile;
  data: BusinessData;
  index: Index;
  now: number;
};

/* --------------------------------------------------------- churn & lapse -- */

function expiringAndQuiet({ profile, data, index, now }: Ctx): Insight | null {
  if (profile.shape.commitmentWeight <= 0.4) return null;

  const expiring = expiringWithin(data, now, 7);
  if (expiring.length === 0) return null;

  const quietCutoff = now - 14 * DAY;
  const atRisk = expiring.filter((c) => {
    const seen = lastSeenAt(data, c.partyId);
    return seen === null || seen < quietCutoff;
  });
  if (atRisk.length === 0) return null;

  // Same rule as the lapse finding: already reached out to means off the list.
  const reached = recentlyContacted(data, now);
  const toContact = atRisk.filter((c) => !reached.has(c.partyId));
  if (toContact.length === 0) return null;

  const term = profile.vocabulary.commitment.many.toLowerCase();
  const value = atRisk.reduce((sum, c) => sum + c.price, 0);

  return {
    id: 'expiring-quiet',
    family: 'renewal-risk',
    title: `${atRisk.length} of ${expiring.length} expiring ${term} have gone quiet`,
    detail:
      `They have not been in for a fortnight and expire within seven days. ` +
      `That is ${money(value)} of renewals, and people who lapse before expiry renew far less often ` +
      `than people who are still turning up.`,
    action: {
      label: `Contact ${toContact.length}`,
      partyIds: toContact.map((c) => c.partyId),
      kind: 'contact',
    },
    tone: 'attention',
    score: score({
      // Quiet-before-expiry is the strongest early churn signal there is.
      surprise: 0.8,
      materiality: relative(atRisk.length, Math.max(expiring.length, 6)),
      actionability: 1,
    }),
  };
}

/**
 * People who have gone quiet, judged one at a time.
 *
 * An earlier version applied one learned threshold to the whole roster and
 * flagged a third of it — which is not a finding, it is a filter, and an owner
 * shown thirty-one names acts on none of them. Comparing each person against
 * their *own* rhythm is both more defensible and far more selective: someone who
 * comes fortnightly is not missing at three weeks, and someone who came daily is
 * missing at four days.
 */
function quietRegulars({ profile, data, index, now }: Ctx): Insight | null {
  if (profile.shape.engagementFreq === 'low') return null;

  // A settled routine is the precondition. Without it there is no "normal" to
  // have departed from, and a new joiner who came twice is not lapsing.
  const drifting = atRiskParties(data, index, now, 0.5).filter((read) => {
    const visits = index.engagementsByParty.get(read.partyId) ?? [];
    return visits.length >= 4 && read.typicalGap !== null;
  });
  if (drifting.length < 3) return null;

  const term = profile.vocabulary.party.many.toLowerCase();

  /*
    Anyone already reached out to drops off the action list. They are still
    quiet — the finding is unchanged — but asking again for someone contacted
    two days ago is the app forgetting what you just did for it.
  */
  const reached = recentlyContacted(data, now);
  const toContact = drifting.filter(
    (r) => index.partyById.get(r.partyId)?.contactable !== false && !reached.has(r.partyId),
  );
  const waiting = drifting.filter((r) => reached.has(r.partyId)).length;

  const worst = drifting[0];
  const medianGap =
    drifting.reduce((s, r) => s + (r.typicalGap ?? 0), 0) / drifting.length;

  /*
    Everyone has been contacted and none of them are back yet. That is a
    different situation from "nobody has been contacted", and saying so is the
    difference between the app acknowledging the work and repeating the demand.
  */
  if (toContact.length === 0 && waiting > 0) {
    return {
      id: 'quiet-regulars',
      family: 'lapse',
      story: 'attrition',
      title: `You have reached out to all ${waiting} — none are back yet`,
      detail:
        `Give it a fortnight. Anyone still away after that will come back onto this list as a fresh ` +
        `finding, and the outcome report will tell you how many of these returned so you know whether ` +
        `the approach worked at all.`,
      tone: 'neutral',
      evidence: { label: 'See who', href: '/segments?id=lapsing' },
      score: score({ surprise: 0.4, materiality: 0.5, actionability: 0.3 }),
    };
  }

  return {
    id: 'quiet-regulars',
    family: 'lapse',
    story: 'attrition',
    title: `${drifting.length} ${term} have stopped coming as often as they used to`,
    detail:
      `Each is measured against their own rhythm, not a fixed number of days — these were coming about every ` +
      `${Math.round(medianGap)} days and have now been away far longer. ${index.partyById.get(worst.partyId)?.name ?? 'One'} ` +
      `is the furthest gone at ${worst.daysSinceSeen} days. Nobody has cancelled; this is what leaving looks like ` +
      `before it becomes official.` +
      (waiting > 0 ? ` ${waiting} of them you have already contacted, so they are left off the list below.` : ''),
    action: toContact.length
      ? {
          label: `Check in with ${Math.min(toContact.length, 8)}`,
          partyIds: toContact.slice(0, 8).map((r) => r.partyId),
          kind: 'contact',
        }
      : undefined,
    tone: 'attention',
    evidence: { label: 'See who', href: '/segments?id=lapsing' },
    score: score({
      surprise: 0.6,
      materiality: relative(drifting.length, Math.max(data.parties.length * 0.12, 4)),
      actionability: 0.9,
    }),
  };
}

function newcomersStalling({ profile, data, index, now }: Ctx): Insight | null {
  const reached = recentlyContacted(data, now);
  const reads = firstNinetyDays(data, index, now).filter(
    (r) => r.daysIn >= 10 && !r.onTrack && r.benchmark > 0 && !reached.has(r.party.id),
  );
  if (reads.length < 2) return null;

  const term = profile.vocabulary.party.many.toLowerCase();
  const worst = reads[0];

  return {
    id: 'newcomers-stalling',
    family: 'onboarding',
    title: `${reads.length} new ${term} are behind where people who stayed had got to`,
    detail:
      `By day ${worst.daysIn}, ${term} who are still with you a year later had been in ${worst.benchmark} times. ` +
      `These have managed ${worst.visits}. The first few weeks decide the next few years, and this is the ` +
      `window where a nudge still works.`,
    action: {
      label: `Welcome ${Math.min(reads.length, 6)}`,
      partyIds: reads.slice(0, 6).map((r) => r.party.id),
      kind: 'contact',
    },
    tone: 'attention',
    score: score({
      surprise: 0.55,
      materiality: relative(reads.length, Math.max(data.parties.length * 0.1, 3)),
      actionability: 0.95,
    }),
  };
}

function cohortDecay({ profile, data, index, now }: Ctx): Insight | null {
  const groups = cohorts(data, index, now, 3).filter((c) => c.size >= 4 && c.retention.length >= 3);
  if (groups.length < 4) return null;

  const recent = groups.slice(-2);
  const older = groups.slice(0, -2);
  const at3 = (list: typeof groups) =>
    list.reduce((s, c) => s + (c.retention[2] ?? 0), 0) / Math.max(list.length, 1);

  const recentRate = at3(recent);
  const olderRate = at3(older);
  if (olderRate <= 0) return null;

  const drop = (olderRate - recentRate) / olderRate;
  if (drop < 0.25) return null;

  return {
    id: 'cohort-decay',
    family: 'retention',
    story: 'attrition',
    title: `People who joined recently are sticking around less than people who joined earlier`,
    detail:
      `Three months in, ${Math.round(recentRate * 100)}% of your newest joiners are still coming, against ` +
      `${Math.round(olderRate * 100)}% of earlier ones. Something about the arrival experience has changed — ` +
      `the total headcount will not show this for months.`,
    tone: 'attention',
    evidence: { label: 'See the cohorts', href: '/(tabs)/insights' },
    score: score({
      surprise: Math.min(drop / 0.6, 1),
      materiality: 0.8,
      actionability: 0.5,
    }),
  };
}

/* -------------------------------------------------------------- receivables */

function concentratedDebt({ profile, data, index }: Ctx): Insight | null {
  if (profile.shape.paymentTiming !== 'after') return null;

  const total = outstanding(data);
  if (total <= 0) return null;

  const byParty = new Map<string, number>();
  for (const m of data.money) {
    if (m.direction !== 'in' || m.status !== 'due' || !m.partyId) continue;
    byParty.set(m.partyId, (byParty.get(m.partyId) ?? 0) + m.amount);
  }
  const ranked = [...byParty.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;

  const [topId, topAmount] = ranked[0];
  const share = topAmount / total;
  // Only interesting when it is concentrated. Debt spread evenly across fifty
  // people is a different problem and not this insight.
  if (share < 0.3) return null;

  const party = index.partyById.get(topId);
  return {
    id: 'concentrated-debt',
    family: 'receivables',
    story: 'money-owed',
    title: `${Math.round(share * 100)}% of what you are owed is from one ${profile.vocabulary.party.one.toLowerCase()}`,
    detail:
      `${party?.name ?? 'One account'} owes ${money(topAmount)} of ${money(total)} outstanding. ` +
      `Chasing everyone equally spends the same effort on the other ${ranked.length - 1}.`,
    action: { label: 'Chase this first', partyIds: [topId], kind: 'collect' },
    tone: 'attention',
    score: score({ surprise: Math.min(share / 0.6, 1), materiality: 0.85, actionability: 0.95 }),
  };
}

function agingDebt({ profile, data, index, now }: Ctx): Insight | null {
  if (profile.shape.paymentTiming !== 'after') return null;

  const buckets = agingBuckets(data, now);
  const old = buckets[buckets.length - 1];
  const total = buckets.reduce((s, b) => s + b.amount, 0);
  if (old.amount <= 0 || total <= 0) return null;

  const share = old.amount / total;
  if (old.count < 2 && share < 0.25) return null;

  const ids = data.money
    .filter(
      (m) =>
        m.direction === 'in' &&
        m.status === 'due' &&
        (now - (m.dueAt ?? m.at)) / DAY > 60 &&
        m.partyId,
    )
    .map((m) => m.partyId as string);

  return {
    id: 'aging-debt',
    family: 'receivables',
    story: 'money-owed',
    title: `${money(old.amount)} has been owed for more than two months`,
    detail:
      `${old.count} entries, ${Math.round(share * 100)}% of everything outstanding. Debt this old rarely ` +
      `settles on its own — the longer it sits the less likely it is to arrive at all, and the more awkward ` +
      `the conversation gets.`,
    action: { label: `Chase ${new Set(ids).size}`, partyIds: [...new Set(ids)], kind: 'collect' },
    tone: 'attention',
    score: score({ surprise: 0.65, materiality: Math.min(share * 1.4, 1), actionability: 0.9 }),
  };
}

/* ------------------------------------------------------------------ money -- */

function revenueTrend({ profile, data, now }: Ctx): Insight | null {
  const thisPeriod = revenueBetween(data, now - 28 * DAY, now);
  const lastPeriod = revenueBetween(data, now - 56 * DAY, now - 28 * DAY);
  if (lastPeriod <= 0) return null;

  const delta = (thisPeriod - lastPeriod) / lastPeriod;
  // Under 12% either way is inside ordinary month-to-month noise for a small
  // business, and saying so would train the owner to ignore this card.
  if (Math.abs(delta) < 0.12) return null;

  const up = delta > 0;
  return {
    id: 'revenue-trend',
    family: 'revenue-trend',
    // A fall in takings is usually the visible half of attrition, so it competes
    // with the lapse finding rather than accompanying it.
    story: up ? 'growth' : 'attrition',
    title: `Takings are ${up ? 'up' : 'down'} ${Math.round(Math.abs(delta) * 100)}% on the previous four weeks`,
    detail: `${money(thisPeriod)} against ${money(lastPeriod)}. ${
      up
        ? 'Worth knowing what changed, so it can be repeated.'
        : 'Worth checking whether it is fewer people or smaller amounts.'
    }`,
    tone: up ? 'good' : 'attention',
    evidence: { label: 'Break it down', href: '/(tabs)/money' },
    score: score({
      surprise: Math.min(Math.abs(delta) / 0.4, 1),
      materiality: 0.9,
      // Informative rather than immediately actionable — deliberately scored
      // below anything with a list of names attached.
      actionability: up ? 0.35 : 0.55,
    }),
  };
}

function breakEvenRisk({ profile, data, now }: Ctx): Insight | null {
  const be = breakEven(data, now);
  if (be.monthlyFixed <= 0) return null;

  const dayOfMonth = new Date(now).getDate();
  if (dayOfMonth < 12) return null; // too early to call
  if (be.covered) return null;

  const daysLeft = 30 - dayOfMonth;
  const perDayNeeded = be.remaining / Math.max(daysLeft, 1);
  const perDaySoFar = be.collectedThisMonth / dayOfMonth;
  if (perDaySoFar <= 0) return null;
  if (perDaySoFar >= perDayNeeded) return null;

  return {
    id: 'break-even-risk',
    family: 'break-even',
    title: `On this pace you will finish the month ${money(be.remaining - perDaySoFar * daysLeft)} short of costs`,
    detail:
      `Fixed costs are ${money(be.monthlyFixed)} a month. You have collected ${money(be.collectedThisMonth)} in ` +
      `${dayOfMonth} days, which needs to become ${money(perDayNeeded)} a day for the rest of the month against ` +
      `the ${money(perDaySoFar)} you are averaging.`,
    tone: 'attention',
    evidence: { label: 'See the costs', href: '/(tabs)/money' },
    score: score({ surprise: 0.7, materiality: 0.95, actionability: 0.6 }),
  };
}

function concentrationRisk({ profile, data, index, now }: Ctx): Insight | null {
  const live = data.parties.filter((p) => !p.archivedAt);
  if (live.length < 8) return null;

  const values = live
    .map((p) => ({ p, v: partyValue(index, p.id, now).runRate }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);
  const total = values.reduce((s, x) => s + x.v, 0);
  if (total <= 0 || values.length < 5) return null;

  const top = values[0];
  const share = top.v / total;
  if (share < 0.2) return null;

  return {
    id: 'concentration-risk',
    family: 'concentration',
    title: `${top.p.name} alone is ${Math.round(share * 100)}% of your income`,
    detail:
      `At the current rate they are worth ${money(top.v)} a year out of ${money(total)}. That is fine until ` +
      `it is not — one person leaving would take a fifth of the business with them.`,
    tone: 'neutral',
    score: score({ surprise: Math.min(share / 0.45, 1), materiality: 0.75, actionability: 0.3 }),
  };
}

/* --------------------------------------------------------------- capacity -- */

function busiestDay({ profile, data, now }: Ctx): Insight | null {
  if (!profile.shape.capacityBound) return null;

  const recent = engagementsBetween(data, now - 56 * DAY, now);
  if (recent.length < 20) return null;

  const byWeekday = new Array(7).fill(0);
  for (const e of recent) byWeekday[new Date(e.at).getDay()] += 1;

  const mean = recent.length / 7;
  let peak = 0;
  for (let i = 1; i < 7; i++) if (byWeekday[i] > byWeekday[peak]) peak = i;

  const excess = (byWeekday[peak] - mean) / mean;
  if (excess < 0.45) return null;

  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return {
    id: 'busiest-day',
    family: 'capacity',
    story: 'capacity',
    title: `${names[peak]} runs ${Math.round(excess * 100)}% busier than an average day`,
    detail:
      `${byWeekday[peak]} ${plural(byWeekday[peak], profile.vocabulary.engagement).toLowerCase()} over eight weeks, against ` +
      `${Math.round(mean)} on a typical day. If anyone is being turned away, that is when.`,
    tone: 'neutral',
    evidence: { label: 'See the week', href: '/capacity' },
    score: score({ surprise: Math.min(excess / 0.9, 1), materiality: 0.5, actionability: 0.4 }),
  };
}

function deadHours({ profile, data, now }: Ctx): Insight | null {
  if (!profile.shape.capacityBound) return null;

  const cells = capacityGrid(data, now);
  if (cells.length < 10) return null;

  const total = cells.reduce((s, c) => s + c.count, 0);
  if (total < 40) return null;

  const busiest = cells[0];
  const quietOpen = cells.filter((c) => c.count > 0 && c.count <= Math.max(busiest.count * 0.15, 1));
  if (quietOpen.length < 3) return null;

  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hour = (h: number) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm');

  return {
    id: 'dead-hours',
    family: 'capacity',
    story: 'capacity',
    title: `${quietOpen.length} hours a week are running nearly empty`,
    detail:
      `${names[quietOpen[0].weekday]} ${hour(quietOpen[0].hour)} and ${quietOpen.length - 1} others sit at a ` +
      `fraction of ${names[busiest.weekday]} ${hour(busiest.hour)}. You are paying rent for all of them equally.`,
    tone: 'neutral',
    evidence: { label: 'See the heatmap', href: '/capacity' },
    score: score({ surprise: 0.5, materiality: 0.6, actionability: 0.45 }),
  };
}

function noShowCost({ profile, data, now }: Ctx): Insight | null {
  const read = noShows(data, now);
  if (read.count < 3 || read.rate < 0.05) return null;

  return {
    id: 'no-show-cost',
    family: 'no-shows',
    title: `${read.count} no-shows in eight weeks — about ${Math.round(read.rate * 100)}% of bookings`,
    detail:
      read.cost > 0
        ? `Roughly ${money(read.cost)} of slots that were held and not used. A slot nobody turns up for costs ` +
          `more than an empty one, because somebody else could have had it.`
        : `A slot nobody turns up for costs more than an empty one, because somebody else could have had it.`,
    tone: 'attention',
    score: score({ surprise: Math.min(read.rate / 0.15, 1), materiality: 0.55, actionability: 0.6 }),
  };
}

/* ---------------------------------------------------------------- growth -- */

function referralEngine({ profile, data, index, now }: Ctx): Insight | null {
  const graph = referralGraph(data, index, now);
  if (graph.length === 0) return null;

  const top = graph[0];
  if (top.broughtIn < 2) return null;

  const totalReferred = graph.reduce((s, n) => s + n.broughtIn, 0);
  const share = totalReferred / Math.max(data.parties.length, 1);

  return {
    id: 'referral-engine',
    family: 'referral',
    title: `${top.name} has brought you ${top.broughtIn} ${top.broughtIn === 1 ? profile.vocabulary.party.one.toLowerCase() : profile.vocabulary.party.many.toLowerCase()}`,
    detail:
      `Worth ${money(top.value)} between them. ${Math.round(share * 100)}% of everyone on your books arrived ` +
      `through somebody already here — cheaper than any advertising you could buy, and nobody has ever thanked them for it.`,
    action: { label: `Thank ${top.name.split(' ')[0]}`, partyIds: [top.partyId], kind: 'contact' },
    tone: 'good',
    score: score({ surprise: 0.5, materiality: Math.min(share * 3, 1), actionability: 0.8 }),
  };
}

function goodStreak({ profile, data, now }: Ctx): Insight | null {
  const dayStart = startOfDay(now);
  const weekday = new Date(now).getDay();

  const today = revenueBetween(data, dayStart, now);
  if (today <= 0) return null;

  const past: number[] = [];
  for (let w = 1; w <= 8; w++) {
    const ref = dayStart - w * 7 * DAY;
    past.push(revenueBetween(data, ref, ref + DAY));
  }
  const best = Math.max(...past);
  if (best <= 0 || today <= best) return null;

  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return {
    id: 'record-day',
    family: 'milestone',
    story: 'growth',
    title: `Best ${names[weekday]} in two months`,
    detail: `${money(today)} so far, against ${money(best)} on your best ${names[weekday]} since ${formatDayMonth(dayStart - 56 * DAY)}.`,
    tone: 'good',
    score: score({ surprise: 0.55, materiality: 0.45, actionability: 0.4 }),
  };
}

/* ---------------------------------------------------------------- memory -- */

function reconcileFacts({ profile, data, now }: Ctx): Insight | null {
  const pairs = reconcile(data, now).filter((p) => p.reconcile);
  if (pairs.length === 0) return null;

  const pair = pairs[0];
  return {
    id: `reconcile-${pair.key}`,
    family: 'memory',
    title: pair.reconcile as string,
    detail:
      `This is the difference between the business you described at setup and the one your records describe. ` +
      `Neither is necessarily wrong — but if the records are incomplete, everything else on these screens is ` +
      `working from a partial picture.`,
    tone: 'neutral',
    evidence: { label: 'What it knows', href: '/memory' },
    score: score({
      surprise: Math.min(Math.abs(pair.gap ?? 0) / 0.6, 1),
      materiality: 0.7,
      actionability: 0.5,
    }),
  };
}

function driftInsight({ profile, data, now }: Ctx): Insight | null {
  const drift = detectDrift(profile, data, now);
  if (drift.length === 0) return null;

  const first = drift[0];
  return {
    id: `drift-${first.key}`,
    family: 'drift',
    title: `Your business has changed shape since you set this up`,
    detail: `${first.label}: you described it as ${first.was}, and the records now say ${first.now}. ${first.proposal}`,
    tone: 'neutral',
    evidence: { label: 'Review the setup', href: '/memory' },
    score: score({ surprise: 0.85, materiality: 0.7, actionability: 0.7 }),
  };
}

function anniversaryInsight({ data, now }: Ctx): Insight | null {
  const hits = anniversaries(data, now);
  if (hits.length === 0) return null;

  const hit = hits[0];
  return {
    id: `anniversary-${hit.id}`,
    family: 'anniversary',
    title: `This happened around now last year too`,
    detail: `${hit.label}, on ${formatDateFull(hit.at)}. Worth knowing before you treat this year's version as a surprise.`,
    tone: 'neutral',
    score: score({ surprise: 0.6, materiality: 0.5, actionability: 0.4 }),
  };
}

/* --------------------------------------------------------------- outcomes -- */

/**
 * What happened after the owner did what was suggested.
 *
 * The single most important generator in this file. Everything else asks for
 * effort; this is the only one that reports back on effort already spent, and
 * without it the product has no way to earn trust beyond sounding plausible.
 */
function outcomeReport({ profile, data, index, now }: Ctx): Insight | null {
  const ripe = data.actions.filter(
    (a) =>
      a.outcome === 'done' &&
      a.kind === 'contact' &&
      a.completedAt != null &&
      now - (a.completedAt as number) >= 10 * DAY &&
      now - (a.completedAt as number) <= 45 * DAY &&
      a.reviewedAt == null &&
      a.partyIds.length > 0,
  );
  if (ripe.length === 0) return null;

  const action = ripe.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
  const since = action.completedAt as number;

  const returned = action.partyIds.filter((id) => {
    const seen = index.lastSeen.get(id);
    return seen !== undefined && seen >= since;
  });

  const rate = returned.length / action.partyIds.length;
  const value = returned.reduce((s, id) => s + partyValue(index, id, now).runRate * 0.25, 0);

  return {
    id: `outcome-${action.id}`,
    family: 'outcome',
    title:
      returned.length === 0
        ? `None of the ${action.partyIds.length} you contacted have come back`
        : `${returned.length} of the ${action.partyIds.length} you contacted came back`,
    detail:
      returned.length === 0
        ? `You did "${action.label}" on ${formatDayMonth(since)}. Nobody has been in since. Worth knowing that this particular approach did not work rather than assuming it did.`
        : `You did "${action.label}" on ${formatDayMonth(since)}. ${Math.round(rate * 100)}% came back — worth roughly ${money(value)} over a quarter. This is what that half hour bought.`,
    tone: returned.length === 0 ? 'neutral' : 'good',
    score: score({ surprise: 0.7, materiality: 0.8, actionability: 0.6 }),
  };
}

function counterfactualInsight({ profile, data, index, now }: Ctx): Insight | null {
  const list = counterfactuals(profile, data, now, index);
  if (list.length === 0) return null;

  const cf = list[0];
  return {
    id: 'counterfactual',
    family: 'counterfactual',
    title: cf.headline,
    detail: cf.detail,
    tone: 'attention',
    score: score({ surprise: 0.75, materiality: 0.8, actionability: 0.45 }),
  };
}

/* ------------------------------------------------------------ obligations -- */

function obligationDue({ data, now }: Ctx): Insight | null {
  const pending = data.obligations
    .filter((o) => !o.done && o.dueAt <= now + (o.leadDays ?? 3) * DAY)
    .sort((a, b) => a.dueAt - b.dueAt);
  if (pending.length === 0) return null;

  const next = pending[0];
  const days = Math.ceil((next.dueAt - now) / DAY);

  return {
    id: `obligation-${next.id}`,
    family: 'obligation',
    title:
      days < 0
        ? `${next.label} is ${Math.abs(days)} days overdue`
        : days === 0
          ? `${next.label} is due today`
          : `${next.label} is due in ${days} days`,
    detail:
      pending.length > 1
        ? `${pending.length - 1} other thing${pending.length === 2 ? '' : 's'} also coming up. These are the ones that cost money for being late rather than for being wrong.`
        : `Flagged early on purpose — these cost money for being late rather than for being wrong.`,
    tone: days <= 0 ? 'attention' : 'neutral',
    evidence: { label: 'See all', href: '/obligations' },
    score: score({
      surprise: 0.5,
      materiality: next.amount ? 0.8 : 0.55,
      actionability: 1,
    }),
  };
}

/* ----------------------------------------------------------------- ranking */

/** Below this an insight is not worth the space it would take. */
const FLOOR = 0.12;

/** Hard budget. Anyone can generate a hundred observations; the product is the ninety-eight it refuses to show. */
const BUDGET = 2;

const GENERATORS: ((ctx: Ctx) => Insight | null)[] = [
  outcomeReport,
  expiringAndQuiet,
  quietRegulars,
  newcomersStalling,
  concentratedDebt,
  agingDebt,
  breakEvenRisk,
  obligationDue,
  counterfactualInsight,
  driftInsight,
  revenueTrend,
  cohortDecay,
  noShowCost,
  referralEngine,
  concentrationRisk,
  busiestDay,
  deadHours,
  goodStreak,
  reconcileFacts,
  anniversaryInsight,
];

export function generateInsights(
  profile: BusinessProfile,
  data: BusinessData,
  options: { now?: number; muted?: string[]; limit?: number; index?: Index } = {},
): Insight[] {
  const now = options.now ?? Date.now();
  const muted = new Set(options.muted ?? []);
  // The home screen keeps the hard budget; a screen the owner opened on purpose
  // to read findings can show more without becoming noise.
  const limit = options.limit ?? BUDGET;

  const ctx: Ctx = {
    profile,
    data,
    index: options.index ?? buildIndex(data),
    now,
  };

  const candidates = GENERATORS.map((generate) => {
    try {
      return generate(ctx);
    } catch {
      // One bad generator must never blank the whole screen. A missing finding
      // is a gap; a crashed home screen is the app being broken.
      return null;
    }
  }).filter((i): i is Insight => i !== null);

  // Snoozed and dismissed families stay suppressed until their snooze expires.
  const snoozed = new Set(
    data.actions
      .filter((a) => a.snoozedUntil && a.snoozedUntil > now && a.insightId)
      .map((a) => a.insightId as string),
  );

  const eligible = candidates.filter(
    (i) => !muted.has(i.family) && !snoozed.has(i.id) && i.score >= FLOOR,
  );

  // One finding per story, and within a story the one carrying an action wins
  // outright rather than on score. Cause and effect often land within a hundredth
  // of each other, and the tie should never be settled in favour of the version
  // the owner cannot do anything about.
  const best = new Map<string, Insight>();
  const standalone: Insight[] = [];

  for (const insight of eligible) {
    if (!insight.story) {
      standalone.push(insight);
      continue;
    }
    const held = best.get(insight.story);
    if (!held) {
      best.set(insight.story, insight);
      continue;
    }
    const heldActionable = Boolean(held.action);
    const nextActionable = Boolean(insight.action);
    if (nextActionable !== heldActionable) {
      if (nextActionable) best.set(insight.story, insight);
    } else if (insight.score > held.score) {
      best.set(insight.story, insight);
    }
  }

  const ranked = [...best.values(), ...standalone].sort((a, b) => b.score - a.score);

  // At the home-screen budget, never spend both slots on bad news. An app that
  // opens with two problems every morning gets closed before it is read.
  if (limit <= 2 && ranked.length > limit) {
    const attention = ranked.filter((i) => i.tone === 'attention');
    const other = ranked.filter((i) => i.tone !== 'attention');
    if (attention.length >= limit && other.length > 0) {
      return [...attention.slice(0, limit - 1), other[0]].sort((a, b) => b.score - a.score);
    }
  }

  return ranked.slice(0, limit);
}
