import { startOfDay } from '@/domain/analytics';
import type { BusinessData, BusinessProfile, Engagement } from '@/domain/model';

/**
 * Sessions, as distinct from attendances.
 *
 * The app records one engagement per person per visit, which is right — a visit
 * belongs to somebody, and every retention figure in the product depends on
 * knowing whose. But a tuition centre calls an engagement a "Class", and when
 * fourteen students are ticked off for one class the app has fourteen records
 * and reports "14 Classes".
 *
 * That is not a wording problem. It is the same number answering two different
 * questions — *how many classes did I run* and *how many attendances were
 * there* — and for any business that teaches a group, those answers differ by a
 * factor of ten or more. An owner reading "72 classes a week" when they ran six
 * is being told something false about their own timetable.
 *
 * So this module counts the other one. A session is the event; an engagement is
 * one person's presence at it.
 *
 * ## What counts as one session
 *
 * Engagements written together from a timetable share a `templateId` and a
 * timestamp, so they group exactly. Everything else is grouped by the minute it
 * was recorded, which is what a batch of attendance ticks produces, and which
 * leaves one-at-a-time trades — a garage, a salon — with one session per job.
 * That is the correct answer for them: a mechanic's session *is* the job.
 */

/** A minute, so a batch of ticks saved together lands in one bucket. */
const MINUTE = 60_000;

export type Session = {
  /** Stable within a data set, so lists can key on it. */
  key: string;
  at: number;
  templateId: string | null;
  /** Everyone recorded present. No-shows are counted separately. */
  present: number;
  noShows: number;
};

/** Groups engagements into the events they belong to, newest first. */
export function sessionsBetween(data: BusinessData, from: number, to: number): Session[] {
  const buckets = new Map<string, Session>();

  for (const engagement of data.engagements) {
    if (engagement.at < from || engagement.at > to) continue;

    const template = engagement.templateId ?? null;
    // Timetabled runs group on the template and the exact instant they were
    // written; ad-hoc ticks group on the minute, which is how a manual batch
    // arrives. Without the minute, saving a class of fourteen at 09:00:01 and
    // 09:00:02 would count as two classes.
    const stamp = template ? engagement.at : Math.floor(engagement.at / MINUTE) * MINUTE;
    const key = `${template ?? 'adhoc'}|${stamp}`;

    const bucket = buckets.get(key) ?? {
      key,
      at: stamp,
      templateId: template,
      present: 0,
      noShows: 0,
    };
    if (engagement.noShow) bucket.noShows += 1;
    else bucket.present += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.values()].sort((a, b) => b.at - a.at);
}

export type SessionRead = {
  /** Events that actually ran — sessions with nobody present are not counted. */
  sessions: number;
  /** People recorded present, across all of them. */
  attendances: number;
  /** Mean heads per session that ran. Zero when nothing ran. */
  perSession: number;
  /** The fullest session in the window. */
  best: number;
  noShows: number;
  /**
   * Whether the two numbers are worth showing separately at all.
   *
   * Derived from the records rather than from the archetype, because the
   * archetype is a guess and this is a fact. A gym that runs classes and a gym
   * where people swipe in alone are the same archetype and want different
   * screens; a tuition centre teaching one-to-one wants the garage's screen.
   * Below an average of about one and a half heads per session, the split says
   * nothing and the widget would just be two copies of one number.
   */
  grouped: boolean;
};

export function sessionRead(data: BusinessData, from: number, to: number): SessionRead {
  const sessions = sessionsBetween(data, from, to);
  const ran = sessions.filter((s) => s.present > 0);

  const attendances = ran.reduce((sum, s) => sum + s.present, 0);
  const noShows = sessions.reduce((sum, s) => sum + s.noShows, 0);
  const perSession = ran.length > 0 ? attendances / ran.length : 0;

  return {
    sessions: ran.length,
    attendances,
    perSession,
    best: ran.reduce((max, s) => Math.max(max, s.present), 0),
    noShows,
    grouped: ran.length > 0 && perSession >= 1.5,
  };
}

/**
 * What to call a session and an attendance, in this business's own words.
 *
 * The vocabulary has one term where two are needed. `engagement` is the word an
 * owner uses for the event — Class, Check-in, Appointment, Job — so it stays the
 * session word, and the attendance word is built from the person word instead:
 * a tuition centre gets "Classes" and "Students present", a gym "Check-ins" and
 * "Members in".
 *
 * Deliberately not a new vocabulary field. Onboarding does not ask for it, so it
 * would have to be invented for every existing profile — and a term derived from
 * two the owner already gave is more likely to be right than a default.
 */
export function sessionWords(profile: BusinessProfile): {
  session: { one: string; many: string };
  attendance: { one: string; many: string };
} {
  const event = profile.vocabulary.engagement;
  const party = profile.vocabulary.party;

  return {
    session: event,
    attendance: {
      one: `${party.one} present`,
      many: `${party.many} present`,
    },
  };
}

/**
 * A one-line summary of a batch that was just recorded.
 *
 * The confirmation after ticking off a class used to read "14 recorded", which
 * is the number the owner is least able to check and the one most easily read as
 * fourteen classes. Naming both halves makes it unambiguous in the only place
 * where the owner still has the room in front of them to verify it.
 */
export function describeBatch(
  profile: BusinessProfile,
  made: Engagement[],
): string {
  const present = made.filter((e) => !e.noShow).length;
  const absent = made.length - present;
  const words = sessionWords(profile);

  if (present === 0) return `${absent} marked absent`;

  const heads =
    present === 1
      ? `1 ${profile.vocabulary.party.one.toLowerCase()}`
      : `${present} ${profile.vocabulary.party.many.toLowerCase()}`;

  // One person is a visit, not a session worth counting as one — saying
  // "1 class · 1 student" for a single walk-in reads as bureaucracy.
  if (present === 1 && absent === 0) {
    return `${words.session.one} recorded for 1 ${profile.vocabulary.party.one.toLowerCase()}`;
  }

  const base = `1 ${words.session.one.toLowerCase()} · ${heads}`;
  return absent > 0 ? `${base} · ${absent} missing` : base;
}

/** Sessions per day across a window, oldest first. Used by the trend widgets. */
export function sessionsPerDay(data: BusinessData, from: number, to: number): number[] {
  const sessions = sessionsBetween(data, from, to);
  const byDay = new Map<number, number>();

  for (const session of sessions) {
    if (session.present === 0) continue;
    const day = startOfDay(session.at);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const out: number[] = [];
  for (let day = startOfDay(from); day <= to; day += 86_400_000) {
    out.push(byDay.get(day) ?? 0);
  }
  return out;
}
