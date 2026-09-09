/**
 * Where the time actually goes.
 *
 * Imports the real domain modules and times each computation a screen performs,
 * against a roster larger than the seed produces. Guessing at performance is how
 * you end up optimising the wrong loop — this prints the bill.
 *
 *   node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/perf-check.mjs
 */

import { buildProfile, compile } from '@/domain/compile';
import { buildSeed } from '@/domain/seed';
import {
  atRiskParties,
  buildIndex,
  capacityGrid,
  cohorts,
  churnRead,
  firstNinetyDays,
  partyValue,
  quietThresholdDays,
  referralGraph,
  reliability,
  seasonality,
} from '@/domain/analytics';
import { generateInsights } from '@/domain/insights';
import { explainMetric, explainParty } from '@/domain/explain';
import { headlineMetrics } from '@/domain/metrics';
import { briefing, nowStrip, primaryAction, pulse } from '@/domain/today';
import { detectDrift, segments, simulatePriceChange } from '@/domain/intel';
import { reconcile, refreshObserved } from '@/domain/memory';
import { ask } from '@/domain/query';

const now = Date.now();

function time(label, fn, runs = 20) {
  // One warm pass so JIT compilation is not billed to the first measurement.
  fn();
  const start = performance.now();
  for (let i = 0; i < runs; i++) fn();
  const total = performance.now() - start;
  return { label, ms: total / runs };
}

function report(rows, budget) {
  rows.sort((a, b) => b.ms - a.ms);
  for (const row of rows) {
    const flag = row.ms > budget ? '  ⚠' : '';
    console.log(`  ${row.ms.toFixed(2).padStart(8)} ms   ${row.label}${flag}`);
  }
}

for (const scale of [90, 400, 1200]) {
  const result = compile('I teach maths to 120 students across six batches. Fees are collected monthly.');
  const profile = buildProfile({
    name: 'Sharma Classes',
    description: 'I teach maths to 120 students across six batches.',
    archetype: result.archetype,
    shape: result.shape,
  });
  const data = buildSeed(profile, { parties: scale });

  console.log('');
  console.log('═'.repeat(74));
  console.log(
    `${data.parties.length} parties · ${data.engagements.length} engagements · ${data.money.length} money`,
  );
  console.log('─'.repeat(74));

  const index = buildIndex(data);

  const rows = [
    time('buildIndex', () => buildIndex(data)),
    time('headlineMetrics', () => headlineMetrics(profile, data, now)),
    time('generateInsights (home, budget 2)', () => generateInsights(profile, data, { now, index })),
    time('generateInsights (insights, limit 8)', () =>
      generateInsights(profile, data, { now, limit: 8, index }),
    ),
    time('briefing', () => briefing(profile, data, now, index)),
    time('pulse', () => pulse(data, now)),
    time('nowStrip', () => nowStrip(profile, data, now)),
    time('primaryAction', () => primaryAction(profile, data, now)),
    time('atRiskParties', () => atRiskParties(data, index, now)),
    time('quietThresholdDays', () => quietThresholdDays(profile, data, index)),
    time('firstNinetyDays', () => firstNinetyDays(data, index, now)),
    time('cohorts', () => cohorts(data, index, now, 6)),
    time('segments', () => segments(profile, data, now, index)),
    time('capacityGrid', () => capacityGrid(data, now)),
    time('seasonality', () => seasonality(data, now)),
    time('referralGraph', () => referralGraph(data, index, now)),
    time('detectDrift', () => detectDrift(profile, data, now)),
    time('simulatePriceChange', () => simulatePriceChange(profile, data, 10, now, index)),
    time('refreshObserved', () => refreshObserved(profile, data, now)),
    time('reconcile', () => reconcile(data, now)),
    time('explainMetric(revenue)', () => explainMetric('revenue', profile, data, now)),
    time('explainMetric(due)', () => explainMetric('due', profile, data, now)),
    time('explainParty', () => explainParty(profile, data, data.parties[0].id, now, index)),
    time('ask(who owes me)', () => ask(profile, data, 'who owes me money', now)),
    // The roster recomputes a churn read for every row on every keystroke.
    time('roster: churnRead × all', () => {
      for (const p of data.parties) churnRead(data, index, p.id, now);
    }),
    time('roster: partyValue × all', () => {
      for (const p of data.parties) partyValue(index, p.id, now);
    }),
    time('reliability × all', () => {
      for (const p of data.parties) reliability(index, p.id);
    }),
  ];

  // 16ms is one frame at 60fps. Anything above it drops frames on the main
  // thread; anything above 100ms is felt as a stall.
  report(rows, 16);

  const total = rows.reduce((s, r) => s + r.ms, 0);
  console.log('─'.repeat(74));
  console.log(`  ${total.toFixed(2).padStart(8)} ms   everything above, once`);
}

console.log('');
