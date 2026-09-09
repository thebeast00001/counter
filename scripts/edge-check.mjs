/**
 * Runs the whole derivation layer against the states a business actually passes
 * through, and asserts that none of them throws or produces a nonsense figure.
 *
 *   node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/edge-check.mjs
 *
 * The state that matters most is the first one. Every screen in this app is
 * computed from records, and on the morning somebody finishes onboarding there
 * are none — `emptyData()`, not a seed. A `reduce` without an initial value, a
 * `Math.max` over an empty list, or a divide by a count of zero all look fine
 * against a year of history and take down the home screen on day one, which is
 * the single worst moment for it to happen.
 *
 * The other fixtures are the shapes that broke something before: one record and
 * nothing else, money with no people, people with no money, and a business whose
 * records are all in the future because somebody's clock is wrong.
 */

import { ARCHETYPES } from '@/domain/archetypes';
import { buildProfile } from '@/domain/compile';
import { buildSeed, emptyData } from '@/domain/seed';
import { buildIndex } from '@/domain/analytics';
import * as analytics from '@/domain/analytics';
import * as automation from '@/domain/automation';
import * as explain from '@/domain/explain';
import * as insights from '@/domain/insights';
import * as intel from '@/domain/intel';
import * as memory from '@/domain/memory';
import * as metrics from '@/domain/metrics';
import * as query from '@/domain/query';
import * as schedule from '@/domain/schedule';
import * as today from '@/domain/today';
import * as wrapped from '@/domain/wrapped';

const NOW = Date.parse('2026-09-03T10:15:00+05:30');
const DAY = 86_400_000;

let failures = 0;

function fail(fixture, label, detail) {
  failures += 1;
  console.log(`  FAIL  ${fixture} · ${label}`);
  console.log(`        ${detail}`);
}

/**
 * A value is "sane" if a person could read it off a screen without concluding
 * the app is broken. Infinity and NaN are the two that leak through arithmetic
 * over empty collections, and both render as literal text.
 */
/**
 * Bucket bounds are legitimately open-ended — `agingBuckets` uses ±Infinity to
 * mean "no lower/upper limit" and never renders them. Nothing else may.
 */
const OPEN_ENDED = /\.(from|to)$/;

/**
 * Singular nouns that already end in "s", so "1 business" is correct English.
 *
 * `Class` is on the list because it is the tuition archetype's own singular for
 * an engagement — the check must not force "1 clas".
 */
const SINGULAR_IN_S = new Set([
  'business', 'class', 'address', 'status', 'series', 'bus', 'pass', 'gas',
  'lens', 'process', 'access', 'loss', 'glass', 'press', 'cross', 'analysis',
  'basis', 'focus', 'bonus', 'campus', 'virus', 'census', 'sms', 'plus',
  'minus', 'gross', 'less',
]);

function checkValue(fixture, label, value, seen = new Set()) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) && !Number.isNaN(value) && OPEN_ENDED.test(label)) return;
    if (Number.isNaN(value)) fail(fixture, label, 'NaN');
    else if (!Number.isFinite(value)) fail(fixture, label, `${value}`);
    return;
  }
  if (typeof value === 'string') {
    if (/NaN|Infinity|undefined|\[object Object\]/.test(value)) {
      fail(fixture, label, `text reads "${value.slice(0, 90)}"`);
    }
    /*
      "1 visits".

      Every label in this app is built from the business's own vocabulary, which
      stores a singular and a plural, and the plural is the one that is easy to
      reach for. Fourteen strings joined a count to it unconditionally, so the
      first customer read "1 Customers" and the first visit "1 visits written
      down today" — on the first screen of the owner's first day, which is not
      where a product wants to look careless.

      The `one-person` fixture exists to produce exactly one of everything, so
      this catches the next one at the moment it is written rather than on a
      device six screens deep.
    */
    const singular = value.match(/\b1 ([A-Za-z][a-z-]+s)\b/);
    if (singular && !SINGULAR_IN_S.has(singular[1].toLowerCase())) {
      fail(fixture, label, `plural after 1: "${singular[0]}" in "${value.slice(0, 90)}"`);
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkValue(fixture, `${label}[${i}]`, v, seen));
    return;
  }
  for (const [k, v] of Object.entries(value)) checkValue(fixture, `${label}.${k}`, v, seen);
}

function run(fixture, label, fn) {
  let out;
  try {
    out = fn();
  } catch (e) {
    fail(fixture, label, `threw ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
  checkValue(fixture, label, out);
  return out;
}

/* ------------------------------------------------------------------ fixtures */

/*
  A real archetype shape, not an invented one.

  This used to pass `{ size: 'small', pace: 'steady' }` — the *onboarding draft's*
  shape, not the compiled `BusinessShape` that `buildProfile` actually takes. The
  result was a profile whose `commitmentWeight` was `undefined`, so every branch
  guarded by `shape.commitmentWeight > 0.3` — the renewals half of the cash
  forecast among them — was skipped in every fixture. The sweep passed by never
  reaching the code.
*/
const profile = buildProfile({
  name: 'Test Studio',
  ownerName: 'Owner',
  archetype: 'gym',
  shape: ARCHETYPES.gym.shape,
  description: 'A gym.',
});

/** Day one: onboarding finished, nothing recorded. This is the important one. */
const empty = emptyData();

/** One person, nothing else — the state after the very first thing is added. */
const onePerson = {
  ...emptyData(),
  parties: [{ id: 'p1', name: 'A Person', joinedAt: NOW - DAY, contactable: true }],
};

/** Money with nobody attached to it, which cash-only businesses produce. */
const moneyOnly = {
  ...emptyData(),
  money: [
    {
      id: 'm1',
      amount: 500,
      direction: 'in',
      status: 'settled',
      at: NOW - DAY,
      label: 'Walk-in',
    },
  ],
};

/*
  Exactly one of everything, and dated so it counts today.

  Not a variation on `one-person` — that one holds a single party and nothing
  else, so every count derived from it is zero and every plural in the app comes
  out correct by accident. This is the shape an owner is in an hour after
  onboarding: one visit written down, one payment taken, one still owed, one
  plan about to run out, one thing on the timetable. It is the only fixture that
  makes the app say "1" out loud, which is the whole point of it.
*/
const DAY_START = new Date(NOW).setHours(0, 0, 0, 0);
const firstDay = {
  ...emptyData(),
  parties: [{ id: 'p1', name: 'First Customer', joinedAt: NOW - 2 * DAY, contactable: true }],
  offerings: [{ id: 'o1', name: 'Monthly plan', price: 1200, durationDays: 30, active: true }],
  engagements: [
    { id: 'e1', partyId: 'p1', at: DAY_START + 9 * 3_600_000, source: 'manual' },
  ],
  money: [
    {
      id: 'm1',
      partyId: 'p1',
      amount: 1200,
      direction: 'in',
      status: 'settled',
      at: DAY_START + 9 * 3_600_000,
      settledAt: DAY_START + 9 * 3_600_000,
      label: 'Monthly plan',
      method: 'upi',
    },
    {
      id: 'm2',
      partyId: 'p1',
      amount: 800,
      direction: 'in',
      status: 'due',
      at: NOW - 40 * DAY,
      dueAt: NOW - 40 * DAY,
      label: 'Balance',
    },
    {
      id: 'm3',
      amount: 300,
      direction: 'out',
      status: 'settled',
      at: NOW - DAY,
      label: 'Cleaning',
      category: 'supplies',
    },
  ],
  commitments: [
    {
      id: 'c1',
      partyId: 'p1',
      offeringId: 'o1',
      startAt: NOW - 27 * DAY,
      endAt: NOW + 3 * DAY,
      price: 1200,
      status: 'active',
    },
  ],
  templates: [
    {
      id: 't1',
      name: 'Evening batch',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      // Later today, not earlier. A session that has already run makes the
      // "recorded" ring count sessions instead of loose visits, and the loose
      // branch is the one that said "1 visits".
      minuteOfDay: 23 * 60,
      partyIds: ['p1'],
      active: true,
    },
  ],
  obligations: [
    {
      id: 'ob1',
      kind: 'custom',
      dueAt: NOW + 5 * DAY,
      label: 'Trade licence renewal',
      done: false,
      leadDays: 21,
    },
  ],
  staff: [{ id: 's1', name: 'Owner', role: 'owner', active: true }],
};

/** People with no money at all — a free trial cohort, or a new till. */
const peopleNoMoney = {
  ...emptyData(),
  parties: Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`,
    name: `Person ${i}`,
    joinedAt: NOW - (i + 1) * DAY,
    contactable: true,
  })),
};

/** A wrong device clock: everything is dated in the future. */
const seeded = buildSeed(profile, NOW);
const future = {
  ...seeded,
  engagements: seeded.engagements.map((e) => ({ ...e, at: e.at + 400 * DAY })),
  money: seeded.money.map((m) => ({ ...m, at: m.at + 400 * DAY })),
};

const FIXTURES = [
  ['empty', empty],
  ['one-person', onePerson],
  ['money-only', moneyOnly],
  ['people-no-money', peopleNoMoney],
  ['first-day', firstDay],
  ['seeded', seeded],
  ['future-dated', future],
];

/* --------------------------------------------------------------------- sweep */

console.log('\n  EDGE CHECK\n  ' + '-'.repeat(58));

for (const [name, data] of FIXTURES) {
  const idx = run(name, 'buildIndex', () => buildIndex(data));
  if (!idx) continue;

  const firstParty = data.parties[0]?.id;

  // -- metrics
  run(name, 'headlineMetrics', () => metrics.headlineMetrics(profile, data, NOW, idx));
  run(name, 'outstanding', () => metrics.outstanding(data));
  run(name, 'activeCommitments', () => metrics.activeCommitments(data, NOW));
  run(name, 'expiringWithin', () => metrics.expiringWithin(data, NOW, 7));
  run(name, 'revenueBetween', () => metrics.revenueBetween(data, NOW - 30 * DAY, NOW));
  run(name, 'lapsedParties', () => metrics.lapsedParties(data, NOW, 21));

  // -- analytics
  run(name, 'quietThresholdDays', () => analytics.quietThresholdDays(profile, data, idx));
  run(name, 'atRiskParties', () => analytics.atRiskParties(data, idx, NOW));
  run(name, 'agingBuckets', () => analytics.agingBuckets(data, NOW));
  run(name, 'cashForecast', () => analytics.cashForecast(profile, data, idx, NOW));
  run(name, 'breakEven', () => analytics.breakEven(data, NOW));
  run(name, 'cohorts', () => analytics.cohorts(data, idx, NOW, 6));
  run(name, 'capacityGrid', () => analytics.capacityGrid(data, NOW));
  run(name, 'seasonality', () => analytics.seasonality(data, NOW));
  run(name, 'noShows', () => analytics.noShows(data, NOW));
  run(name, 'referralGraph', () => analytics.referralGraph(data, idx, NOW));
  run(name, 'recentlyContacted', () => analytics.recentlyContacted(data, NOW));
  run(name, 'firstNinetyDays', () => analytics.firstNinetyDays(data, idx, NOW));
  if (firstParty) {
    run(name, 'churnRead', () => analytics.churnRead(data, idx, firstParty, NOW));
    run(name, 'partyValue', () => analytics.partyValue(idx, firstParty, NOW));
    run(name, 'reliability', () => analytics.reliability(idx, firstParty));
    run(name, 'typicalGapDays', () => analytics.typicalGapDays(idx, firstParty));
  }

  // -- today
  run(name, 'pulse', () => today.pulse(data, NOW));
  run(name, 'rings', () => today.rings(profile, data, NOW, idx));
  run(name, 'briefing', () => today.briefing(profile, data, NOW, idx));
  run(name, 'nowStrip', () => today.nowStrip(profile, data, NOW));
  run(name, 'primaryAction', () => today.primaryAction(profile, data, NOW));
  run(name, 'businessMood', () => today.businessMood(profile, data, NOW, idx));
  run(name, 'moodMessage', () => today.moodMessage(profile, data, NOW, idx));

  // -- the intelligence layer
  run(name, 'generateInsights', () => insights.generateInsights(profile, data, { now: NOW, index: idx }));
  run(name, 'segments', () => intel.segments(profile, data, NOW, idx));
  run(name, 'detectDrift', () => intel.detectDrift(profile, data, NOW));
  run(name, 'counterfactuals', () => intel.counterfactuals(profile, data, NOW, idx));
  run(name, 'calibration', () => intel.calibration(data, NOW));
  run(name, 'makeForecast', () => intel.makeForecast(data, NOW));
  run(name, 'scoreForecasts', () => intel.scoreForecasts(data, NOW));
  run(name, 'findDuplicates', () => intel.findDuplicates(data));
  run(name, 'simulatePriceChange', () => intel.simulatePriceChange(profile, data, 10, NOW, idx));

  // -- memory
  run(name, 'reconcile', () => memory.reconcile(data, NOW));
  run(name, 'observeFacts', () => memory.observeFacts(profile, data, NOW));
  run(name, 'detectEvents', () => memory.detectEvents(data, NOW));
  run(name, 'anniversaries', () => memory.anniversaries(data, NOW));
  run(name, 'captureRead', () => memory.captureRead(data, NOW));

  // -- automation and schedule
  run(name, 'defaultRules', () => automation.defaultRules(profile, NOW));
  run(name, 'isUnusual', () => automation.isUnusual(data, NOW));
  run(name, 'automationReceipts', () => automation.automationReceipts(data));
  run(name, 'unrecorded', () => schedule.unrecorded(data, NOW));
  run(name, 'nextOccurrence', () => schedule.nextOccurrence(data, NOW));
  run(name, 'clashes', () => schedule.clashes(data));
  run(name, 'scheduledDays', () => schedule.scheduledDays(data, NOW, NOW + 7 * DAY));
  run(name, 'monthGrid', () => schedule.monthGrid(data, NOW, NOW));
  run(name, 'usesSchedule', () => schedule.usesSchedule(profile, data));

  // -- the wrap, and every month it claims to be able to render
  const months = run(name, 'wrappableMonths', () => wrapped.wrappableMonths(data, NOW)) ?? [];
  run(name, 'wrapMonth(now)', () => wrapped.wrapMonth(profile, data, NOW, NOW, idx));
  for (const m of months.slice(0, 3)) {
    const at = typeof m === 'number' ? m : (m?.at ?? m?.start ?? NOW);
    run(name, `wrapMonth(${new Date(at).toISOString().slice(0, 7)})`, () =>
      wrapped.wrapMonth(profile, data, at, NOW, idx),
    );
  }

  // -- every explanation the app can open
  for (const key of ['revenue', 'outstanding', 'active', 'engagements', 'parties', 'expiring', 'new']) {
    run(name, `explainMetric(${key})`, () => explain.explainMetric(key, profile, data, NOW));
  }
  if (firstParty) {
    run(name, 'explainParty', () => explain.explainParty(profile, data, firstParty, NOW, idx));
  }

  // -- the offline answerer, on the questions it claims to handle
  for (const q of [
    'how much did i make today',
    'who owes me money',
    'who has gone quiet',
    'how many people do i have',
    'what is my busiest day',
    '',
    '???',
  ]) {
    run(name, `ask("${q}")`, () => query.ask(profile, data, q, NOW));
  }

  console.log(`  ${failures === 0 ? 'ok  ' : '    '} ${name.padEnd(16)} swept`);
}

console.log('\n  ' + '-'.repeat(58));
if (failures === 0) {
  console.log('  All fixtures derive cleanly.\n');
} else {
  console.log(`  ${failures} problem${failures === 1 ? '' : 's'}.\n`);
  process.exit(1);
}
