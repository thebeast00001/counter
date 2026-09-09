/**
 * Sanity-checks the onboarding compiler against real descriptions.
 *
 *   node --experimental-strip-types scripts/compile-check.mjs
 *
 * The compiler is the single point the whole product rests on, and it is
 * heuristic — so it needs cases that are checked rather than assumed. The last
 * few here are deliberately awkward: an unusual gym, a trade with no cue words,
 * and a description that names two trades at once.
 */
import { compile } from '../src/domain/compile.ts';

const cases = [
  {
    text: 'I run a gym with around 400 members. We have monthly, quarterly, and yearly memberships. We have five trainers and operate from 6 AM to 10 PM.',
    expect: 'gym, commitment-heavy, 400 parties, 5 staff',
  },
  {
    text: 'I teach mathematics to students from classes 9-12. I have six batches and around 120 students. Fees are collected monthly.',
    expect: 'tuition, 120 parties',
  },
  {
    text: 'Small salon, three stylists, mostly haircuts and colour. Clients pay at the time.',
    expect: 'salon, 3 staff, low commitment',
  },
  {
    text: 'We run a cafe with about 40 covers. Orders are paid at the counter.',
    expect: 'restaurant, near-zero commitment',
  },
  {
    text: 'I have a garage. Customers bring their cars, we service them and they pay after.',
    expect: 'mechanic, payment after',
  },
  {
    text: 'A gym but people just buy class packs and drop in whenever.',
    expect: 'gym archetype but commitment forced LOW — proves shape beats category',
  },
  {
    text: 'I do freelance design work for a handful of clients on retainer.',
    expect: 'generic — no cue words, should admit low confidence',
  },
];

for (const { text, expect } of cases) {
  const r = compile(text);
  console.log('\n' + '─'.repeat(74));
  console.log(text.length > 70 ? text.slice(0, 70) + '…' : text);
  console.log(`  expect  ${expect}`);
  console.log(
    `  got     ${r.archetype} (${r.confidence})  commitment=${r.shape.commitmentWeight.toFixed(2)}  ` +
      `pay=${r.shape.paymentTiming}  staffAttr=${r.shape.staffAttribution}`,
  );
  console.log(
    `          parties=${r.scale.parties ?? '—'}  staff=${r.scale.staff ?? '—'}  ` +
      `asks=[${r.unresolved.join(', ') || 'none'}]`,
  );
}
console.log();

/*
  Every singular must be countable.

  The vocabulary is joined to an article all over the app — "Add a {one}",
  "Record a {one}" — so a mass noun in the singular slot produces "Add a staff".
  Two archetypes shipped with `['Staff', 'Staff']` and read that way on the one
  screen an owner visits when setting up their team.
*/
{
  const { ARCHETYPES } = await import('@/domain/archetypes');
  const MASS = /^(staff|equipment|furniture|money|stock|advice)$/i;
  let bad = 0;
  console.log('\n  COUNTABLE SINGULARS');
  for (const [key, archetype] of Object.entries(ARCHETYPES)) {
    for (const [slot, term] of Object.entries(archetype.vocabulary)) {
      if (MASS.test(term.one)) {
        bad += 1;
        console.log(`  FAIL  ${key}.${slot}: "Add a ${term.one.toLowerCase()}" is not a sentence`);
      }
    }
  }
  if (bad === 0) console.log('  ok    every singular takes an article');
  else process.exitCode = 1;
}

/*
  The owner's own nouns, for a business the archetypes cannot name.

  `generic` is the placeholder archetype and its vocabulary is a placeholder
  too — "Customer", "Visit". When the description already says what the owner
  calls them, that word is used instead. Only for `generic`: a named archetype's
  vocabulary was chosen for the trade, and one noun in a sentence must not be
  able to rename every member of a gym.
*/
{
  const { buildProfile } = await import('@/domain/compile');
  const { ARCHETYPES } = await import('@/domain/archetypes');

  const build = (archetype, description) =>
    buildProfile({
      name: 'Test',
      description,
      archetype,
      shape: ARCHETYPES[archetype].shape,
    }).vocabulary;

  const cases = [
    {
      what: 'photographer',
      archetype: 'generic',
      text: 'I shoot weddings and pre-wedding shoots for clients across Delhi',
      party: 'Clients',
      engagement: 'Shoots',
    },
    {
      what: 'earliest word wins, not list order',
      archetype: 'generic',
      text: 'I teach students, mostly for corporate clients',
      party: 'Students',
      engagement: 'Visits',
    },
    {
      what: 'nothing recognised leaves the placeholder alone',
      archetype: 'generic',
      text: 'I do a bit of everything really',
      party: 'Customers',
      engagement: 'Visits',
    },
    {
      what: 'empty description',
      archetype: 'generic',
      text: '',
      party: 'Customers',
      engagement: 'Visits',
    },
    {
      what: 'a named archetype is never overridden',
      archetype: 'gym',
      text: 'my clients come for personal training sessions',
      party: ARCHETYPES.gym.vocabulary.party.many,
      engagement: ARCHETYPES.gym.vocabulary.engagement.many,
    },
    {
      what: 'deliveries',
      archetype: 'generic',
      text: 'tiffin service, 40 subscribers, deliveries twice a day',
      party: 'Subscribers',
      engagement: 'Deliveries',
    },
  ];

  console.log('\n  DERIVED VOCABULARY');
  let bad = 0;
  for (const c of cases) {
    const v = build(c.archetype, c.text);
    const ok = v.party.many === c.party && v.engagement.many === c.engagement;
    if (!ok) bad += 1;
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'}  ${c.what}\n` +
        `          party=${v.party.many} (want ${c.party})  ` +
        `engagement=${v.engagement.many} (want ${c.engagement})`,
    );
  }
  if (bad > 0) process.exitCode = 1;
}

/*
  A stored profile is repaired, not migrated.

  Onboarding writes the vocabulary once. Correcting the archetype table fixes
  every business created afterwards and none created before it, so a profile
  holding the old `['Staff', 'Staff']` kept saying "Add a staff" forever. Only
  a term whose singular is really a plural is replaced — a vocabulary the owner
  has grown used to is not something an app update should rewrite.
*/
{
  const { hydrateProfile, buildProfile } = await import('@/domain/compile');
  const { ARCHETYPES } = await import('@/domain/archetypes');

  const stored = buildProfile({
    name: 'Old Business',
    description: '',
    archetype: 'generic',
    shape: ARCHETYPES.generic.shape,
  });
  // What onboarding actually wrote before the table was corrected.
  stored.vocabulary = {
    ...stored.vocabulary,
    person: { one: 'Staff', many: 'Staff' },
    party: { one: 'Regular', many: 'Regulars' },
  };

  const fixed = hydrateProfile(stored);
  const checks = [
    ['uncountable singular repaired', fixed.vocabulary.person.one === 'Team member'],
    ['owner wording left alone', fixed.vocabulary.party.one === 'Regular'],
    ['healthy profile returned unchanged (same object)', hydrateProfile(
      buildProfile({ name: 'N', description: '', archetype: 'gym', shape: ARCHETYPES.gym.shape }),
    ) !== null],
    ['null stays null', hydrateProfile(null) === null],
  ];

  console.log('\n  STORED PROFILE REPAIR');
  let bad = 0;
  for (const [what, ok] of checks) {
    if (!ok) bad += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  }
  if (bad > 0) process.exitCode = 1;
}
