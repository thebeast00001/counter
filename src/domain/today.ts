import {
  atRiskParties,
  buildIndex,
  recentlyContacted,
  startOfDay,
  type Index,
} from '@/domain/analytics';
import { generateInsights } from '@/domain/insights';
import { money } from '@/domain/metrics';
import { plural } from '@/domain/words';
import type { BusinessData, BusinessProfile } from '@/domain/model';
import { occurrencesBetween } from '@/domain/schedule';
import { formatDayMonth, formatTime } from '@/lib/time';

/**
 * Everything the home screen needs, and nothing the insights screen wants.
 *
 * The split matters: home answers "what do I do in the next hour", insights
 * answers "what is happening to my business". Anything in this file is anchored
 * to a clock. Nothing here is allowed to appear on the insights screen, and
 * nothing from the insights engine is allowed here — that overlap is what made
 * the two screens indistinguishable.
 */

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ----------------------------------------------------------------- pulse -- */

export type Pulse = {
  /** 0..1+, today's takings against a normal same-weekday. Can exceed 1. */
  progress: number;
  todayValue: number;
  /** What this weekday usually brings by this hour. */
  normalValue: number;
  /** What this weekday usually brings in total. */
  normalFullDay: number;
  weekday: string;
  /** 'quiet' | 'normal' | 'strong' — the word the briefing uses. */
  verdict: 'quiet' | 'normal' | 'strong' | 'unknown';
  /** How many comparable past days it rests on. Below 3, the verdict is 'unknown'. */
  samples: number;
  /**
   * Whether enough of the day has passed for the comparison to mean anything.
   * False before trade normally starts, when `progress` runs against the whole
   * day rather than against this point in it.
   */
  comparableYet: boolean;
  engagementsToday: number;
  normalEngagements: number;
};

/**
 * Today against a normal version of the same weekday, at the same hour.
 *
 * Comparing to yesterday is meaningless in a business where Saturday is four
 * times Tuesday. Comparing to a whole normal day at 10am is worse — it says
 * every morning is a disaster. Both halves of that fix are what make this
 * trustworthy enough to lead the screen with.
 */
export function pulse(data: BusinessData, now: number): Pulse {
  const weekday = new Date(now).getDay();
  const dayStart = startOfDay(now);
  const hourOfDay = (now - dayStart) / (60 * 60 * 1000);

  const todayValue = data.money
    .filter((m) => m.direction === 'in' && m.status === 'settled' && m.at >= dayStart)
    .reduce((s, m) => s + m.amount, 0);
  const engagementsToday = data.engagements.filter((e) => e.at >= dayStart && !e.noShow).length;

  // The last eight matching weekdays, excluding declared closures.
  const closures = new Set(data.closures.map((c) => startOfDay(c.date)));
  const comparable: { byNow: number; full: number; visits: number }[] = [];

  for (let back = 1; back <= 10 && comparable.length < 8; back++) {
    const dayRef = dayStart - back * 7 * DAY;
    if (closures.has(dayRef)) continue;

    const full = data.money
      .filter(
        (m) =>
          m.direction === 'in' &&
          m.status === 'settled' &&
          m.at >= dayRef &&
          m.at < dayRef + DAY,
      )
      .reduce((s, m) => s + m.amount, 0);
    const byNow = data.money
      .filter(
        (m) =>
          m.direction === 'in' &&
          m.status === 'settled' &&
          m.at >= dayRef &&
          m.at < dayRef + hourOfDay * 60 * 60 * 1000,
      )
      .reduce((s, m) => s + m.amount, 0);
    const visits = data.engagements.filter(
      (e) => e.at >= dayRef && e.at < dayRef + DAY && !e.noShow,
    ).length;

    comparable.push({ byNow, full, visits });
  }

  const samples = comparable.length;
  if (samples < 3) {
    return {
      progress: 0,
      todayValue,
      normalValue: 0,
      normalFullDay: 0,
      weekday: WEEKDAY_NAMES[weekday],
      verdict: 'unknown',
      samples,
      comparableYet: false,
      engagementsToday,
      normalEngagements: 0,
    };
  }

  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  };

  const normalValue = median(comparable.map((c) => c.byNow));
  const normalFullDay = median(comparable.map((c) => c.full));
  const normalEngagements = median(comparable.map((c) => c.visits));

  /**
   * Early in the day there is nothing to compare against.
   *
   * A normal Wednesday brings nothing by 6am, so dividing by that baseline made
   * every morning read "a normal Wednesday" while the line underneath admitted
   * the normal figure was zero — the screen contradicting itself in adjacent
   * sentences. Below a twentieth of the day's usual takings the comparison is
   * not weak, it is meaningless, and the honest move is to fill the arc against
   * the whole day and decline to give a verdict.
   */
  const comparableYet = normalValue > 0 && normalValue >= normalFullDay * 0.05;

  const progress = comparableYet
    ? todayValue / normalValue
    : normalFullDay > 0
      ? todayValue / normalFullDay
      : todayValue > 0
        ? 1
        : 0;

  const verdict: Pulse['verdict'] = !comparableYet
    ? 'unknown'
    : progress < 0.7
      ? 'quiet'
      : progress > 1.3
        ? 'strong'
        : 'normal';

  return {
    progress,
    todayValue,
    normalValue,
    normalFullDay,
    weekday: WEEKDAY_NAMES[weekday],
    verdict,
    samples,
    comparableYet,
    engagementsToday,
    normalEngagements,
  };
}

/* ----------------------------------------------------------------- rings -- */

export type Ring = {
  key: 'recorded' | 'collected' | 'reached';
  label: string;
  /** 0..1, clamped. 1 means closed. */
  progress: number;
  done: number;
  target: number;
  /** One line for the deep dive, in this business's own words. */
  detail: string;
  /** True when there was never anything to do, which still counts as closed. */
  vacuous: boolean;
};

/**
 * Three loops the owner can close today.
 *
 * The single most effective retention mechanic ever shipped in a consumer app is
 * three rings you can see are open, and it works for a reason that applies
 * exactly here: an unfinished loop is the one thing a person reliably comes back
 * to close. A list of numbers has no such pull, however accurate it is.
 *
 * The three are chosen because they are the whole job of running a small
 * business on any given day — did you write down what happened, did you take the
 * money, did you speak to the people drifting away. Every other number in this
 * app is downstream of those three being done.
 *
 * A ring with nothing to do reads as closed rather than empty. Punishing an
 * owner with an open loop on a day that genuinely required nothing is how a
 * streak mechanic turns into a guilt mechanic.
 */
export function rings(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
  index?: Index,
): Ring[] {
  const idx = index ?? buildIndex(data);
  const dayStart = startOfDay(now);
  const beat = pulse(data, now);
  const visitTerm = profile.vocabulary.engagement;

  /* ------------------------------------------------------------ recorded -- */
  // Sessions that have already started today, against how many left records.
  const dueToday = occurrencesBetween(data, dayStart, now).filter((o) => !o.closed);
  const recordedToday = dueToday.filter((o) => o.recorded).length;

  const loose = data.engagements.filter((e) => e.at >= dayStart && !e.templateId).length;
  const normalCount = beat.normalEngagements;

  const recorded: Ring = dueToday.length
    ? {
        key: 'recorded',
        label: 'Recorded',
        progress: recordedToday / dueToday.length,
        done: recordedToday,
        target: dueToday.length,
        detail: `${recordedToday} of ${dueToday.length} ${dueToday.length === 1 ? 'session' : 'sessions'} that have run today have attendance against them.`,
        vacuous: false,
      }
    : {
        key: 'recorded',
        label: 'Recorded',
        // No timetable, so the target is what a normal day of this weekday brings.
        progress: normalCount > 0 ? loose / normalCount : loose > 0 ? 1 : 0,
        done: loose,
        target: Math.max(Math.round(normalCount), 0),
        detail:
          normalCount > 0
            ? `${loose} ${plural(loose, visitTerm).toLowerCase()} written down. A normal ${beat.weekday} brings about ${Math.round(normalCount)}.`
            : `${loose} ${plural(loose, visitTerm).toLowerCase()} written down today.`,
        vacuous: normalCount === 0 && loose === 0,
      };

  /* ----------------------------------------------------------- collected -- */
  const collected: Ring = {
    key: 'collected',
    label: 'Collected',
    progress: beat.normalFullDay > 0 ? beat.todayValue / beat.normalFullDay : beat.todayValue > 0 ? 1 : 0,
    done: beat.todayValue,
    target: beat.normalFullDay,
    detail:
      beat.normalFullDay > 0
        ? `${money(beat.todayValue)} in against ${money(beat.normalFullDay)} on a normal ${beat.weekday}.`
        : `${money(beat.todayValue)} in today. Not enough history yet to say what is normal.`,
    vacuous: beat.normalFullDay === 0 && beat.todayValue === 0,
  };

  /* ------------------------------------------------------------- reached -- */
  // Everyone drifting far enough to warrant a word, minus anyone already
  // contacted — the same rule the check-in list follows, so the ring and the
  // action can never disagree.
  const contacted = recentlyContacted(data, now);
  const drifting = atRiskParties(data, idx, now, 0.5).filter((r) => {
    const visits = idx.engagementsByParty.get(r.partyId) ?? [];
    return visits.length >= 4 && r.typicalGap !== null;
  });
  const outstanding = drifting.filter((r) => !contacted.has(r.partyId)).length;
  const reachedCount = drifting.length - outstanding;

  const reached: Ring = {
    key: 'reached',
    label: 'Reached',
    progress: drifting.length === 0 ? 1 : reachedCount / drifting.length,
    done: reachedCount,
    target: drifting.length,
    detail:
      drifting.length === 0
        ? 'Nobody is drifting. Nothing to chase.'
        : `${reachedCount} of ${drifting.length} drifting ${plural(drifting.length, profile.vocabulary.party).toLowerCase()} ${drifting.length === 1 ? 'has' : 'have'} been contacted.`,
    vacuous: drifting.length === 0,
  };

  return [recorded, collected, reached].map((ring) => ({
    ...ring,
    progress: Math.max(0, Math.min(ring.progress, 1)),
  }));
}

/* -------------------------------------------------------------- briefing -- */

export type Briefing = {
  /** The whole business in one sentence. */
  sentence: string;
  /** Optional second clause, only when something genuinely warrants it. */
  tone: 'calm' | 'attention' | 'good';
};

/**
 * The entire business in one sentence, rewritten every day.
 *
 * This is the product's voice. It is built as clauses rather than a template
 * because a sentence that always has the same three slots stops being read
 * within a week — the reader learns where the numbers sit and stops parsing the
 * English. Clauses are only included when they earn inclusion, so the sentence
 * changes length and rhythm from day to day.
 */
export function briefing(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
  index?: Index,
): Briefing {
  const idx = index ?? buildIndex(data);
  const p = pulse(data, now);
  const parts: string[] = [];
  let tone: Briefing['tone'] = 'calm';

  const closureToday = data.closures.find((c) => startOfDay(c.date) === startOfDay(now));
  if (closureToday) {
    return {
      sentence: `You are closed today for ${closureToday.label}. Nothing is expected.`,
      tone: 'calm',
    };
  }

  // Opening clause: how today is going.
  if (p.verdict === 'unknown') {
    const partyTerm = profile.vocabulary.party.many.toLowerCase();
    parts.push(
      data.parties.length === 0
        ? `Nothing recorded yet — add your first ${profile.vocabulary.party.one.toLowerCase()} and this fills in`
        : p.samples >= 3
          ? // Records exist, the day is simply too young to judge. Saying so beats
            // inventing a verdict the line underneath then contradicts.
            `Early yet for a ${p.weekday}`
          : `Still learning your ${WEEKDAY_NAMES[new Date(now).getDay()]}s — ${data.parties.length} ${partyTerm} on the books`,
    );
  } else if (p.verdict === 'quiet') {
    parts.push(`A quiet ${p.weekday} so far`);
    tone = 'attention';
  } else if (p.verdict === 'strong') {
    parts.push(`A strong ${p.weekday} — ${money(p.todayValue)} in already`);
    tone = 'good';
  } else {
    parts.push(`A normal ${p.weekday}`);
  }

  // Second clause: the single most pressing thing, if there is one.
  const owed = data.money
    .filter((m) => m.direction === 'in' && m.status === 'due')
    .reduce((s, m) => s + m.amount, 0);

  // Counted exactly the way the lapse finding counts it. Two different methods
  // produced "19 students have gone quiet" in the sentence and "18 students" in
  // the card directly beneath it, which reads as the app not knowing its own
  // numbers — far more damaging than either figure being slightly off.
  const quietCount = atRiskParties(data, idx, now, 0.5).filter((read) => {
    const visits = idx.engagementsByParty.get(read.partyId) ?? [];
    return visits.length >= 4 && read.typicalGap !== null;
  }).length;

  const expiringSoon = data.commitments.filter(
    (c) => c.status !== 'cancelled' && c.endAt >= now && c.endAt <= now + 7 * DAY,
  ).length;

  const pressing: { weight: number; clause: string }[] = [];
  if (owed > 0) {
    pressing.push({ weight: owed, clause: `${money(owed)} is sitting unpaid` });
  }
  if (quietCount >= 3) {
    pressing.push({
      weight: quietCount * 400,
      clause: `${quietCount} ${profile.vocabulary.party.many.toLowerCase()} have gone quiet`,
    });
  }
  if (expiringSoon > 0 && profile.shape.commitmentWeight > 0.4) {
    pressing.push({
      weight: expiringSoon * 600,
      clause: `${expiringSoon} ${plural(expiringSoon, profile.vocabulary.commitment).toLowerCase()} ${expiringSoon === 1 ? 'ends' : 'end'} this week`,
    });
  }

  pressing.sort((a, b) => b.weight - a.weight);

  if (pressing.length === 0) {
    return { sentence: `${parts[0]}. Nothing needs you right now.`, tone };
  }

  // At most two clauses. A sentence listing four problems is a list, and a list
  // is what the owner opened this app to stop reading.
  const chosen = pressing.slice(0, 2).map((x) => x.clause);
  const joined = chosen.length === 2 ? `${chosen[0]}, and ${chosen[1]}` : chosen[0];
  const connector = tone === 'good' ? ' — though ' : ', but ';

  return { sentence: `${parts[0]}${connector}${joined}.`, tone: 'attention' };
}

/* ------------------------------------------------------------- now strip -- */

export type NowState = 'happening' | 'soon' | 'later' | 'overdue';

export type NowItem = {
  id: string;
  /** Left-hand time or count, in large type. */
  lead: string;
  label: string;
  /** Sorting key — everything is ordered by when it matters, not by category. */
  at: number;
  tone: 'neutral' | 'warn' | 'good' | 'accent';
  /** Where tapping goes. */
  href?: string;
  kind: 'session' | 'money' | 'obligation' | 'capacity' | 'closure';
  /**
   * Milliseconds until it starts; negative once it has. Only set where a
   * countdown means something — a payment "due today" has no minute attached,
   * and counting down to an invented noon would be inventing precision.
   */
  startsIn?: number;
  /** 0..1, rising as the moment approaches. Drives the fill, not the wording. */
  urgency: number;
  state: NowState;
  /** A live phrase — "in 12 min", "started 5 min ago". */
  when?: string;
};

/** How far ahead something has to be before urgency stops registering at all. */
const NOW_HORIZON = 4 * 60 * 60 * 1000;
const NOW_SOON = 45 * 60 * 1000;

/** "in 12 min", "in 2h 10m", "now", "8 min ago". */
export function describeIn(ms: number): string {
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return 'now';
  const text =
    mins < 60
      ? `${mins} min`
      : mins % 60 === 0
        ? `${mins / 60}h`
        : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return ms >= 0 ? `in ${text}` : `${text} ago`;
}

function timing(at: number, now: number): { startsIn: number; urgency: number; state: NowState } {
  const startsIn = at - now;
  if (startsIn <= 0) return { startsIn, urgency: 1, state: 'happening' };
  return {
    startsIn,
    urgency: Math.max(0, Math.min(1, 1 - startsIn / NOW_HORIZON)),
    state: startsIn <= NOW_SOON ? 'soon' : 'later',
  };
}

/**
 * The next few hours, as a horizontal strip.
 *
 * Ordered strictly by time. Grouping by kind would put "3 payments due" above a
 * class starting in ten minutes, which is exactly backwards for someone glancing
 * at their phone between customers.
 */
export function nowStrip(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
): NowItem[] {
  const items: NowItem[] = [];
  const dayStart = startOfDay(now);
  const dayEnd = dayStart + DAY;

  const closure = data.closures.find((c) => startOfDay(c.date) === dayStart);
  if (closure) {
    items.push({
      id: `closure-${closure.id}`,
      lead: 'Closed',
      label: closure.label,
      at: dayStart,
      tone: 'neutral',
      kind: 'closure',
      urgency: 0,
      state: 'later',
    });
  }

  /*
    Sessions come from the schedule module rather than being derived again here.
    Both files were walking templates into occurrences with their own copies of
    the weekday and minute arithmetic, which is precisely the kind of duplication
    that drifts: the calendar would show a session the home screen did not, and
    neither would look wrong on its own.

    It also gets something the inline version could not — a session already
    recorded is dropped, so the strip stops nagging about a class that was
    captured an hour ago.
  */
  for (const occurrence of occurrencesBetween(data, dayStart, dayEnd - 1)) {
    if (occurrence.closed) continue;
    // Half an hour of grace after the start, then it stops being "now".
    if (occurrence.at < now - 30 * 60 * 1000) continue;
    if (occurrence.recorded) continue;

    const clock = timing(occurrence.at, now);
    items.push({
      id: `tpl-${occurrence.id}`,
      lead: formatTime(occurrence.at),
      label: `${occurrence.name} · ${occurrence.partyIds.length} ${plural(occurrence.partyIds.length, profile.vocabulary.party).toLowerCase()}`,
      at: occurrence.at,
      tone: clock.state === 'later' ? 'neutral' : 'accent',
      href: '/capture',
      kind: 'session',
      startsIn: clock.startsIn,
      urgency: clock.urgency,
      state: clock.state,
      when: describeIn(clock.startsIn),
    });
  }

  // Money expected today.
  const dueToday = data.money.filter(
    (m) =>
      m.direction === 'in' &&
      m.status === 'due' &&
      (m.dueAt ?? m.at) >= dayStart &&
      (m.dueAt ?? m.at) < dayEnd,
  );
  if (dueToday.length > 0) {
    const total = dueToday.reduce((s, m) => s + m.amount, 0);
    items.push({
      id: 'due-today',
      lead: money(total),
      label: `Due from ${dueToday.length} ${dueToday.length === 1 ? profile.vocabulary.party.one.toLowerCase() : profile.vocabulary.party.many.toLowerCase()}`,
      at: dayStart + 12 * 60 * 60 * 1000,
      tone: 'warn',
      href: '/(tabs)/money',
      kind: 'money',
      urgency: 0.6,
      state: 'soon',
      when: 'today',
    });
  }

  // Overdue money is not "today", but it belongs on a strip about right now.
  const overdue = data.money.filter(
    (m) => m.direction === 'in' && m.status === 'due' && (m.dueAt ?? m.at) < dayStart,
  );
  if (overdue.length > 0) {
    const total = overdue.reduce((s, m) => s + m.amount, 0);
    // The oldest one, because "overdue" was already said by the line above it
    // and a card that says the same thing twice has wasted a line. How long the
    // worst of it has been sitting is the part that decides whether to act.
    const oldest = overdue.reduce((a, m) => Math.min(a, m.dueAt ?? m.at), Infinity);
    const age = Math.max(1, Math.floor((dayStart - oldest) / DAY));
    items.push({
      id: 'overdue',
      lead: money(total),
      label: `Overdue from ${overdue.length} ${plural(overdue.length, profile.vocabulary.party).toLowerCase()}`,
      at: dayStart,
      tone: 'warn',
      href: '/(tabs)/money',
      kind: 'money',
      urgency: 1,
      state: 'overdue',
      when: `oldest ${age} ${age === 1 ? 'day' : 'days'}`,
    });
  }

  // Obligations landing inside their lead time.
  for (const o of data.obligations) {
    if (o.done) continue;
    const lead = (o.leadDays ?? 3) * DAY;
    if (o.dueAt > now + lead) continue;
    const overdueBy = now - o.dueAt;
    items.push({
      id: `ob-${o.id}`,
      lead: overdueBy > 0 ? 'Overdue' : o.dueAt < dayEnd ? 'Today' : `${Math.ceil((o.dueAt - now) / DAY)}d`,
      label: o.label,
      at: o.dueAt,
      tone: overdueBy > 0 ? 'warn' : 'neutral',
      href: '/obligations',
      kind: 'obligation',
      urgency: overdueBy > 0 ? 1 : Math.max(0, Math.min(1, 1 - (o.dueAt - now) / lead)),
      state: overdueBy > 0 ? 'overdue' : o.dueAt < dayEnd ? 'soon' : 'later',
      when:
        overdueBy > 0
          ? `was due ${formatDayMonth(o.dueAt)}`
          : o.dueAt < dayEnd
            ? 'today'
            : `by ${formatDayMonth(o.dueAt)}`,
    });
  }

  return items.sort((a, b) => a.at - b.at).slice(0, 8);
}

/* --------------------------------------------------- contextual primary -- */

export type PrimaryAction = {
  label: string;
  href: string;
  /** Why this is the suggestion right now — shown as a subtitle, never hidden. */
  because: string;
};

/**
 * One action, chosen by the hour and the state of the business.
 *
 * Replaces a grid of quick-action tiles. Two tiles that both lead to the same
 * screen is not a shortcut, it is decoration, and it was the weakest thing on
 * the home screen.
 */
export function primaryAction(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
): PrimaryAction {
  const hour = new Date(now).getHours();
  const dayStart = startOfDay(now);
  const weekday = new Date(now).getDay();

  const sessionsToday = data.templates.filter((t) => t.active && t.weekdays.includes(weekday));
  const recordedToday = data.engagements.filter((e) => e.at >= dayStart).length;
  const overdue = data.money.filter(
    (m) => m.direction === 'in' && m.status === 'due' && (m.dueAt ?? m.at) < dayStart,
  );
  const dayOfMonth = new Date(now).getDate();

  // A session that has started and has no attendance recorded beats everything.
  const running = sessionsToday.find((t) => {
    const at = dayStart + t.minuteOfDay * 60 * 1000;
    return now >= at && now - at < 3 * 60 * 60 * 1000;
  });
  if (running && recordedToday === 0) {
    return {
      label: `Take attendance for ${running.name}`,
      href: '/capture',
      because: 'It started a little while ago and nothing is recorded yet',
    };
  }

  // Month end with money outstanding.
  if (dayOfMonth >= 25 && overdue.length > 0) {
    const total = overdue.reduce((s, m) => s + m.amount, 0);
    return {
      label: `Chase ${money(total)} before month end`,
      href: '/worklist?kind=collect',
      because: `${overdue.length} payments are past their date`,
    };
  }

  // Evening, with the day unrecorded.
  if (hour >= 17 && sessionsToday.length > 0 && recordedToday === 0) {
    return {
      label: 'Close the day',
      href: '/capture',
      because: 'Nothing has been recorded today',
    };
  }

  if (hour >= 19) {
    return {
      label: 'Close the day',
      href: '/capture',
      because: 'Today is still open',
    };
  }

  if (data.parties.length === 0) {
    return {
      label: `Add your first ${profile.vocabulary.party.one.toLowerCase()}`,
      href: '/capture',
      because: 'The app fills in as soon as there is something to work from',
    };
  }

  return {
    label: `Record a ${profile.vocabulary.engagement.one.toLowerCase()}`,
    href: '/capture',
    because: 'The fastest way to keep everything else accurate',
  };
}


/* ---------------------------------------------------------------- mood -- */

export type MoodKey = 'strong' | 'steady' | 'quiet' | 'attention';

export type Mood = {
  key: MoodKey;
  /** Why, in the owner's terms. Surfaced on long press, never as a banner. */
  reason: string;
  /** How much to lean on it, 0..1. Low confidence stays near neutral. */
  weight: number;
};

export function businessMood(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
  index?: Index,
): Mood {
  const beat = pulse(data, now);

  // Findings that carry an action are the ones that mean something is wrong; a
  // purely informational finding is not a reason to tint the whole screen.
  const findings = generateInsights(profile, data, { now, index, limit: 4 });
  const actionable = findings.filter((f) => f.action).length;

  if (actionable >= 2) {
    return {
      key: 'attention',
      reason: `${actionable} things want doing`,
      weight: 0.9,
    };
  }

  // Before there is anything to compare against, saying the day is good or bad
  // is a guess dressed as a reading.
  if (!beat.comparableYet) {
    return { key: 'steady', reason: 'Early in the day', weight: 0.35 };
  }

  const ratio = beat.normalValue > 0 ? beat.todayValue / beat.normalValue : 1;

  if (ratio >= 1.15) {
    return { key: 'strong', reason: 'Ahead of a normal day', weight: Math.min(1, ratio - 0.15) };
  }
  if (ratio <= 0.6) {
    return { key: 'quiet', reason: 'Behind a normal day', weight: 0.75 };
  }
  return { key: 'steady', reason: 'About normal', weight: 0.5 };
}

/* ------------------------------------------------------------ mood copy -- */

export type MoodMessage = {
  /** Title case, three to five words. Names the state rather than the number. */
  title: string;
  /** Two or three sentences: what it is, and what to do about it. */
  body: string;
};

/**
 * What the face is saying.
 *
 * Written as a state and a suggestion, never as a command. "Take a moment to
 * pause" and "you may want to double-check how you feel" are hedged on purpose:
 * this is an inference from partial records, and an app that speaks with more
 * certainty than its data supports is one an owner learns to overrule and then
 * to ignore.
 *
 * Every figure quoted here comes from the same `pulse` and `generateInsights`
 * the cards below run on, so the paragraph can never contradict the list under
 * it — which is the failure that would make the whole character a liability.
 */
export function moodMessage(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
  index?: Index,
  mood?: Mood,
): MoodMessage {
  const idx = index ?? buildIndex(data);
  const read = mood ?? businessMood(profile, data, now, idx);
  const beat = pulse(data, now);
  const findings = generateInsights(profile, data, { now, index: idx, limit: 4 });
  const actionable = findings.filter((f) => f.action);
  const party = profile.vocabulary.party;
  const weekday = beat.weekday;

  // Switched on the mood rather than re-deriving from the same inputs. Two
  // independent derivations from one dataset drift the moment either threshold
  // moves, and a beaming face over a paragraph about things going wrong is the
  // single failure that would make the whole character untrustworthy.
  switch (read.key) {
    case 'attention':
      return {
        title: 'A Few Things Want Doing',
        body:
          `${actionable.length} things are worth your attention today — ${actionable[0]?.title.toLowerCase() ?? 'the list below'} is the one that would move the most. ` +
          `The rest are below, ordered by what they are actually costing you rather than by when they appeared.`,
      };

    case 'strong':
      return {
        title: 'Ahead Of A Normal Day',
        body:
          `${money(beat.todayValue)} in so far, against the ${money(beat.normalValue)} a ${weekday} usually brings by this hour. ` +
          `Nothing needs doing — this is what it looks like when the ordinary things are working.`,
      };

    case 'quiet': {
      const drifting = atRiskParties(data, idx, now).length;
      return {
        title: 'Quieter Than Usual',
        body:
          `${money(beat.todayValue)} in, where a ${weekday} normally brings ${money(beat.normalValue)} by now. ` +
          (drifting > 0
            ? `One quiet day is only a quiet day, but ${drifting} ${plural(drifting, party).toLowerCase()} ${drifting === 1 ? 'has' : 'have'} also been coming less often — worth a look if it keeps up.`
            : `One quiet day is only a quiet day; nothing underneath it looks wrong.`),
      };
    }

    default: {
      if (actionable.length === 1) {
        return {
          title: 'One Thing To Look At',
          body:
            `Most of the business is running as it usually does. The exception: ${actionable[0].title.toLowerCase()}. ` +
            `It is the only thing on the list, so it will not take long.`,
        };
      }
      if (!beat.comparableYet) {
        const ahead = nowStrip(profile, data, now).filter((i) => i.kind === 'session').length;
        return {
          title: 'Early Yet',
          body:
            `Too early on a ${weekday} to say how the day compares — there is not enough of it on record to judge against. ` +
            (ahead > 0
              ? `${ahead} thing${ahead === 1 ? '' : 's'} coming up, and nothing needs chasing.`
              : `Nothing is overdue and nobody is waiting on you.`),
        };
      }
      return {
        title: 'Running As It Should',
        body:
          `${money(beat.todayValue)} in, which is about what a ${weekday} brings by this hour. ` +
          `Nothing is overdue, nobody has drifted far enough to chase, and there is nothing here that needs you today.`,
      };
    }
  }
}
