/**
 * Asserts the money field reads what an owner actually types.
 *
 *   node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/amount-check.mjs
 *
 * Every case below was recorded silently and wrongly by the previous
 * implementation, which kept whatever digits it could find and discarded the
 * rest. `60k` becoming sixty rupees is the one that matters: it is an owner's
 * own shorthand, it under-reads by a thousand, and nothing anywhere would show
 * which figure was the lie.
 */

import { amountHint, parseAmount, sanitiseAmountInput } from '@/domain/amount';

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ok    ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
}

const value = (text) => {
  const r = parseAmount(text);
  return r.ok ? r.value : `refused:${r.reason}`;
};

console.log('\n  AMOUNTS\n  ' + '-'.repeat(56));

console.log('\n  PLAIN');
check('digits', value('60000'), 60000);
check('decimal', value('1500.50'), 1500.5);
check('rupee sign', value('₹2500'), 2500);
check('trailing /-', value('60,000/-'), 60000);
check('indian grouping', value('1,20,000'), 120000);
check('spaces', value(' 750 '), 750);

console.log('\n  SHORTHAND — the thousandfold bug');
check('60k is sixty thousand, not sixty', value('60k'), 60000);
check('1.5k', value('1.5k'), 1500);
check('2L', value('2L'), 200000);
check('1 lakh', value('1 lakh'), 100000);
check('1.2 lakhs', value('1.2 lakhs'), 120000);
check('1 crore', value('1 crore'), 10000000);
check('2cr', value('2cr'), 20000000);

console.log('\n  REFUSED');
check('free text', value('Sharma wedding shoot'), 'refused:unreadable');
check('empty', value(''), 'refused:empty');
check('zero', value('0'), 'refused:unreadable');
check('negative', value('-500'), 'refused:unreadable');
check('two decimal points', value('1.2.3'), 'refused:unreadable');
check('suffix with no number', value('k'), 'refused:unreadable');

console.log('\n  WHAT THE FIELD MAY HOLD');
check('free text cannot be typed at all', sanitiseAmountInput('Sharma wedding'), '');
check('letters before digits are refused', sanitiseAmountInput('abc60'), '');
check('a half-typed lakh is allowed', sanitiseAmountInput('1 lak'), '1lak');
check('a word that is not shorthand is dropped', sanitiseAmountInput('60xyz'), '60');
check('commas stripped as typed', sanitiseAmountInput('1,20,000'), '120000');
// Truncated at the ambiguity rather than merged. `1.23` would be a figure
// nobody typed, which is the same class of error as reading `60k` as sixty.
check('a second decimal point stops the number', sanitiseAmountInput('1.2.3'), '1.2');
check('shorthand survives', sanitiseAmountInput('60k'), '60k');

console.log('\n  THE HINT');
const fmt = (n) => `₹${n.toLocaleString('en-IN')}`;
check('shorthand is echoed back', amountHint('60k', fmt), '₹60,000');
check('plain digits need no echo', amountHint('60000', fmt), null);
check('empty says nothing', amountHint('', fmt), null);
check('garbage is named', amountHint('abc', fmt), 'That is not an amount.');

console.log('\n  ' + '-'.repeat(56));
if (failures === 0) {
  console.log('  Amounts read the way they are written.\n');
} else {
  console.log(`  ${failures} problem${failures === 1 ? '' : 's'}.\n`);
  process.exit(1);
}
