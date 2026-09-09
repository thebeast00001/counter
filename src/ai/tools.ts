import {
  activeHourRange,
  agingBuckets,
  atRiskParties,
  buildIndex,
  capacityGrid,
  cashForecast,
  churnRead,
  partyValue,
  reliability,
  startOfDay,
  startOfMonth,
  type Index,
} from '@/domain/analytics';
import { generateInsights } from '@/domain/insights';
import { money } from '@/domain/metrics';
import type { BusinessData, BusinessProfile } from '@/domain/model';
import { plural } from '@/domain/words';
import type { Curtain } from '@/ai/redact';

/**
 * What the model is allowed to ask the device for.
 *
 * The single most important property of this file: **the model never produces a
 * number**. It chooses a question; the arithmetic is done here, by the same
 * deterministic code the rest of the app has always used, against the real
 * records. Whatever the model then writes is constrained to the figures handed
 * back to it.
 *
 * That is what makes a free 8B model safe to point at someone's livelihood. A
 * model asked "how much did Priya pay you" will confabulate a plausible amount,
 * every time, and a plausible wrong amount is worse than no answer. A model
 * asked "which tool answers this" gets it right or picks nothing, and picking
 * nothing is a recoverable failure.
 *
 * Tool results are shaped for reading, not for machines: short, already
 * formatted, already behind the curtain. Handing a model raw rows invites it to
 * do its own arithmetic on them, which is the failure this design exists to
 * remove.
 */

const DAY = 24 * 60 * 60 * 1000;

export type ToolSpec = {
  name: string;
  description: string;
  args: Record<string, string>;
};

/** Advertised to the planner. Kept small — a long menu makes routing worse. */
export const TOOLS: ToolSpec[] = [
  {
    name: 'money_total',
    description: 'Total taken in or paid out over a period, and how it compares.',
    args: {
      period: "'today' | 'this_week' | 'this_month' | 'last_month' | 'this_year'",
      direction: "'in' | 'out'",
    },
  },
  {
    name: 'people_list',
    description:
      "People matching a status. 'quiet' = coming less than they used to, 'owing' = unsettled money, 'best' = highest lifetime value, 'new' = joined this month, 'expiring' = commitment ends within 14 days.",
    args: { status: "'quiet' | 'owing' | 'best' | 'new' | 'expiring'", limit: 'number, max 10' },
  },
  {
    name: 'person_detail',
    description: 'Everything known about one person: value, rhythm, reliability, risk of leaving.',
    args: { token: "the person's token, e.g. 'P4'" },
  },
  {
    name: 'findings',
    description:
      'The app\'s own ranked findings about the business right now — the same ones on the home screen. Use for broad questions like "how is the business doing" or "what should I do".',
    args: { limit: 'number, max 5' },
  },
  {
    name: 'cash_outlook',
    description: 'Expected income over the next 30 days, and what it rests on.',
    args: {},
  },
  {
    name: 'busiest_times',
    description: 'Which days and hours are busiest, from the last eight weeks.',
    args: {},
  },
  {
    name: 'overview',
    description: 'Headline counts: how many people, how many active, records held, months of history.',
    args: {},
  },
];

export type ToolCall = { tool: string; args: Record<string, unknown> };

export type ToolResult = {
  ok: boolean;
  /** Plain text, already redacted, given to the model as the sole source of fact. */
  text: string;
  /** Party ids behind any tokens mentioned, so the UI can link them. */
  partyIds: string[];
};

type Ctx = {
  profile: BusinessProfile;
  data: BusinessData;
  index: Index;
  now: number;
  curtain: Curtain;
};

/* --------------------------------------------------------------- helpers -- */

function periodRange(period: unknown, now: number): { from: number; to: number; label: string } {
  switch (period) {
    case 'today':
      return { from: startOfDay(now), to: now, label: 'today' };
    case 'this_week':
      return { from: startOfDay(now) - 6 * DAY, to: now, label: 'the last 7 days' };
    case 'last_month': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1, 1);
      d.setHours(0, 0, 0, 0);
      return { from: d.getTime(), to: startOfMonth(now), label: 'last month' };
    }
    case 'this_year': {
      const d = new Date(now);
      d.setMonth(0, 1);
      d.setHours(0, 0, 0, 0);
      return { from: d.getTime(), to: now, label: 'this year' };
    }
    default:
      return { from: startOfMonth(now), to: now, label: 'this month' };
  }
}

/** "1 day", "6 days". The model repeats these verbatim, so they have to read right. */
const days = (n: number): string => `${n} day${n === 1 ? '' : 's'}`;

const clampLimit = (v: unknown, max: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 1) return Math.min(5, max);
  return Math.min(Math.floor(n), max);
};

/** Resolves 'P4' back to a real party id without exposing the name. */
function partyFromToken(ctx: Ctx, token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const match = /^P(\d+)$/i.exec(token.trim());
  if (!match) return null;
  const party = ctx.data.parties[Number(match[1]) - 1];
  return party ? party.id : null;
}

/* ----------------------------------------------------------------- tools -- */

function moneyTotal(ctx: Ctx, args: Record<string, unknown>): ToolResult {
  const { from, to, label } = periodRange(args.period, ctx.now);
  const direction = args.direction === 'out' ? 'out' : 'in';

  let total = 0;
  let count = 0;
  for (const m of ctx.data.money) {
    if (m.direction !== direction || m.status !== 'settled') continue;
    const at = m.settledAt ?? m.at;
    if (at < from || at > to) continue;
    total += m.amount;
    count += 1;
  }

  // The comparison window is the same length immediately before, so "this month"
  // early on is not made to look like a collapse against a full month.
  const span = to - from;
  let previous = 0;
  for (const m of ctx.data.money) {
    if (m.direction !== direction || m.status !== 'settled') continue;
    const at = m.settledAt ?? m.at;
    if (at < from - span || at >= from) continue;
    previous += m.amount;
  }

  const verb = direction === 'in' ? 'taken' : 'spent';
  const change =
    previous > 0
      ? ` The same length of time before that was ${money(previous)}.`
      : '';

  return {
    ok: true,
    text: `${money(total)} ${verb} ${label}, across ${count} record${count === 1 ? '' : 's'}.${change}`,
    partyIds: [],
  };
}

function peopleList(ctx: Ctx, args: Record<string, unknown>): ToolResult {
  const limit = clampLimit(args.limit, 10);
  const status = String(args.status ?? 'quiet');
  const lines: string[] = [];
  const ids: string[] = [];

  const push = (id: string, detail: string) => {
    ids.push(id);
    lines.push(`- ${ctx.curtain.token(id)}: ${detail}`);
  };

  if (status === 'quiet') {
    const risky = atRiskParties(ctx.data, ctx.index, ctx.now).slice(0, limit);
    for (const r of risky) {
      const since = r.daysSinceSeen ?? 0;
      const gap = r.typicalGap ? `, usually every ${days(Math.round(r.typicalGap))}` : '';
      push(r.partyId, `last seen ${days(since)} ago${gap}`);
    }
  } else if (status === 'owing') {
    const owed = new Map<string, number>();
    for (const m of ctx.data.money) {
      if (m.direction !== 'in' || m.status === 'settled' || !m.partyId) continue;
      owed.set(m.partyId, (owed.get(m.partyId) ?? 0) + m.amount);
    }
    for (const [id, amount] of [...owed.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
      push(id, `owes ${money(amount)}`);
    }
  } else if (status === 'best') {
    const ranked = ctx.data.parties
      .map((p) => ({ id: p.id, value: partyValue(ctx.index, p.id, ctx.now).lifetime }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
    for (const r of ranked) push(r.id, `${money(r.value)} all time`);
  } else if (status === 'new') {
    const since = startOfMonth(ctx.now);
    for (const p of ctx.data.parties.filter((p) => p.joinedAt >= since).slice(0, limit)) {
      push(p.id, `joined ${days(Math.max(0, Math.round((ctx.now - p.joinedAt) / DAY)))} ago`);
    }
  } else if (status === 'expiring') {
    const soon = ctx.data.commitments
      .filter((c) => c.status === 'active' && c.endAt >= ctx.now && c.endAt <= ctx.now + 14 * DAY)
      .sort((a, b) => a.endAt - b.endAt)
      .slice(0, limit);
    for (const c of soon) {
      push(c.partyId, `ends in ${days(Math.max(0, Math.round((c.endAt - ctx.now) / DAY)))}`);
    }
  } else {
    return { ok: false, text: `No such status: ${status}.`, partyIds: [] };
  }

  if (lines.length === 0) {
    return { ok: true, text: `Nobody currently matches "${status}".`, partyIds: [] };
  }
  return { ok: true, text: `${lines.length} matching "${status}":\n${lines.join('\n')}`, partyIds: ids };
}

function personDetail(ctx: Ctx, args: Record<string, unknown>): ToolResult {
  const id = partyFromToken(ctx, args.token);
  if (!id) return { ok: false, text: 'That person is not on file.', partyIds: [] };

  const token = ctx.curtain.token(id);
  const value = partyValue(ctx.index, id, ctx.now);
  const churn = churnRead(ctx.data, ctx.index, id, ctx.now);
  const rely = reliability(ctx.index, id);
  const visits = ctx.index.engagementsByParty.get(id)?.length ?? 0;

  const parts = [
    `${token}: ${money(value.lifetime)} all time, ${money(value.runRate)} a year at the current rate.`,
    `${visits} visit${visits === 1 ? '' : 's'} on record.`,
    churn.daysSinceSeen === null
      ? 'Never seen in person.'
      : `Last seen ${days(churn.daysSinceSeen)} ago${churn.typicalGap ? `, normally every ${days(Math.round(churn.typicalGap))}` : ''}.`,
    value.outstanding > 0 ? `Owes ${money(value.outstanding)}.` : 'Owes nothing.',
    rely.samples > 0
      ? `Pays on time ${Math.round((rely.onTime / rely.samples) * 100)}% of the time (${rely.samples} payments).`
      : 'Not enough payment history to judge reliability.',
    churn.reasons.length > 0 ? `Risk of leaving: ${churn.reasons.join('; ')}.` : '',
  ].filter(Boolean);

  return { ok: true, text: parts.join(' '), partyIds: [id] };
}

function findings(ctx: Ctx, args: Record<string, unknown>): ToolResult {
  const limit = clampLimit(args.limit, 5);
  const found = generateInsights(ctx.profile, ctx.data, {
    now: ctx.now,
    limit,
    index: ctx.index,
  });
  if (found.length === 0) {
    return { ok: true, text: 'Nothing stands out right now — no findings above the noise floor.', partyIds: [] };
  }
  const text = found
    .map((f) => `- ${ctx.curtain.hide(f.title)}${f.detail ? ` (${ctx.curtain.hide(f.detail)})` : ''}`)
    .join('\n');
  return { ok: true, text: `The app's current findings:\n${text}`, partyIds: [] };
}

function cashOutlook(ctx: Ctx): ToolResult {
  const f = cashForecast(ctx.profile, ctx.data, ctx.index, ctx.now);
  const aging = agingBuckets(ctx.data, ctx.now).filter((b) => b.amount > 0);
  const overdue = aging
    .filter((b) => b.label !== 'Not yet due')
    .reduce((sum, b) => sum + b.amount, 0);

  return {
    ok: true,
    text:
      `About ${money(f.expected)} expected in the next 30 days: ${money(f.fromRenewals)} from renewals, ` +
      `${money(f.fromReceivables)} from unpaid invoices (already discounted by how reliably those people pay), ` +
      `${money(f.fromTrade)} from ordinary trade. Confidence ${Math.round(f.confidence * 100)}%.` +
      (overdue > 0 ? ` ${money(overdue)} is currently overdue.` : ''),
    partyIds: [],
  };
}

function busiestTimes(ctx: Ctx): ToolResult {
  const cells = capacityGrid(ctx.data, ctx.now);
  if (cells.length === 0) {
    return { ok: true, text: 'Not enough visits on record to see a pattern yet.', partyIds: [] };
  }
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const byDay = new Map<number, number>();
  const byHour = new Map<number, number>();
  for (const c of cells) {
    byDay.set(c.weekday, (byDay.get(c.weekday) ?? 0) + c.count);
    byHour.set(c.hour, (byHour.get(c.hour) ?? 0) + c.count);
  }
  const topDays = [...byDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const topHour = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
  const range = activeHourRange(cells);

  const hour12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;

  return {
    ok: true,
    text:
      `Busiest days: ${topDays.map(([d, n]) => `${DAYS[d]} (${n} visits)`).join(', ')}. ` +
      `Busiest hour is ${hour12(topHour[0])}. Activity runs ${hour12(range.from)} to ${hour12(range.to)}. ` +
      `Based on the last 8 weeks.`,
    partyIds: [],
  };
}

function overview(ctx: Ctx): ToolResult {
  const active = ctx.data.parties.filter((p) => !p.archivedAt).length;
  const seen90 = ctx.data.parties.filter((p) => {
    const last = ctx.index.lastSeen.get(p.id);
    return last != null && last >= ctx.now - 90 * DAY;
  }).length;
  const first = Math.min(...ctx.data.parties.map((p) => p.joinedAt), ctx.now);
  const months = Math.max(1, Math.round((ctx.now - first) / (30 * DAY)));

  return {
    ok: true,
    text:
      `${ctx.profile.name} is a ${ctx.profile.archetype} business. ` +
      `${active} ${plural(active, ctx.profile.vocabulary.party).toLowerCase()} on file, ${seen90} seen in the last 90 days. ` +
      `${ctx.data.engagements.length} visits and ${ctx.data.money.length} money records, over about ${months} months.`,
    partyIds: [],
  };
}

/* -------------------------------------------------------------- dispatch -- */

const HANDLERS: Record<string, (ctx: Ctx, args: Record<string, unknown>) => ToolResult> = {
  money_total: moneyTotal,
  people_list: peopleList,
  person_detail: personDetail,
  findings,
  cash_outlook: (ctx) => cashOutlook(ctx),
  busiest_times: (ctx) => busiestTimes(ctx),
  overview: (ctx) => overview(ctx),
};

export function runTool(
  call: ToolCall,
  profile: BusinessProfile,
  data: BusinessData,
  curtainRef: Curtain,
  now: number,
  index?: Index,
): ToolResult {
  const handler = HANDLERS[call.tool];
  if (!handler) {
    return { ok: false, text: `No tool called "${call.tool}".`, partyIds: [] };
  }
  const ctx: Ctx = { profile, data, index: index ?? buildIndex(data), now, curtain: curtainRef };
  try {
    return handler(ctx, call.args ?? {});
  } catch (err) {
    // A tool throwing must not take the conversation down with it — the model is
    // told the lookup failed and can say so honestly.
    return {
      ok: false,
      text: `That lookup failed: ${err instanceof Error ? err.message : 'unknown error'}.`,
      partyIds: [],
    };
  }
}

/** The tool menu, rendered for the planner prompt. */
export function toolMenu(): string {
  return TOOLS.map((t) => {
    const args = Object.entries(t.args)
      .map(([k, v]) => `    ${k}: ${v}`)
      .join('\n');
    return `- ${t.name}: ${t.description}${args ? `\n  args:\n${args}` : '\n  args: none'}`;
  }).join('\n');
}
