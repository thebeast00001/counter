import {
  buildIndex,
  churnRead,
  partyValue,
  quietThresholdDays,
  reliability,
  startOfDay,
  startOfMonth,
  type Index,
} from '@/domain/analytics';
import { generateInsights } from '@/domain/insights';
import { money, outstanding } from '@/domain/metrics';
import { briefing } from '@/domain/today';
import { normalise } from '@/domain/vernacular';
import { plural } from '@/domain/words';
import type { BusinessData, BusinessProfile } from '@/domain/model';
import { dayName, formatDateMedium, formatDateShort, formatDayMonth, formatMonthYear } from '@/lib/time';

/**
 * Plain-language questions, answered on the device.
 *
 * No model, no network, no round trip. That is a constraint and also the point:
 * an owner in a basement gym with one bar of signal gets an answer in eight
 * milliseconds, and their customer list never leaves the handset.
 *
 * The trade is that this understands a bounded set of questions rather than
 * anything at all. It is built to fail loudly — an unrecognised question says so
 * and offers what it *can* answer, because a confident wrong answer about
 * someone's takings destroys trust permanently.
 */

const DAY = 24 * 60 * 60 * 1000;

export type AnswerRow = {
  id: string;
  label: string;
  sub?: string;
  value?: string;
  partyId?: string;
};

export type Answer = {
  /** The direct answer, in large type. Empty when the answer is a list. */
  headline: string;
  /** One sentence of context. Always present — a bare number is not an answer. */
  detail: string;
  rows: AnswerRow[];
  /** What was understood, echoed back so a misreading is visible. */
  understood: string;
  ok: boolean;
};

export const EXAMPLE_QUESTIONS = [
  'How is business doing?',
  'What should I do today?',
  'How much did I make last month?',
  'Who owes me money?',
  'Who has stopped coming?',
  'What is my busiest day?',
  'Who are my best customers?',
  'How many joined this month?',
  'What did I spend last month?',
  'Who is about to leave?',
  'What do I need to renew?',
];

/* ---------------------------------------------------------------- periods -- */

type Period = { from: number; to: number; label: string };

function resolvePeriod(q: string, now: number): Period {
  const monthStart = startOfMonth(now);

  if (/\blast month\b/.test(q)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1, 1);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: monthStart, label: 'last month' };
  }
  if (/\bthis week\b/.test(q)) {
    return { from: startOfDay(now) - 6 * DAY, to: now, label: 'this week' };
  }
  if (/\blast week\b/.test(q)) {
    return { from: startOfDay(now) - 13 * DAY, to: startOfDay(now) - 6 * DAY, label: 'last week' };
  }
  if (/\btoday\b/.test(q)) {
    return { from: startOfDay(now), to: now, label: 'today' };
  }
  if (/\byesterday\b/.test(q)) {
    return { from: startOfDay(now) - DAY, to: startOfDay(now), label: 'yesterday' };
  }
  if (/\bthis year\b/.test(q)) {
    const d = new Date(now);
    d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: now, label: 'this year' };
  }
  if (/\blast year\b/.test(q)) {
    const from = new Date(now);
    from.setFullYear(from.getFullYear() - 1, 0, 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setMonth(0, 1);
    to.setHours(0, 0, 0, 0);
    return { from: from.getTime(), to: to.getTime(), label: 'last year' };
  }
  return { from: monthStart, to: now, label: 'this month' };
}

/** Finds a person named in the question, if there is one. */
function resolveParty(q: string, index: Index): { id: string; name: string } | null {
  let best: { id: string; name: string; length: number } | null = null;
  for (const [id, party] of index.partyById) {
    const first = party.name.split(' ')[0].toLowerCase();
    // Match the full name, or a first name of four letters or more — shorter
    // first names collide with ordinary words ("Isha" is fine, "Dev" is not).
    const full = party.name.toLowerCase();
    const hit = q.includes(full) || (first.length >= 4 && new RegExp(`\\b${first}\\b`).test(q));
    if (!hit) continue;
    if (!best || party.name.length > best.length) {
      best = { id, name: party.name, length: party.name.length };
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

/* ----------------------------------------------------------------- answer -- */

export function ask(
  profile: BusinessProfile,
  data: BusinessData,
  question: string,
  now = Date.now(),
): Answer {
  /*
    Every pattern below this line is English, and that is now a translation
    problem rather than a limitation. `normalise` appends the English these
    branches already read — so a question asked in Hindi, Marathi or Tamil
    reaches the same branch, computed on the same device, without any of them
    learning a second language. It leaves an English question untouched.
  */
  const q = normalise(question);
  const index = buildIndex(data);
  const partyTerm = profile.vocabulary.party.many.toLowerCase();
  const visitTerm = profile.vocabulary.engagement.many.toLowerCase();

  const fail = (understood = 'Nothing recognisable'): Answer => ({
    headline: '',
    detail:
      'That is not something I can work out from your records yet. Try one of the examples — everything is answered on this phone, so the questions have to be ones I know how to ask of your own data.',
    rows: EXAMPLE_QUESTIONS.map((e, i) => ({ id: `ex${i}`, label: e })),
    understood,
    ok: false,
  });

  if (q.length < 3) return fail();

  const person = resolveParty(q, index);

  /* ------------------------------------------------- questions about one -- */
  if (person) {
    const value = partyValue(index, person.id, now);
    const rel = reliability(index, person.id);
    const churn = churnRead(data, index, person.id, now);
    const visits = index.engagementsByParty.get(person.id) ?? [];
    const seen = index.lastSeen.get(person.id);

    if (/\bowe|\bunpaid|\bdue\b|\bpaid\b|\bpay/.test(q)) {
      return {
        headline: value.outstanding > 0 ? money(value.outstanding) : 'Nothing',
        detail:
          value.outstanding > 0
            ? `${person.name} owes ${money(value.outstanding)}. ${rel.score === null ? 'No payment history to judge by yet.' : rel.score > 0.8 ? 'Usually pays on time.' : `Usually about ${Math.round(rel.averageDelayDays ?? 0)} days late.`}`
            : `${person.name} does not owe anything. Paid ${money(value.lifetime)} in total.`,
        rows: (index.moneyByParty.get(person.id) ?? [])
          .sort((a, b) => b.at - a.at)
          .slice(0, 10)
          .map((m) => ({
            id: m.id,
            label: m.label,
            sub: formatDateShort(m.at),
            value: `${m.status === 'due' ? 'Unpaid ' : ''}${money(m.amount)}`,
          })),
        understood: `Payments for ${person.name}`,
        ok: true,
      };
    }

    if (/\blast\b|\bwhen\b|\bseen\b|\bcame\b|\bcome\b/.test(q)) {
      const days = seen ? Math.max(0, Math.floor((now - seen) / DAY)) : null;
      return {
        headline: days === null ? 'Never' : days === 0 ? 'Today' : `${days} days ago`,
        detail:
          days === null
            ? `${person.name} has never been in since joining.`
            : `${person.name} was last in on ${dayName(seen as number)}, ${formatDayMonth(seen as number)}. ${churn.typicalGap ? `They normally come about every ${Math.round(churn.typicalGap)} days.` : ''}`,
        rows: visits
          .slice(-10)
          .reverse()
          .map((at) => ({
            id: `v${at}`,
            label: profile.vocabulary.engagement.one,
            sub: formatDateMedium(at),
          })),
        understood: `Attendance for ${person.name}`,
        ok: true,
      };
    }

    return {
      headline: money(value.lifetime),
      detail: `${person.name} has been with you since ${formatMonthYear(index.partyById.get(person.id)?.joinedAt ?? now)}, come ${visits.length} times, and paid ${money(value.lifetime)}.${value.outstanding > 0 ? ` ${money(value.outstanding)} is outstanding.` : ''}`,
      rows: [
        { id: 'r1', label: 'Last in', value: seen ? formatDateShort(seen) : 'Never' },
        { id: 'r2', label: `${profile.vocabulary.engagement.many} recorded`, value: String(visits.length) },
        { id: 'r3', label: 'Paid all time', value: money(value.lifetime) },
        { id: 'r4', label: 'Outstanding', value: value.outstanding > 0 ? money(value.outstanding) : 'Nothing' },
        { id: 'r5', label: 'Risk of leaving', value: `${Math.round(churn.risk * 100)}%` },
      ],
      understood: `Summary for ${person.name}`,
      ok: true,
    };
  }

  /* --------------------------------------------------------------- outstanding -- */
  if (/outstanding|owed to me|owing|how much.*(owe|due)|receivable|pending payment/.test(q)) {
    const total = outstanding(data);
    const due = data.money.filter((m) => m.direction === 'in' && m.status === 'due');
    const late = due.filter((m) => (m.dueAt ?? m.at) < startOfDay(now));
    const lateTotal = late.reduce((sum, m) => sum + m.amount, 0);
    return {
      headline: money(total),
      detail:
        due.length === 0
          ? 'Nothing is outstanding.'
          : `${money(total)} across ${due.length} ${due.length === 1 ? 'entry' : 'entries'}` +
            (late.length > 0 ? `, of which ${money(lateTotal)} is already late.` : ', none of it late yet.'),
      rows: [],
      understood: 'Everything outstanding',
      ok: true,
    };
  }

  /* ------------------------------------------------------------- takings -- */
  if (
    /how much|revenue|takings|earn|made|income|turnover|collect/.test(q) &&
    !/spend|spent|expense|cost|outstanding|owe|owing|receivable/.test(q)
  ) {
    const period = resolvePeriod(q, now);
    const entries = data.money.filter(
      (m) => m.direction === 'in' && m.status === 'settled' && m.at >= period.from && m.at < period.to,
    );
    const total = entries.reduce((s, m) => s + m.amount, 0);

    const byParty = new Map<string, number>();
    for (const m of entries) {
      const key = m.partyId ?? '__other';
      byParty.set(key, (byParty.get(key) ?? 0) + m.amount);
    }

    return {
      headline: money(total),
      detail: `${money(total)} collected ${period.label}, across ${entries.length} payment${entries.length === 1 ? '' : 's'} from ${byParty.size} ${byParty.size === 1 ? profile.vocabulary.party.one.toLowerCase() : partyTerm}.`,
      rows: [...byParty.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([id, amount]) => ({
          id,
          label: id === '__other' ? 'Not linked to anyone' : (index.partyById.get(id)?.name ?? 'Unknown'),
          value: money(amount),
          partyId: id === '__other' ? undefined : id,
        })),
      understood: `Takings, ${period.label}`,
      ok: true,
    };
  }

  /* ------------------------------------------------------------ expenses -- */
  if (/spend|spent|expense|cost|outgoing/.test(q)) {
    const period = resolvePeriod(q, now);
    const entries = data.money.filter(
      (m) => m.direction === 'out' && m.at >= period.from && m.at < period.to,
    );
    const total = entries.reduce((s, m) => s + m.amount, 0);
    const byCategory = new Map<string, number>();
    for (const m of entries) {
      const key = m.category ?? 'other';
      byCategory.set(key, (byCategory.get(key) ?? 0) + m.amount);
    }
    return {
      headline: money(total),
      detail: `${money(total)} went out ${period.label}, across ${entries.length} entries.`,
      rows: [...byCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([category, amount]) => ({
          id: category,
          label: category[0].toUpperCase() + category.slice(1),
          value: money(amount),
        })),
      understood: `Spending, ${period.label}`,
      ok: true,
    };
  }

  /* ----------------------------------------------------------- who owes -- */
  if (/\bowe|outstanding|unpaid|not paid|pending payment|due/.test(q)) {
    const due = data.money.filter((m) => m.direction === 'in' && m.status === 'due');
    const byParty = new Map<string, number>();
    for (const m of due) {
      const key = m.partyId ?? '__other';
      byParty.set(key, (byParty.get(key) ?? 0) + m.amount);
    }
    const total = due.reduce((s, m) => s + m.amount, 0);

    return {
      headline: money(total),
      detail:
        total === 0
          ? // "Everything has been settled" is only true if anything was ever
            // raised. On day one it describes a history that does not exist,
            // which is the exact kind of small confident untruth this app is
            // built to avoid.
            data.money.some((m) => m.direction === 'in')
            ? 'Nobody owes you anything. Everything raised has been settled.'
            : 'Nobody owes you anything yet — no charges have been raised.'
          : `${money(total)} is outstanding across ${byParty.size} ${byParty.size === 1 ? profile.vocabulary.party.one.toLowerCase() : partyTerm}. Biggest first.`,
      rows: [...byParty.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id, amount]) => {
          const rel = id === '__other' ? null : reliability(index, id);
          return {
            id,
            label: id === '__other' ? 'Not linked to anyone' : (index.partyById.get(id)?.name ?? 'Unknown'),
            sub:
              rel?.averageDelayDays != null
                ? `Usually ${Math.round(rel.averageDelayDays)} days late`
                : undefined,
            value: money(amount),
            partyId: id === '__other' ? undefined : id,
          };
        }),
      understood: 'Who owes money',
      ok: true,
    };
  }

  /* ------------------------------------------------------------- lapsing -- */
  if (/stopped|gone quiet|quiet|lapsed|not been|missing|disappear|about to leave|leaving|churn|risk/.test(q)) {
    const quietDays = quietThresholdDays(profile, data, index);
    const risky = data.parties
      .filter((p) => !p.archivedAt)
      .map((p) => churnRead(data, index, p.id, now))
      .filter((r) => r.risk >= 0.4)
      .sort((a, b) => b.risk - a.risk);

    return {
      headline: String(risky.length),
      detail:
        risky.length === 0
          ? `Nobody stands out as drifting. Anyone away longer than ${quietDays} days would show up here.`
          : `${risky.length} ${risky.length === 1 ? profile.vocabulary.party.one.toLowerCase() : partyTerm} look like they are drifting away, judged against how often they normally come rather than a fixed number of days.`,
      rows: risky.slice(0, 15).map((r) => ({
        id: r.partyId,
        label: index.partyById.get(r.partyId)?.name ?? 'Unknown',
        sub: r.reasons[0],
        value: `${Math.round(r.risk * 100)}%`,
        partyId: r.partyId,
      })),
      understood: 'Who is drifting away',
      ok: true,
    };
  }

  /* --------------------------------------------------------- busiest day -- */
  if (/busiest|quietest|busy|quiet day|best day|worst day|which day/.test(q)) {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const counts = new Array(7).fill(0);
    for (const e of data.engagements) {
      if (e.at < now - 56 * DAY || e.noShow) continue;
      counts[new Date(e.at).getDay()] += 1;
    }
    const quietest = /quiet|worst/.test(q);
    let pick = 0;
    for (let i = 1; i < 7; i++) {
      if (quietest ? counts[i] < counts[pick] : counts[i] > counts[pick]) pick = i;
    }
    const totalVisits = counts.reduce((s, c) => s + c, 0);

    return {
      headline: names[pick],
      detail:
        totalVisits === 0
          ? 'No visits recorded in the last eight weeks, so there is no pattern to read.'
          : `${names[pick]} is your ${quietest ? 'quietest' : 'busiest'} day — ${counts[pick]} ${plural(counts[pick], profile.vocabulary.engagement).toLowerCase()} over the last eight weeks, against ${Math.round(totalVisits / 7)} on an average day.`,
      rows: names.map((name, i) => ({
        id: name,
        label: name,
        value: String(counts[i]),
      })),
      understood: quietest ? 'Quietest day' : 'Busiest day',
      ok: true,
    };
  }

  /* ---------------------------------------------------------------- best -- */
  if (/best|top|most valuable|biggest|loyal|favourite/.test(q)) {
    const ranked = data.parties
      .filter((p) => !p.archivedAt)
      .map((p) => ({ p, v: partyValue(index, p.id, now) }))
      .sort((a, b) => b.v.lifetime - a.v.lifetime)
      .slice(0, 15);

    return {
      headline: ranked[0]?.p.name ?? '—',
      detail:
        ranked.length === 0
          ? 'No payment history yet.'
          : `${ranked[0].p.name} has paid ${money(ranked[0].v.lifetime)} in total — the most of anyone. The top five together account for ${money(ranked.slice(0, 5).reduce((s, r) => s + r.v.lifetime, 0))}.`,
      rows: ranked.map(({ p, v }) => ({
        id: p.id,
        label: p.name,
        sub: `${(index.engagementsByParty.get(p.id) ?? []).length} ${plural((index.engagementsByParty.get(p.id) ?? []).length, profile.vocabulary.engagement).toLowerCase()}`,
        value: money(v.lifetime),
        partyId: p.id,
      })),
      understood: 'Most valuable',
      ok: true,
    };
  }

  /* ----------------------------------------------------------- how many -- */
  if (/how many|count|number of|total/.test(q)) {
    if (/join|new|sign/.test(q)) {
      const period = resolvePeriod(q, now);
      const joined = data.parties.filter((p) => p.joinedAt >= period.from && p.joinedAt < period.to);
      return {
        headline: String(joined.length),
        detail: `${joined.length} ${joined.length === 1 ? profile.vocabulary.party.one.toLowerCase() : partyTerm} joined ${period.label}.`,
        rows: joined.slice(0, 15).map((p) => ({
          id: p.id,
          label: p.name,
          sub: formatDateShort(p.joinedAt),
          partyId: p.id,
        })),
        understood: `New ${partyTerm}, ${period.label}`,
        ok: true,
      };
    }

    if (new RegExp(visitTerm.replace(/s$/, '')).test(q) || /visit|class|session|appointment|job|order/.test(q)) {
      const period = resolvePeriod(q, now);
      const visits = data.engagements.filter(
        (e) => e.at >= period.from && e.at < period.to && !e.noShow,
      );
      return {
        headline: String(visits.length),
        detail: `${visits.length} ${visitTerm} recorded ${period.label}.`,
        rows: [],
        understood: `${profile.vocabulary.engagement.many}, ${period.label}`,
        ok: true,
      };
    }

    const live = data.parties.filter((p) => !p.archivedAt);
    const quietDays = quietThresholdDays(profile, data, index);
    const quiet = live.filter((p) => {
      const seen = index.lastSeen.get(p.id);
      return seen === undefined ? p.joinedAt < now - quietDays * DAY : seen < now - quietDays * DAY;
    });
    return {
      headline: String(live.length),
      detail: `${live.length} on the books, of whom ${live.length - quiet.length} are coming regularly and ${quiet.length} have gone quiet.`,
      rows: [],
      understood: `Number of ${partyTerm}`,
      ok: true,
    };
  }

  /* --------------------------------------------------------- how is it going -- */
  /*
    The most natural question anybody asks, and the one this could not answer.

    "How is things going on" reached the model, which is the wrong place for it
    twice over: the phone already computes this exact reading for the home
    screen, and going out to a free model for it means the commonest question is
    the slowest and the least reliable. `briefing` is the same sentence the
    owner sees at the top of Today, which is the point — two screens disagreeing
    about how the business is doing is worse than either of them being terse.
  */
  if (
    /how (is|are|s|'s)? ?(it|things|business|we|i|my business|everything)|how am i doing|how is it going|hows business|how goes/.test(
      q,
    )
  ) {
    const read = briefing(profile, data, now, index);
    const findings = generateInsights(profile, data, { now, index });
    return {
      headline: '',
      detail: read.sentence,
      rows: findings.slice(0, 4).map((f) => ({ id: f.id, label: f.title, sub: f.evidence?.label })),
      understood: 'How the business is doing',
      ok: true,
    };
  }

  /* ------------------------------------------------------- what needs doing -- */
  if (/what (should|do|can) i do|what needs|what next|anything (i should|to do)|to do today/.test(q)) {
    const findings = generateInsights(profile, data, { now, index });
    if (findings.length === 0) {
      return {
        headline: 'Nothing',
        detail:
          'Nothing needs you right now. Everything is tracking the way it normally does — this is the app working, not the app idle.',
        rows: [],
        understood: 'What needs doing',
        ok: true,
      };
    }
    return {
      headline: String(findings.length),
      detail: findings[0].title,
      rows: findings.map((f) => ({ id: f.id, label: f.title, sub: f.evidence?.label })),
      understood: 'What needs doing',
      ok: true,
    };
  }

  /* ----------------------------------------------------------- to renew or file -- */
  if (/renew|licence|license|file|filing|expir|due soon|deadline|compliance|gst|tax/.test(q)) {
    const open = data.obligations
      .filter((o) => !o.done)
      .sort((a, b) => a.dueAt - b.dueAt)
      .slice(0, 12);
    if (open.length === 0) {
      return {
        headline: 'Nothing',
        detail: 'Nothing is waiting to be renewed or filed.',
        rows: [],
        understood: 'Renewals and filings',
        ok: true,
      };
    }
    const late = open.filter((o) => o.dueAt < now).length;
    return {
      headline: String(open.length),
      detail:
        late > 0
          ? `${open.length} waiting, and ${late} already past ${late === 1 ? 'its date' : 'their dates'}.`
          : `${open.length} waiting. The next is ${open[0].label}, on ${formatDayMonth(open[0].dueAt)}.`,
      rows: open.map((o) => ({
        id: o.id,
        label: o.label,
        sub: o.dueAt < now ? `${Math.ceil((now - o.dueAt) / DAY)} days late` : formatDayMonth(o.dueAt),
      })),
      understood: 'Renewals and filings',
      ok: true,
    };
  }

  /* -------------------------------------------------------------- what is typical -- */
  if (/average|typical|usually (pay|spend)|per (customer|person|head)|mean/.test(q)) {
    const live = data.parties.filter((p) => !p.archivedAt);
    if (live.length === 0) return fail('Averages');
    const values = live.map((p) => partyValue(index, p.id, now).lifetime);
    const mean = values.reduce((sum, v) => sum + v, 0) / live.length;
    const visits = live.map((p) => (index.engagementsByParty.get(p.id) ?? []).length);
    const meanVisits = visits.reduce((sum, v) => sum + v, 0) / live.length;
    return {
      headline: money(Math.round(mean)),
      detail: `Averaged over ${live.length} ${plural(live.length, profile.vocabulary.party).toLowerCase()} on the books, each has paid ${money(
        Math.round(mean),
      )} across ${meanVisits.toFixed(1)} ${visitTerm}. An average hides the spread — the best few usually carry far more than this.`,
      rows: [],
      understood: `What a ${profile.vocabulary.party.one.toLowerCase()} is worth on average`,
      ok: true,
    };
  }

  return fail(question);
}
