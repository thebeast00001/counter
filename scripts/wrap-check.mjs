/**
 * Exercises rings() and wrapMonth() against a spread of business shapes.
 *
 * Both are pure functions over the record set, so the interesting failures — a
 * ring that can exceed 1, a wrap card that names nobody, a month declared worth
 * reading when it holds three records — are all visible here without a device.
 *
 *   node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/wrap-check.mjs
 */

import { buildProfile, compile } from '@/domain/compile';
import { buildSeed } from '@/domain/seed';
import { buildIndex } from '@/domain/analytics';
import { rings } from '@/domain/today';
import { wrapMonth, wrappableMonths } from '@/domain/wrapped';

const CASES = [
  ['Sharma Classes', 'I teach maths to 120 students across six batches. Fees are collected monthly.'],
  ['Apex Motors', 'Car garage. People bring vehicles in for servicing and pay when they collect.'],
  ['Glow Salon', 'Hair and beauty salon, walk-ins and appointments, paid at the chair.'],
  ['Iron House', 'Gym with monthly and quarterly memberships, about 200 members.'],
  ['Verma Kirana', 'Small grocery shop. Most customers pay immediately, a few settle weekly.'],
];

const now = Date.parse('2026-08-28T14:30:00+05:30');
let failures = 0;

const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL ${msg}`);
};

for (const [name, description] of CASES) {
  const result = compile(description);
  const profile = buildProfile({
    name,
    description,
    archetype: result.archetype,
    shape: result.shape,
  });
  const data = buildSeed(profile, { parties: 60 });
  const index = buildIndex(data);

  console.log(`\n${name} — ${profile.archetype}`);

  const loops = rings(profile, data, now, index);
  if (loops.length !== 3) fail(`expected 3 rings, got ${loops.length}`);
  for (const r of loops) {
    if (!(r.progress >= 0 && r.progress <= 1)) fail(`${r.key} progress out of range: ${r.progress}`);
    if (!r.label || !r.detail) fail(`${r.key} missing label or detail`);
    if (r.target < 0 || r.done < 0) fail(`${r.key} negative counts`);
    if (/undefined|NaN/.test(`${r.label}${r.detail}`)) fail(`${r.key} leaked a placeholder: ${r.detail}`);
  }
  console.log(
    '  rings  ' +
      loops
        .map((r) => `${r.label} ${Math.round(r.progress * 100)}%${r.vacuous ? ' (nothing due)' : ''}`)
        .join(' · '),
  );

  const months = wrappableMonths(data, now);
  if (months.length > 12) fail(`wrappableMonths returned ${months.length}, cap is 12`);
  if (months.some((m, i) => i > 0 && m >= months[i - 1])) fail('months are not newest-first');

  const wrap = wrapMonth(profile, data, months[0] ?? now, now, index);
  console.log(`  wrap   ${wrap.label} · ${wrap.worth ? `${wrap.cards.length} cards` : 'not worth reading'}`);

  if (wrap.worth) {
    if (wrap.cards.length < 3) fail(`only ${wrap.cards.length} cards for a worthwhile month`);
    for (const c of wrap.cards) {
      if (!c.headline) fail(`card ${c.key} has an empty headline`);
      if (/undefined|NaN|null/.test(`${c.headline}${c.body}${c.eyebrow}`)) {
        fail(`card ${c.key} leaked a placeholder: ${c.headline} / ${c.body}`);
      }
    }
    if (!wrap.share || wrap.share.length < 20) fail('share text is too thin to send');
    for (const c of wrap.cards) console.log(`    · ${c.eyebrow} — ${c.headline}`);
  }
}

console.log(failures === 0 ? '\nAll checks pass.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
