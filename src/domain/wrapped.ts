import { buildIndex, monthKey, startOfMonth, type Index } from '@/domain/analytics';
import { money } from '@/domain/metrics';
import type { BusinessData, BusinessProfile } from '@/domain/model';
import { plural } from '@/domain/words';
import { monthName } from '@/lib/time';

/**
 * A month, told as a story.
 *
 * Everything else in this app answers a question. This answers none — it is the
 * only screen whose job is to make an owner feel something about a stretch of
 * work they have already finished, and the only one they might plausibly show
 * somebody else.
 *
 * Two rules keep it from becoming a lie. Every card is a fact drawn from the
 * records, never an estimate or an encouragement; and a month that went badly
 * says so. A wrap that only ever congratulates is one nobody believes twice, and
 * the honest version is the one people share.
 */

const DAY = 24 * 60 * 60 * 1000;

export type WrapCard = {
  key: string;
  /** The small line above. */
  eyebrow: string;
  /** The number or name, set large. */
  headline: string;
  /** One or two sentences underneath. */
  body: string;
  tone: 'neutral' | 'good' | 'attention';
};

export type Wrapped = {
  label: string;
  from: number;
  to: number;
  cards: WrapCard[];
  /** Plain text for sharing, assembled from the same facts. */
  share: string;
  /** False when the month holds too little to be worth telling. */
  worth: boolean;
};

/** The month containing `at`, bounded to now so a partial month is honest. */
export function wrapMonth(
  profile: BusinessProfile,
  data: BusinessData,
  at: number,
  now = Date.now(),
  index?: Index,
): Wrapped {
  const idx = index ?? buildIndex(data);

  const start = startOfMonth(at);
  const nextMonth = new Date(start);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const end = Math.min(nextMonth.getTime(), now);

  const label = `${monthName(new Date(start).getMonth())} ${new Date(start).getFullYear()}`;
  const partial = end < nextMonth.getTime();

  /* ------------------------------------------------------------- takings -- */
  const takings = data.money.filter(
    (m) => m.direction === 'in' && m.status === 'settled' && m.at >= start && m.at < end,
  );
  const total = takings.reduce((s, m) => s + m.amount, 0);

  const prevStart = new Date(start);
  prevStart.setMonth(prevStart.getMonth() - 1);

  /*
    Four days against thirty-one is not a comparison.

    On the 4th of the month this card read "Down 87% on the month before",
    which is arithmetically true and says nothing about the business — every
    month collapses by that measure until roughly its last week, so the one
    figure the owner reads first is wrong for most of the time they might open
    it. A partial month is measured against the same number of days of the
    month before instead, and the sentence says which comparison it made.

    Clamped at `start` because the previous month can be the shorter one:
    thirty days into March against February would otherwise reach into March.
  */
  const prevEnd = partial
    ? Math.min(prevStart.getTime() + (end - start), start)
    : start;

  const prev = data.money
    .filter(
      (m) =>
        m.direction === 'in' &&
        m.status === 'settled' &&
        m.at >= prevStart.getTime() &&
        m.at < prevEnd,
    )
    .reduce((s, m) => s + m.amount, 0);

  const delta = prev > 0 ? (total - prev) / prev : null;
  const against = partial ? 'on the same days last month' : 'on the month before';

  /* --------------------------------------------------------------- visits -- */
  const visits = data.engagements.filter((e) => e.at >= start && e.at < end && !e.noShow);

  // Busiest single day of the month.
  const byDay = new Map<number, number>();
  for (const v of visits) {
    const day = Math.floor((v.at - start) / DAY);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];

  /* --------------------------------------------------------------- people -- */
  const joined = data.parties.filter((p) => p.joinedAt >= start && p.joinedAt < end);

  // Came back after a long absence — the most quietly satisfying thing in a
  // month and the one no other screen surfaces.
  const returned = data.parties.filter((p) => {
    const all = idx.engagementsByParty.get(p.id) ?? [];
    const inMonth = all.filter((t) => t >= start && t < end);
    if (inMonth.length === 0) return false;
    const before = all.filter((t) => t < start);
    if (before.length === 0) return false;
    const gap = (inMonth[0] - before[before.length - 1]) / DAY;
    return gap >= 30;
  });

  const top = [...data.parties]
    .map((p) => ({
      p,
      spent: takings
        .filter((m) => m.partyId === p.id)
        .reduce((s, m) => s + m.amount, 0),
    }))
    .filter((x) => x.spent > 0)
    .sort((a, b) => b.spent - a.spent)[0];

  /* ---------------------------------------------------------------- money -- */
  const spent = data.money
    .filter((m) => m.direction === 'out' && m.at >= start && m.at < end)
    .reduce((s, m) => s + m.amount, 0);

  const settled = data.money.filter(
    (m) => m.direction === 'in' && m.status === 'settled' && m.settledAt && m.dueAt &&
      m.settledAt >= start && m.settledAt < end,
  );
  const onTime = settled.filter(
    (m) => ((m.settledAt as number) - (m.dueAt as number)) / DAY <= 1,
  ).length;

  /* ---------------------------------------------------------------- cards -- */
  const cards: WrapCard[] = [];
  const partyTerm = profile.vocabulary.party;
  const visitTerm = profile.vocabulary.engagement;

  cards.push({
    key: 'takings',
    eyebrow: partial ? `${label} so far` : label,
    headline: money(total),
    body:
      delta === null
        ? `Collected across ${takings.length} payment${takings.length === 1 ? '' : 's'}.`
        : delta >= 0
          ? `Up ${Math.round(delta * 100)}% ${against}, across ${takings.length} ${plural(takings.length, { one: 'payment', many: 'payments' })}.`
          : `Down ${Math.round(Math.abs(delta) * 100)}% ${against}. Worth knowing which — fewer people, or smaller amounts.`,
    tone: delta === null ? 'neutral' : delta >= 0 ? 'good' : 'attention',
  });

  if (visits.length > 0) {
    cards.push({
      key: 'visits',
      eyebrow: `${visitTerm.many} recorded`,
      headline: String(visits.length),
      body: busiest
        ? `Your busiest day was the ${new Date(start + busiest[0] * DAY).getDate()}${ordinal(new Date(start + busiest[0] * DAY).getDate())}, with ${busiest[1]}.`
        : 'Spread evenly across the month.',
      tone: 'neutral',
    });
  }

  if (joined.length > 0) {
    cards.push({
      key: 'joined',
      eyebrow: `New ${partyTerm.many.toLowerCase()}`,
      headline: String(joined.length),
      body:
        joined.length === 1
          ? `${joined[0].name} joined you this month.`
          : `${joined.slice(0, 3).map((p) => p.name.split(' ')[0]).join(', ')}${joined.length > 3 ? ` and ${joined.length - 3} more` : ''} joined you this month.`,
      tone: 'good',
    });
  }

  if (returned.length > 0) {
    cards.push({
      key: 'returned',
      eyebrow: 'Came back',
      headline: String(returned.length),
      body: `${returned.length === 1 ? `${returned[0].name} came back` : `${returned.length} came back`} after a month or more away. That is the hardest kind of ${partyTerm.one.toLowerCase()} to win back, and you did.`,
      tone: 'good',
    });
  }

  if (top && top.spent > 0) {
    cards.push({
      key: 'top',
      eyebrow: `Your best ${partyTerm.one.toLowerCase()}`,
      headline: top.p.name,
      body: `${money(top.spent)} this month — ${Math.round((top.spent / Math.max(total, 1)) * 100)}% of everything you took.`,
      tone: 'neutral',
    });
  }

  if (spent > 0) {
    const kept = total - spent;
    // The sign belongs in the eyebrow, not the number. A headline of "-₹6.6k"
    // counts up from zero towards a negative, which reads as a glitch, and
    // "What you kept: -₹6.6k" is a sentence no one says. Naming the direction
    // above the figure lets the figure stay a plain, countable magnitude.
    cards.push({
      key: 'kept',
      eyebrow: kept >= 0 ? 'What you kept' : 'More went out than came in',
      headline: money(Math.abs(kept)),
      body:
        kept >= 0
          ? `${money(total)} in, ${money(spent)} out. This is before anything you have not recorded.`
          : `${money(total)} in, ${money(spent)} out. A month can run this way and be fine — a big restock, or fees still to arrive — but it is worth knowing which.`,
      tone: kept >= 0 ? 'good' : 'attention',
    });
  }

  if (settled.length >= 4) {
    cards.push({
      key: 'ontime',
      eyebrow: 'Paid on time',
      headline: `${Math.round((onTime / settled.length) * 100)}%`,
      body: `${onTime} of ${settled.length} payments landed on or before their date.`,
      tone: onTime / settled.length > 0.7 ? 'good' : 'attention',
    });
  }

  /* ---------------------------------------------------------------- share -- */
  const share = [
    `${profile.name} — ${label}`,
    '',
    `${money(total)} collected${delta !== null ? ` (${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}% ${against})` : ''}`,
    visits.length > 0 ? `${visits.length} ${plural(visits.length, visitTerm).toLowerCase()}` : '',
    joined.length > 0 ? `${joined.length} new ${plural(joined.length, partyTerm).toLowerCase()}` : '',
    returned.length > 0 ? `${returned.length} came back after a month away` : '',
    spent > 0
      ? total - spent >= 0
        ? `${money(total - spent)} left after ${money(spent)} of costs`
        : `${money(spent)} of costs against it`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    label,
    from: start,
    to: end,
    cards,
    share,
    // Below this there is no story, only a couple of rows — and a wrap that
    // opens on "₹0, nothing happened" is worse than no wrap.
    worth: takings.length + visits.length >= 5,
  };
}

/** Months with enough in them to be worth wrapping, newest first. */
export function wrappableMonths(data: BusinessData, now = Date.now()): number[] {
  const seen = new Set<string>();
  const out: number[] = [];

  for (const m of data.money) {
    if (m.at > now) continue;
    const key = monthKey(m.at);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(startOfMonth(m.at));
  }

  return out.sort((a, b) => b - a).slice(0, 12);
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}
