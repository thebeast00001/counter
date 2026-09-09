/**
 * Asserts the UPI parser reads real bank messages correctly, and — more
 * importantly — that it refuses to read the ones it cannot.
 *
 *   node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/upi-check.mjs
 *
 * Every row this parser emits can become a permanent financial record, and every
 * figure on every screen is derived from those records. A parser that misreads a
 * balance as a payment does not produce one wrong row; it produces a wrong month,
 * a wrong forecast, a wrong break-even line and a wrong finding, with nothing
 * anywhere indicating which number is the lie.
 *
 * So the negative cases below matter more than the positive ones. The balance
 * trap in particular is the reason `BALANCE_TAIL` exists: almost every Indian
 * bank SMS ends with the running balance, it is usually the largest number in
 * the message, and a naive parser books it as the transaction.
 */

import {
  CONFIDENT,
  buildUpiIntent,
  isVpa,
  makeRef,
  matchParty,
  newTransactions,
  parseTransactions,
  toMoneyEntry,
} from '@/domain/upi';

const NOW = Date.parse('2026-09-03T18:00:00+05:30');
let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        got      ${JSON.stringify(actual)}`);
  }
  return ok;
}

console.log('\n  UPI PARSER\n  ' + '-'.repeat(66));

/* ------------------------------------------------------------ real messages */

const CASES = [
  {
    label: 'SBI debit with VPA and ref',
    text: 'Dear Customer, Rs.500.00 debited from A/c XX1234 on 03-09-26 to VPA merchant@ybl (UPI Ref no 512345678901). -SBI',
    want: { amount: 500, direction: 'out', vpa: 'merchant@ybl', ref: '512345678901', day: '2026-09-03' },
  },
  {
    label: 'HDFC credit from a person',
    text: 'Dear Customer, Rs.1500.00 credited to your A/c XX1234 on 03-Sep-26 by VPA priya@oksbi (UPI Ref no 234567890123).',
    want: { amount: 1500, direction: 'in', vpa: 'priya@oksbi', ref: '234567890123', day: '2026-09-03' },
  },
  {
    label: 'thousands separator is not a decimal point',
    text: 'INR 12,500.00 debited from HDFC Bank A/c XX1234 on 01-09-2026 to VPA supplier@paytm. Ref 345678901234.',
    want: { amount: 12500, direction: 'out', vpa: 'supplier@paytm', ref: '345678901234', day: '2026-09-01' },
  },
  {
    label: 'ICICI slash-delimited reference',
    text: 'Dear Customer, Acct XX123 is debited with INR 450.00 on 02-Sep-26. Info: UPI/456789012345/Payment to/electricity board.',
    want: { amount: 450, direction: 'out', ref: '456789012345', day: '2026-09-02' },
  },
  {
    label: 'named payer in the slashed form',
    text: 'Rs 800 Credited to A/c XX1234 thru UPI/CR/567890123456/RAVI KUMAR on 03-09-26',
    want: { amount: 800, direction: 'in', ref: '567890123456', counterparty: 'RAVI KUMAR', day: '2026-09-03' },
  },
  {
    label: 'phone-number handle',
    text: 'Rs.250.00 credited to your A/c XX1234 on 03-09-26 by VPA 9876543210@ybl (UPI Ref no 678901234567).',
    want: { amount: 250, direction: 'in', vpa: '9876543210@ybl', ref: '678901234567', day: '2026-09-03' },
  },
];

for (const testCase of CASES) {
  const [got] = parseTransactions(testCase.text, NOW);
  if (!got) {
    failures += 1;
    console.log(`  FAIL  ${testCase.label}\n        parsed nothing`);
    continue;
  }

  const fields = { amount: got.amount, direction: got.direction };
  const want = { amount: testCase.want.amount, direction: testCase.want.direction };
  if (testCase.want.vpa !== undefined) { fields.vpa = got.vpa; want.vpa = testCase.want.vpa; }
  if (testCase.want.ref !== undefined) { fields.ref = got.ref; want.ref = testCase.want.ref; }
  if (testCase.want.counterparty !== undefined) {
    fields.counterparty = got.counterparty;
    want.counterparty = testCase.want.counterparty;
  }
  if (testCase.want.day !== undefined) {
    fields.day = got.at === null ? null : new Date(got.at).toISOString().slice(0, 10);
    want.day = testCase.want.day;
  }

  if (check(testCase.label, fields, want)) {
    console.log(`  ok    ${testCase.label.padEnd(44)} ${got.direction} ₹${got.amount}`);
  }
}

/* ----------------------------------------------------------- the balance trap */

console.log('\n  BALANCE TRAP');
{
  const text =
    'Dear Customer, Rs.500.00 debited from A/c XX1234 on 03-09-26 to VPA shop@ybl (UPI Ref no 789012345678). Avl Bal Rs.87,450.00';
  const [got] = parseTransactions(text, NOW);
  if (check('the payment, not the balance', got?.amount, 500)) {
    console.log('  ok    read ₹500 and ignored the ₹87,450 balance');
  }
}
{
  const text = 'Your A/c XX1234 is credited by Rs.2,000.00 on 03-09-26 from VPA ravi@ybl. Balance: Rs 1,20,000.00';
  const [got] = parseTransactions(text, NOW);
  if (check('balance after a credit', got?.amount, 2000)) {
    console.log('  ok    read ₹2,000 and ignored the ₹1,20,000 balance');
  }
}

/* ------------------------------------------------------------ refusals */

console.log('\n  REFUSALS');
const REFUSE = [
  ['an OTP', 'Your OTP for login is 456789. Do not share it with anyone. -HDFC Bank'],
  ['a balance enquiry', 'Dear Customer, the available balance in your A/c XX1234 is Rs.87,450.00 as on 03-09-26.'],
  ['a promotion', 'Get a personal loan of Rs.5,00,000 at 10.5%. Click here to apply. -Bank'],
  ['a request, not a payment', 'merchant@ybl has requested Rs.500.00. Approve in your UPI app.'],
  ['empty text', '   \n  \n '],
];
for (const [label, text] of REFUSE) {
  const got = parseTransactions(text, NOW);
  if (check(`refuses ${label}`, got.length, 0)) console.log(`  ok    refuses ${label}`);
}

/* ------------------------------------------------------- multiple in one paste */

console.log('\n  BATCH');
{
  const paste = `Dear Customer, Rs.500.00 debited from A/c XX1234 on 01-09-26 to VPA a@ybl (UPI Ref no 111111111111). Avl Bal Rs.9,000.00

Dear Customer, Rs.1,200.00 credited to your A/c XX1234 on 02-09-26 by VPA b@oksbi (UPI Ref no 222222222222).

Dear Customer, Rs.75.00 debited from A/c XX1234 on 03-09-26 to VPA c@paytm (UPI Ref no 333333333333).`;
  const got = parseTransactions(paste, NOW);
  check('three messages', got.length, 3);
  check('directions', got.map((t) => t.direction), ['out', 'in', 'out']);
  check('amounts', got.map((t) => t.amount), [500, 1200, 75]);
  if (failures === 0) console.log('  ok    three messages, right order, right directions');
}

/* -------------------------------------------------------------------- dedupe */

console.log('\n  DEDUPE');
{
  const paste = 'Rs.500.00 debited from A/c XX1234 on 03-09-26 to VPA a@ybl (UPI Ref no 444444444444).';
  const parsed = parseTransactions(paste, NOW);
  const ledger = [
    { id: 'm1', amount: 500, direction: 'out', at: NOW, status: 'settled', label: 'x', ref: '444444444444' },
  ];
  check('already imported is skipped', newTransactions(parsed, ledger, NOW).length, 0);
  check('unseen is kept', newTransactions(parsed, [], NOW).length, 1);

  // The same message twice in one paste, which forwarded threads produce.
  const twice = parseTransactions(`${paste}\n\n${paste}`, NOW);
  check('duplicate inside the paste', newTransactions(twice, [], NOW).length, 1);
  if (failures === 0) console.log('  ok    re-importing the same statement adds nothing');
}

/* ------------------------------------------------------------------ matching */

console.log('\n  MATCHING');
{
  const parties = [
    { id: 'p1', name: 'Priya Sharma', joinedAt: NOW, vpa: 'priya@oksbi' },
    { id: 'p2', name: 'Ravi Kumar', joinedAt: NOW, phone: '+91 98765 43210' },
    { id: 'p3', name: 'Priya Nair', joinedAt: NOW },
    { id: 'p4', name: 'Priya Nair', joinedAt: NOW },
  ];

  const byVpa = parseTransactions(
    'Rs.100 credited to A/c XX1 on 03-09-26 by VPA priya@oksbi (UPI Ref no 555555555555).', NOW)[0];
  check('matches a stored UPI id', matchParty(byVpa, parties)?.id, 'p1');

  const byPhone = parseTransactions(
    'Rs.100 credited to A/c XX1 on 03-09-26 by VPA 9876543210@ybl (UPI Ref no 666666666666).', NOW)[0];
  check('matches a phone-number handle', matchParty(byPhone, parties)?.id, 'p2');

  const ambiguous = parseTransactions(
    'Rs 100 Credited to A/c XX1 thru UPI/CR/777777777777/Priya Nair on 03-09-26', NOW)[0];
  check('refuses an ambiguous name', matchParty(ambiguous, parties), null);

  const unknown = parseTransactions(
    'Rs.100 credited to A/c XX1 on 03-09-26 by VPA nobody@ybl (UPI Ref no 888888888888).', NOW)[0];
  check('leaves an unknown payer unattached', matchParty(unknown, parties), null);
  if (failures === 0) console.log('  ok    exact matches only; ambiguity stays unattached');
}

/* ---------------------------------------------------------------- categories */

console.log('\n  CATEGORY SUGGESTIONS');
{
  const cases = [
    ['shop rent for September', 'rent'],
    ['salary to staff', 'wages'],
    ['electricity bill payment', 'utilities'],
    ['GST challan', 'tax'],
    ['wholesale traders supply', 'stock'],
  ];
  for (const [words, expected] of cases) {
    const [got] = parseTransactions(
      `Rs.1000.00 debited from A/c XX1 on 03-09-26 to VPA x@ybl for ${words}. Ref 999999999999.`, NOW);
    check(`suggests ${expected}`, got?.suggestedCategory, expected);
  }

  // A credit must never carry an expense category — the model only allows one on
  // money going out, and a category on revenue would be meaningless.
  const [credit] = parseTransactions(
    'Rs.1000.00 credited to A/c XX1 on 03-09-26 by VPA x@ybl for rent. Ref 101010101010.', NOW);
  check('no category on money coming in', credit?.suggestedCategory, null);
  if (failures === 0) console.log('  ok    suggestions only on money going out');
}

/* -------------------------------------------------------------- confidence */

console.log('\n  CONFIDENCE');
{
  const complete = parseTransactions(
    'Rs.500.00 debited from A/c XX1 on 03-09-26 to VPA a@ybl (UPI Ref no 121212121212).', NOW)[0];
  check('a complete read is pre-selected', complete.confidence >= CONFIDENT, true);

  const bare = parseTransactions('paid Rs.500 to someone', NOW)[0];
  check('a bare read is not pre-selected', bare.confidence < CONFIDENT, true);
  if (failures === 0) console.log('  ok    incomplete reads arrive unticked');
}

/* ------------------------------------------------------------- the intent */

console.log('\n  COLLECTION INTENT');
{
  const ref = makeRef(NOW);
  const url = buildUpiIntent({
    vpa: 'business@okaxis',
    payeeName: 'Sharma & Sons',
    amount: 1500,
    note: 'September fees',
    ref,
  });

  check('scheme', url.startsWith('upi://pay?'), true);
  check('amount is two decimals', url.includes('am=1500.00'), true);
  check('currency', url.includes('cu=INR'), true);
  check('the ampersand in the name is encoded', url.includes('pn=Sharma%20%26%20Sons'), true);
  check('the note is encoded', url.includes('tn=September%20fees'), true);

  // An injected parameter must not survive into the URL as syntax.
  const hostile = buildUpiIntent({
    vpa: 'business@okaxis',
    payeeName: 'X&am=99999',
    amount: 10,
    note: 'note',
    ref: 'CTR1',
  });
  check('cannot inject a second amount', hostile.match(/[?&]am=/g)?.length, 1);
  check('the payment is still ₹10', hostile.includes('am=10.00'), true);

  check('vpa shape, good', isVpa('business@okaxis'), true);
  check('vpa shape, spaces', isVpa('business name@okaxis'), false);
  check('vpa shape, no handle', isVpa('business'), false);

  // The app's own reference must survive a round trip through a bank message.
  const echoed = parseTransactions(
    `Rs.1500.00 credited to your A/c XX1 on 03-09-26 by VPA cust@ybl. Ref ${ref}.`, NOW)[0];
  check('recognises its own reference', echoed.ref, ref);
  check('and trusts it completely', echoed.confidence, 1);
  if (failures === 0) console.log('  ok    intent is encoded, and its reference round-trips');
}

/* ------------------------------------------------------------------- ledger */

console.log('\n  LEDGER ENTRY');
{
  const [transaction] = parseTransactions(
    'Rs.450.00 debited from A/c XX1 on 02-09-26 to VPA power@ybl for electricity bill. Ref 131313131313.', NOW);
  const entry = toMoneyEntry(transaction, { now: NOW });
  check('direction', entry.direction, 'out');
  check('amount', entry.amount, 450);
  check('method', entry.method, 'upi');
  check('settled', entry.status, 'settled');
  check('category carried through', entry.category, 'utilities');
  check('reference kept for dedupe', entry.ref, '131313131313');
  check('counts as untyped', entry.source, 'import');

  const [credit] = parseTransactions(
    'Rs.900.00 credited to A/c XX1 on 02-09-26 by VPA cust@ybl. Ref 141414141414.', NOW);
  check('no category on a credit', toMoneyEntry(credit, { now: NOW }).category, undefined);
  if (failures === 0) console.log('  ok    parsed rows become well-formed ledger entries');
}

console.log('\n  ' + '-'.repeat(66));
if (failures === 0) {
  console.log('  The parser reads what it should and refuses what it should not.\n');
} else {
  console.log(`  ${failures} problem${failures === 1 ? '' : 's'}.\n`);
  process.exit(1);
}
