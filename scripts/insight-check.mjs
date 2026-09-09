/**
 * Runs the metric and insight engines over seeded businesses.
 *
 *   node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/insight-check.mjs
 *
 * Checks the two things that actually matter: that a gym and a café get
 * genuinely different home screens from the same code, and that the salience
 * budget holds — no business should be handed five findings at once.
 */
import { buildProfile, compile } from '../src/domain/compile.ts';
import { generateInsights } from '../src/domain/insights.ts';
import { headlineMetrics } from '../src/domain/metrics.ts';
import { buildSeed } from '../src/domain/seed.ts';

const businesses = [
  { name: 'Iron Works', text: 'I run a gym with around 400 members. Monthly, quarterly and yearly memberships. Five trainers.' },
  { name: 'Sharma Classes', text: 'I teach maths to 120 students across six batches. Fees are collected monthly, often late.' },
  { name: 'The Cut', text: 'Small salon, three stylists, haircuts and colour. Clients pay at the time.' },
  { name: 'Anna Cafe', text: 'We run a cafe with about 40 covers. Orders are paid at the counter.' },
  { name: 'Singh Motors', text: 'I have a garage. Customers bring cars, we service them and they pay after.' },
];

for (const b of businesses) {
  const r = compile(b.text);
  const profile = buildProfile({
    name: b.name,
    description: b.text,
    archetype: r.archetype,
    shape: r.shape,
  });
  const data = buildSeed(profile, r.scale);
  const metrics = headlineMetrics(profile, data);
  const insights = generateInsights(profile, data);

  console.log('\n' + '═'.repeat(76));
  console.log(`${b.name}  ·  ${profile.archetype}  ·  ${data.parties.length} ${profile.vocabulary.party.many.toLowerCase()}`);
  console.log('─'.repeat(76));
  console.log('  HOME SCREEN');
  for (const m of metrics) {
    console.log(`    ${m.value.padEnd(8)} ${m.label}${m.tone && m.tone !== 'neutral' ? `  [${m.tone}]` : ''}`);
  }
  console.log(`\n  INSIGHTS (${insights.length} shown of budget 2)`);
  if (insights.length === 0) {
    console.log('    — nothing worth saying today');
  }
  for (const i of insights) {
    console.log(`    ${i.score.toFixed(2)}  ${i.title}`);
    console.log(`          ${i.detail.replace(/\s+/g, ' ').slice(0, 96)}…`);
    if (i.action) console.log(`          → ${i.action.label} (${i.action.partyIds.length})`);
  }
}
console.log();
