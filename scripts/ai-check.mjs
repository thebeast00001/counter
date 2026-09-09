/**
 * Proves the curtain holds and the tools answer.
 *
 * The redaction layer is the one part of the AI engine whose failure is silent
 * and unrecoverable: if a name slips through, it is on someone else's server
 * before anyone notices, and no later fix retrieves it. So this asserts the
 * negative directly — that no real name, first name or phone number survives
 * into anything bound for the network.
 *
 *   node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/ai-check.mjs
 */

import { buildProfile, compile } from '@/domain/compile';
import { buildSeed } from '@/domain/seed';
import { buildIndex } from '@/domain/analytics';
import { curtain } from '@/ai/redact';
import { runTool, TOOLS, toolMenu } from '@/ai/tools';

const now = Date.parse('2026-08-28T14:30:00+05:30');
let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL ${msg}`);
};

const result = compile('I run a gym with monthly memberships, about 200 members.');
const profile = buildProfile({
  name: 'Iron House',
  description: 'I run a gym with monthly memberships.',
  archetype: result.archetype,
  shape: result.shape,
});
const data = buildSeed(profile, { parties: 40 });
const index = buildIndex(data);
const screen = curtain(data);

console.log(`${data.parties.length} parties · curtain covers ${screen.size}`);

/* ------------------------------------------------------------ the curtain -- */

console.log('\nCURTAIN');

// Every name, every first name of four letters or more, every phone.
const secrets = [];
for (const p of data.parties) {
  secrets.push(p.name);
  const first = p.name.split(' ')[0];
  if (first.length >= 4) secrets.push(first);
  if (p.phone) secrets.push(p.phone);
}
for (const s of data.staff) secrets.push(s.name);

function assertClean(label, text) {
  const leaked = secrets.filter((s) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  if (leaked.length > 0) {
    fail(`${label} leaked: ${[...new Set(leaked)].slice(0, 5).join(', ')}`);
    return false;
  }
  return true;
}

const someone = data.parties[3];
const questions = [
  `How much has ${someone.name} paid me this year?`,
  `Is ${someone.name.split(' ')[0]} still coming?`,
  `Call ${someone.phone ?? '9876543210'} about the overdue fee`,
  'Who owes me money and who has stopped coming?',
  `Compare ${data.parties[0].name} and ${data.parties[1].name}`,
];

for (const q of questions) {
  const hidden = screen.hide(q);
  if (assertClean(`question "${q.slice(0, 34)}…"`, hidden)) {
    console.log(`  clean  ${hidden.slice(0, 68)}`);
  }
}

// Round trip: tokens must come back as the same names.
const original = `How much has ${someone.name} paid?`;
const round = screen.reveal(screen.hide(original));
if (!round.includes(someone.name)) {
  fail(`reveal did not restore "${someone.name}" — got "${round}"`);
} else {
  console.log(`  reveal restores names`);
}

// A digit run that belongs to nobody on file must still be scrubbed.
const stray = screen.hide('my other number is 9812345678');
if (/98123/.test(stray)) fail(`stray phone number survived: ${stray}`);
else console.log(`  stray numbers scrubbed`);

/* --------------------------------------------------------------- the tools -- */

console.log('\nTOOLS');

const calls = [
  { tool: 'overview', args: {} },
  { tool: 'money_total', args: { period: 'this_month', direction: 'in' } },
  { tool: 'money_total', args: { period: 'last_month', direction: 'out' } },
  { tool: 'people_list', args: { status: 'quiet', limit: 3 } },
  { tool: 'people_list', args: { status: 'owing', limit: 3 } },
  { tool: 'people_list', args: { status: 'best', limit: 3 } },
  { tool: 'people_list', args: { status: 'expiring', limit: 3 } },
  { tool: 'people_list', args: { status: 'new', limit: 3 } },
  { tool: 'person_detail', args: { token: 'P4' } },
  { tool: 'findings', args: { limit: 3 } },
  { tool: 'cash_outlook', args: {} },
  { tool: 'busiest_times', args: {} },
  // Deliberately broken input: the engine must degrade, not throw.
  { tool: 'person_detail', args: { token: 'nonsense' } },
  { tool: 'people_list', args: { status: 'wrong' } },
  { tool: 'no_such_tool', args: {} },
];

for (const call of calls) {
  const out = runTool(call, profile, data, screen, now, index);
  const flat = out.text.replace(/\n/g, ' ');
  assertClean(`tool ${call.tool}`, out.text);
  if (out.ok && /undefined|NaN|\[object/.test(out.text)) {
    fail(`tool ${call.tool} leaked a placeholder: ${flat.slice(0, 80)}`);
  }
  if (out.ok && out.text.trim().length === 0) fail(`tool ${call.tool} returned nothing`);
  console.log(`  ${out.ok ? 'ok  ' : 'soft'} ${call.tool.padEnd(14)} ${flat.slice(0, 88)}`);
}

/* --------------------------------------------------------------- the menu -- */

const menu = toolMenu();
if (TOOLS.some((t) => !menu.includes(t.name))) fail('tool menu is missing a tool');
console.log(`\n  menu lists ${TOOLS.length} tools, ${menu.length} chars`);


/*
  The two decisions that stand between a question and an answer.

  Both used to be buried inside `request`, and both were wrong in a way no test
  could see. The provider has since changed from OpenRouter to Sarvam and both
  went wrong again, differently — which is the argument for pinning them rather
  than for pinning one provider's quirks:

  - Sarvam answers a **rejected key with 403**, the status the classifier read
    as "this one model will not serve". A wrong key therefore walked the whole
    roster and reported that no model was available.
  - Sarvam's model rows carry **no pricing and no modality**, so a filter
    written against OpenRouter's richer rows rejected every model on offer.
*/
{
  const { chatModels, classifyFailure } = await import('@/ai/provider');

  // Copied from a live `GET https://api.sarvam.ai/v1/models`. The whole row.
  const catalogue = [
    { id: 'sarvam-105b', object: 'model', created: 0, owned_by: 'sarvam' },
    { id: 'sarvam-105b-conversations', object: 'model', created: 0, owned_by: 'sarvam' },
  ];

  const picked = chatModels(catalogue).map((m) => m.id);
  const rosterChecks = [
    ['a row with only an id survives', picked.length === 2],
    [
      'the model that answers is tried before the one that thinks',
      picked[0] === 'sarvam-105b-conversations',
    ],
    [
      'the thinking model is flagged, so the picker can warn',
      chatModels(catalogue).find((m) => m.id === 'sarvam-105b')?.reasoning === true,
    ],
    [
      'the conversational model is not flagged',
      chatModels(catalogue).find((m) => m.id === 'sarvam-105b-conversations')?.reasoning === false,
    ],
    ['an empty catalogue is empty, not a throw', chatModels([]).length === 0],
    ['a row with no id is dropped', chatModels([{ id: '' }, ...catalogue]).length === 2],
  ];

  // Every message and status below came back from the live API.
  const failureChecks = [
    [
      'a rejected key is a 403 here, and must still stop the run',
      classifyFailure(403, 'Invalid or missing authentication credentials', 'invalid_api_key_error') ===
        'refused',
    ],
    [
      'and is still recognised without a code, from the wording alone',
      classifyFailure(403, 'Invalid or missing authentication credentials', null) === 'refused',
    ],
    [
      'an unknown model is a bad request, not a dead model',
      classifyFailure(
        400,
        "body.model : Value error, Input 'does-not-exist' should be one of sarvam-105b",
        'invalid_request_error',
      ) === 'bad-response',
    ],
    ['busy is retryable', classifyFailure(429, 'Rate limit exceeded', null) === 'rate-limited'],
    [
      'a 403 that is genuinely about one model still falls through',
      classifyFailure(403, 'This model is not enabled for your account', null) ===
        'model-unavailable',
    ],
    [
      'a data-policy rejection stops the run',
      classifyFailure(404, 'No endpoints found matching your data policy', null) === 'policy',
    ],
    ['anything else is a bad response', classifyFailure(500, 'boom', null) === 'bad-response'],
  ];

  console.log('\n  MODEL ROSTER AND FAILURES');
  let bad = 0;
  for (const [what, ok] of [...rosterChecks, ...failureChecks]) {
    if (!ok) bad += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  }
  if (bad > 0) process.exitCode = 1;
}

console.log(failures === 0 ? '\nAll checks pass.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
