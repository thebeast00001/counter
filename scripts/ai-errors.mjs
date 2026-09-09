/**
 * Error classification, against the responses the service really sends.
 *
 * This exists because the first version of `provider.ts` guessed the cause from
 * the status code and threw the body away — so an account that simply had free
 * endpoints switched off was reported as "That API key was refused", which sends
 * the owner to make a second key that fails identically. Status codes are
 * overloaded; the body is where the reason is.
 *
 * `fetch` is stubbed, so this runs with no key and no network.
 *
 *   node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/ai-errors.mjs
 */

const CASES = [
  {
    name: 'free endpoints disabled',
    status: 404,
    body: {
      error: {
        message:
          'No endpoints found matching your data policy. Enable prompt training in your privacy settings.',
      },
    },
    expect: { kind: 'policy', contains: 'data policy' },
  },
  {
    name: 'no allowed providers (403)',
    status: 403,
    body: { error: { message: 'No allowed providers are available for the selected model.' } },
    expect: { kind: 'policy', contains: 'No allowed providers' },
  },
  {
    name: 'genuinely bad key',
    status: 401,
    body: { error: { message: 'User not found.' } },
    expect: { kind: 'refused', contains: 'User not found' },
  },
  {
    name: 'plain 403 that is not a policy problem',
    status: 403,
    body: { error: { message: 'Account suspended.' } },
    expect: { kind: 'refused', contains: 'Account suspended' },
  },
  {
    name: 'rate limited',
    status: 429,
    body: { error: { message: 'Rate limit exceeded: free-models-per-day' } },
    expect: { kind: 'rate-limited', contains: 'Rate limit' },
  },
  {
    name: 'server error with non-JSON body',
    status: 502,
    body: '<html>bad gateway</html>',
    expect: { kind: 'bad-response', contains: 'bad gateway' },
  },
  {
    name: 'error shaped as a bare string',
    status: 400,
    body: { error: 'model is required' },
    expect: { kind: 'bad-response', contains: 'model is required' },
  },
];

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL ${msg}`);
};

// Stub before importing: the module reads `fetch` at call time, so this is
// enough, and it keeps the real transport code under test rather than a copy.
let current = null;
globalThis.fetch = async () => {
  const isString = typeof current.body === 'string';
  return {
    ok: false,
    status: current.status,
    text: async () => (isString ? current.body : JSON.stringify(current.body)),
    json: async () => (isString ? {} : current.body),
  };
};

// The key lives in SecureStore, which does not exist here. Stub the module the
// same way the app does when the native module is missing.
const { setKey } = await import('@/ai/keys');
await setKey('sk-or-v1-0000000000000000000000000000000000000000');

const { complete, AiError } = await import('@/ai/provider');

console.log('ERROR CLASSIFICATION\n');

for (const testCase of CASES) {
  current = testCase;
  let got = null;
  try {
    await complete([{ role: 'user', content: 'hi' }], { models: ['stub/model'] });
    fail(`${testCase.name}: expected a throw, got a result`);
    continue;
  } catch (err) {
    got = err;
  }

  if (!(got instanceof AiError)) {
    fail(`${testCase.name}: threw ${got?.constructor?.name}, not AiError`);
    continue;
  }
  if (got.kind !== testCase.expect.kind) {
    fail(`${testCase.name}: kind was "${got.kind}", expected "${testCase.expect.kind}"`);
    continue;
  }
  if (!got.message.includes(testCase.expect.contains)) {
    fail(`${testCase.name}: message lost the reason — "${got.message}"`);
    continue;
  }
  console.log(`  ok   ${testCase.name.padEnd(34)} ${got.kind.padEnd(13)} ${got.message.slice(0, 52)}`);
}

console.log(failures === 0 ? '\nAll checks pass.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
