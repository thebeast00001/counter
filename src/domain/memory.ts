import { monthKey, startOfDay } from '@/domain/analytics';
import { money } from '@/domain/metrics';
import type { BusinessData, BusinessProfile, EventNote, MemoryFact } from '@/domain/model';

/**
 * What the system remembers about this business, and how sure it is.
 *
 * The moat is not the insight engine — anyone can write one of those in a
 * fortnight. It is that after a year this file knows things about the business
 * that no competitor's fresh install can know, and that the owner would have to
 * re-teach from scratch to leave. Three mechanisms build that: the gap between
 * what was declared and what is observed, corrections that outrank both, and a
 * dated log of things that happened so movements have explanations attached.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Facts older than this stop being asserted without being re-checked. */
const HALF_LIFE_DAYS = 120;

/**
 * Confidence, decayed by age.
 *
 * A business changes. "You have 120 students" was true when it was said and may
 * be nonsense eight months later, so an old fact quietly loses standing rather
 * than being repeated with the same certainty forever.
 */
export function currentConfidence(fact: MemoryFact, now: number): number {
  const ageDays = (now - fact.at) / DAY;
  if (fact.origin === 'observed') return fact.confidence; // recomputed, never stale
  const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  return fact.confidence * decay;
}

export type FactPair = {
  key: string;
  label: string;
  declared: MemoryFact | null;
  observed: MemoryFact | null;
  corrected: MemoryFact | null;
  /** Signed relative gap between declared and observed, null when incomparable. */
  gap: number | null;
  /** Set when the gap is large enough to be worth raising. */
  reconcile?: string;
};

const FACT_LABELS: Record<string, string> = {
  'party-count': 'How many people you have',
  'typical-fee': 'What you usually charge',
  'busiest-day': 'Your busiest day',
  'quiet-threshold': 'When someone counts as gone quiet',
  'monthly-revenue': 'What you take in a month',
  'staff-count': 'How many people work with you',
};

/**
 * Pairs each fact's declared and observed versions.
 *
 * The gap is the product. "You said 120, the records show 90" is more useful
 * than either number alone — it is usually the first moment an owner realises
 * the business they describe and the business they run have drifted apart.
 */
export function reconcile(data: BusinessData, now = Date.now()): FactPair[] {
  const byKey = new Map<string, MemoryFact[]>();
  for (const f of data.facts) {
    const list = byKey.get(f.key);
    if (list) list.push(f);
    else byKey.set(f.key, [f]);
  }

  const out: FactPair[] = [];
  for (const [key, facts] of byKey) {
    const newest = (origin: MemoryFact['origin']) =>
      facts.filter((f) => f.origin === origin).sort((a, b) => b.at - a.at)[0] ?? null;

    const declared = newest('declared');
    const observed = newest('observed');
    const corrected = newest('corrected');

    let gap: number | null = null;
    if (declared?.numeric != null && observed?.numeric != null && declared.numeric !== 0) {
      gap = (observed.numeric - declared.numeric) / declared.numeric;
    }

    let reconcileText: string | undefined;
    // A fifth out is where the difference stops being rounding and starts being
    // a different business. Below that, saying anything is pedantry.
    if (gap !== null && Math.abs(gap) >= 0.2 && currentConfidence(declared as MemoryFact, now) > 0.3) {
      reconcileText =
        gap < 0
          ? `You said ${declared?.value}, the records show ${observed?.value}. Either some are not being recorded, or there are fewer than you think.`
          : `You said ${declared?.value}, the records show ${observed?.value} — more than you thought.`;
    }

    out.push({
      key,
      label: FACT_LABELS[key] ?? key,
      declared,
      observed,
      corrected,
      gap,
      reconcile: reconcileText,
    });
  }

  return out.sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0));
}

/**
 * Recomputes every observed fact from the records.
 *
 * Cheap enough to run on every mutation, and doing so is what keeps the observed
 * side honest without a background job the offline app has no way to schedule.
 */
export function observeFacts(
  profile: BusinessProfile,
  data: BusinessData,
  now = Date.now(),
): MemoryFact[] {
  const facts: MemoryFact[] = [];

  const push = (key: string, value: string, numeric: number | null) =>
    facts.push({
      id: `obs-${key}`,
      key,
      origin: 'observed',
      value,
      numeric,
      at: now,
      confidence: 1,
    });

  const live = data.parties.filter((p) => !p.archivedAt);
  push('party-count', String(live.length), live.length);

  if (data.staff.length > 0) {
    push('staff-count', String(data.staff.filter((s) => s.active !== false).length), data.staff.length);
  }

  const settled = data.money.filter((m) => m.direction === 'in' && m.status === 'settled');
  if (settled.length >= 8) {
    const amounts = settled.map((m) => m.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    push('typical-fee', money(median), median);

    const months = new Set(settled.map((m) => monthKey(m.at))).size || 1;
    const perMonth = settled.reduce((s, m) => s + m.amount, 0) / months;
    push('monthly-revenue', money(perMonth), perMonth);
  }

  const recent = data.engagements.filter((e) => e.at >= now - 56 * DAY && !e.noShow);
  if (recent.length >= 20) {
    const byWeekday = new Array(7).fill(0);
    for (const e of recent) byWeekday[new Date(e.at).getDay()] += 1;
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let peak = 0;
    for (let i = 1; i < 7; i++) if (byWeekday[i] > byWeekday[peak]) peak = i;
    push('busiest-day', names[peak], peak);
  }

  return facts;
}

/** Replaces the observed facts, leaving declared and corrected ones untouched. */
export function refreshObserved(
  profile: BusinessProfile,
  data: BusinessData,
  now = Date.now(),
): MemoryFact[] {
  const kept = data.facts.filter((f) => f.origin !== 'observed');
  return [...kept, ...observeFacts(profile, data, now)];
}

/* ---------------------------------------------------------------- events -- */

/**
 * Finds dated step-changes worth annotating a chart with.
 *
 * Only large, sustained moves qualify. A chart covered in markers explains
 * nothing — the point is that the two or three annotations that survive are the
 * ones the owner will recognise as real.
 */
export function detectEvents(data: BusinessData, now = Date.now()): EventNote[] {
  const out: EventNote[] = [];

  // Weekly takings, oldest first.
  const weeks: { at: number; total: number }[] = [];
  for (let w = 25; w >= 0; w--) {
    const to = now - w * 7 * DAY;
    const from = to - 7 * DAY;
    weeks.push({
      at: from,
      total: data.money
        .filter((m) => m.direction === 'in' && m.status === 'settled' && m.at >= from && m.at < to)
        .reduce((s, m) => s + m.amount, 0),
    });
  }

  for (let i = 4; i < weeks.length - 4; i++) {
    const before = weeks.slice(i - 4, i).reduce((s, w) => s + w.total, 0) / 4;
    const after = weeks.slice(i, i + 4).reduce((s, w) => s + w.total, 0) / 4;
    if (before <= 0) continue;
    const change = (after - before) / before;
    if (Math.abs(change) < 0.3) continue;

    // Keep only the strongest marker in any six-week neighbourhood.
    const clash = out.find((e) => Math.abs(e.at - weeks[i].at) < 42 * DAY);
    if (clash) continue;

    out.push({
      id: `ev-detected-${weeks[i].at}`,
      at: weeks[i].at,
      label: `Takings stepped ${change > 0 ? 'up' : 'down'} about ${Math.round(Math.abs(change) * 100)}%`,
      origin: 'detected',
      basis: 'weekly takings',
    });
  }

  return out;
}

/**
 * Things that happened around this date in previous years.
 *
 * The kind of recall a long-serving manager has and software normally does not:
 * "it went quiet around this time last year too" turns a panic into a pattern.
 */
export function anniversaries(data: BusinessData, now = Date.now()): EventNote[] {
  const thisMonth = new Date(now).getMonth();
  const thisDate = new Date(now).getDate();

  return data.events.filter((e) => {
    const d = new Date(e.at);
    if (now - e.at < 300 * DAY) return false; // not yet a year old
    return d.getMonth() === thisMonth && Math.abs(d.getDate() - thisDate) <= 7;
  });
}

/* ----------------------------------------------------- explanation memory -- */

/**
 * Whether a given explanation has already been shown.
 *
 * Repeating "this is scored on how unusual it is" every single time is how an
 * app teaches people to skip its own text. Once read, it collapses to a link.
 */
export function hasExplained(data: BusinessData, key: string): boolean {
  return data.facts.some((f) => f.key === `explained:${key}`);
}

export function markExplained(key: string, now = Date.now()): MemoryFact {
  return {
    id: `explained-${key}`,
    key: `explained:${key}`,
    origin: 'observed',
    value: 'shown',
    numeric: null,
    at: now,
    confidence: 1,
  };
}

/* -------------------------------------------------------- zero-typing day -- */

export type CaptureRead = {
  /** Share of the last 30 days' records that arrived without being typed. */
  automatic: number;
  manual: number;
  total: number;
  /** Days in the window where nothing had to be typed at all. */
  zeroTypingDays: number;
};

/**
 * How much of the record-keeping is happening without the owner.
 *
 * The honest measure of whether the product is delivering its actual promise.
 * Everything else is a proxy for this.
 */
export function captureRead(data: BusinessData, now = Date.now()): CaptureRead {
  /*
    Thirty *calendar days*, not thirty times twenty-four hours.
    `now - 30 * DAY` lands in the middle of the thirty-first day back, so the
    window touched thirty-one day buckets and `zeroTypingDays` could report 31
    out of 30 — which is how this was noticed. Starting at the beginning of the
    twenty-ninth day back covers today plus twenty-nine, exactly thirty.
  */
  const from = startOfDay(now - 29 * DAY);
  const window = data.engagements.filter((e) => e.at >= from && e.at <= now);
  const automatic = window.filter((e) => e.source && e.source !== 'manual').length;
  const manual = window.length - automatic;

  const byDay = new Map<number, { manual: number; total: number }>();
  for (const e of window) {
    const day = startOfDay(e.at);
    const entry = byDay.get(day) ?? { manual: 0, total: 0 };
    entry.total += 1;
    if (!e.source || e.source === 'manual') entry.manual += 1;
    byDay.set(day, entry);
  }

  let zero = 0;
  for (const entry of byDay.values()) if (entry.total > 0 && entry.manual === 0) zero += 1;

  return {
    automatic,
    manual,
    total: window.length,
    zeroTypingDays: zero,
  };
}
