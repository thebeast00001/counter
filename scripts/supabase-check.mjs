/**
 * Asserts the Supabase config screen refuses everything it must refuse.
 *
 *   node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/supabase-check.mjs
 *
 * Row Level Security is the only thing separating one business's records from
 * another's, and it is enforced by the *key the app holds*. Paste the wrong one
 * and nothing breaks: the app works perfectly, every screen loads, and every
 * tenant's customer names, phone numbers and debts are readable by anyone who
 * installs it. There is no error state to notice, which is exactly why this is
 * checked by a script rather than trusted to a careful moment.
 *
 * Supabase issues two client keys and two admin keys, and each pair looks alike:
 *
 *              safe in an app          catastrophic in an app
 *   current    sb_publishable_…        sb_secret_…
 *   legacy     JWT role: anon          JWT role: service_role
 *
 * Every key below is synthetic. Real ones never belong in a repository — which
 * is the same rule this file exists to enforce.
 */

import { validateAnonKey, validateUrl } from '@/state/supabase';

let failures = 0;

function expect(label, actual, wanted) {
  if (actual === wanted) {
    console.log(`  ok    ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${label}\n        expected ${wanted}, got ${actual}`);
}

/** A structurally valid JWT carrying the given role claim. */
function jwt(role) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({ iss: 'supabase', ref: 'exampleproject', role, iat: 1, exp: 2 }),
    'c2lnbmF0dXJlc2lnbmF0dXJlc2ln',
  ].join('.');
}

console.log('\n  SUPABASE CONFIG\n  ' + '-'.repeat(62));

console.log('\n  KEYS THE APP MAY HOLD');
expect('publishable key', validateAnonKey('sb_publishable_' + 'a'.repeat(30)).ok, true);
expect('legacy anon JWT', validateAnonKey(jwt('anon')).ok, true);

console.log('\n  KEYS THAT BYPASS ROW LEVEL SECURITY');
expect('secret key refused', validateAnonKey('sb_secret_' + 'a'.repeat(30)).ok, false);
expect('service_role JWT refused', validateAnonKey(jwt('service_role')).ok, false);
// Any future sb_ key that is not explicitly publishable is refused rather than
// assumed safe. A new admin format must not become valid by default.
expect('unknown sb_ key refused', validateAnonKey('sb_something_' + 'a'.repeat(30)).ok, false);

console.log('\n  MALFORMED');
expect('empty refused', validateAnonKey('   ').ok, false);
expect('truncated publishable refused', validateAnonKey('sb_publishable_abc').ok, false);
expect('key with a space refused', validateAnonKey('sb_publishable_aaa bbb ccc ddd eee').ok, false);
expect('not a key at all refused', validateAnonKey('hunter2').ok, false);

console.log('\n  PROJECT URL');
expect('https project url', validateUrl('https://abc.supabase.co').ok, true);
expect('trailing slash trimmed', validateUrl('https://abc.supabase.co/').ok, true);
expect('plain http refused', validateUrl('http://abc.supabase.co').ok, false);
expect(
  'postgres connection string refused',
  validateUrl('postgresql://postgres:pw@db.abc.supabase.co:5432/postgres').ok,
  false,
);
expect(
  'pooler connection string refused',
  validateUrl('postgres://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres').ok,
  false,
);
expect('url carrying a password refused', validateUrl('https://user:pw@abc.supabase.co').ok, false);
expect('nonsense refused', validateUrl('not a url').ok, false);

/*
  A stored config predating these checks must not be honoured either. Validation
  was added to `saveConfig` after the screen shipped, so a phone can still be
  holding an http URL or a connection string from before — `getClient` re-checks
  on the way out for exactly that reason.
*/
console.log('\n  ORIGIN ONLY');
const nested = validateUrl('https://abc.supabase.co/rest/v1/parties?select=*');
expect('path and query stripped', nested.ok && nested.url === 'https://abc.supabase.co', true);

console.log('\n  ' + '-'.repeat(62));
if (failures === 0) {
  console.log('  Only keys that respect row-level security are accepted.\n');
} else {
  console.log(`  ${failures} problem${failures === 1 ? '' : 's'}.\n`);
  process.exit(1);
}
