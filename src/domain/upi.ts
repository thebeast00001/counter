import type { ExpenseCategory, MoneyDirection, MoneyEntry, Party } from '@/domain/model';

/**
 * UPI: collecting through it, and reading what already went through it.
 *
 * ## What this cannot do, and why it is built this way
 *
 * There is no way for an app like this to "link a UPI account" and watch
 * transactions arrive. NPCI exposes UPI only to licensed payment service
 * providers; reading a bank account with consent means being an RBI-registered
 * Financial Information User on the Account Aggregator network; reading the
 * bank's SMS needs `READ_SMS`, which Play Store policy allows only to an app
 * that is the phone's default SMS handler; and reading UPI notifications needs a
 * native notification listener. None of those are open to this app.
 *
 * Every Indian expense app that appeared to do it was either reading SMS before
 * 2019, or is a licensed entity. Pretending otherwise would mean shipping a
 * feature that silently records nothing.
 *
 * So there are two real paths, and between them they cover both directions:
 *
 *  1. **Collections the app starts.** `buildUpiIntent` hands the customer's UPI
 *     app a payment with the amount and a reference this app generated. Because
 *     the app started it, it already knows who it is for and what it is for —
 *     there is nothing left to type, only a confirmation that it went through.
 *  2. **Everything else, parsed.** `parseTransactions` reads a paste of bank or
 *     UPI messages — a statement export, a forwarded batch of SMS — and pulls
 *     out every transaction it can, with the counterparty, the reference and a
 *     suggested category. Money going out arrives this way.
 *
 * ## The rule that governs the parser
 *
 * It suggests; it never asserts. Every figure the app shows is computed from
 * records the owner stands behind, so a parsed row is a *proposal* with the line
 * it came from attached, and nothing reaches the ledger without a tap. A parser
 * that quietly booked a misread balance as revenue would corrupt every derived
 * number on every screen, and the owner would have no way to tell.
 */

/* ------------------------------------------------------------------ paying -- */

export type UpiRequest = {
  /** The payee's UPI id, e.g. `business@okaxis`. */
  vpa: string;
  /** Shown in the payer's app, so it should be the business's name. */
  payeeName: string;
  amount: number;
  /** What the payment is for, shown to the payer. */
  note: string;
  /** This app's own reference, echoed back by the bank message later. */
  ref: string;
};

/** A UPI id: `something@handle`. Deliberately strict — it becomes a URL. */
export function isVpa(value: string): boolean {
  return /^[\w.\-]{2,256}@[a-zA-Z][\w.\-]{1,63}$/.test(value.trim());
}

/**
 * A reference this app generates and can recognise later.
 *
 * Prefixed so that when the bank message comes back through the parser, a
 * transaction the app itself started is identifiable rather than looking like
 * any other credit. Digits and uppercase only: several PSP apps silently drop a
 * `tr` containing anything else, and the payment then arrives unmatchable.
 */
export function makeRef(seed: number): string {
  return `CTR${seed.toString(36).toUpperCase().slice(-9)}`;
}

/**
 * The `upi://pay` intent, which every UPI app on the phone answers.
 *
 * Each value is percent-encoded. A customer name with an `&` in it would
 * otherwise end the parameter and append one of its own — the same class of
 * injection the `tel:` and `sms:` helpers were fixed for.
 *
 * The amount is fixed to two decimals because some PSP apps reject `100` while
 * accepting `100.00`, and the failure is a blank screen rather than an error.
 */
export function buildUpiIntent(request: UpiRequest): string {
  const params: Record<string, string> = {
    pa: request.vpa,
    pn: request.payeeName,
    am: request.amount.toFixed(2),
    cu: 'INR',
    tn: request.note,
    tr: request.ref,
  };

  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

  return `upi://pay?${query}`;
}

/* ----------------------------------------------------------------- parsing -- */

export type ParsedTransaction = {
  /** The bank's reference, and the key everything is deduped on. */
  ref: string | null;
  amount: number;
  direction: MoneyDirection;
  /** Null when the message carried no date — the importer then uses today. */
  at: number | null;
  /** A name, where the message gave one. */
  counterparty: string | null;
  vpa: string | null;
  /** Only ever a suggestion, and only for money going out. */
  suggestedCategory: ExpenseCategory | null;
  /**
   * 0..1. Below `CONFIDENT` the row is shown unticked, because a half-read
   * message is exactly the one that should need a human to look at it.
   */
  confidence: number;
  /** The text it came from, so the owner can check the app read it correctly. */
  raw: string;
};

/** Rows at or above this are pre-selected for import. */
export const CONFIDENT = 0.7;

/**
 * Words that mean money left, and words that mean money arrived.
 *
 * Ordered longest-first within each list so `debited from` is tested before
 * `debit`, which matters for the ones that appear inside other words.
 */
const OUT_WORDS = /\b(debited|debit|spent|paid|withdrawn|sent to|transferred to|purchase)\b/i;
const IN_WORDS = /\b(credited|credit|received|deposited|refund of)\b/i;

/**
 * Everything after one of these is a balance, not a transaction.
 *
 * This is the single most important line in the parser. Almost every Indian bank
 * message ends with the running balance, and it is usually the largest number in
 * the text — so a parser that takes the first or biggest amount books somebody's
 * entire account balance as a payment. Truncating before the balance removes the
 * whole class.
 */
const BALANCE_TAIL = /\b(avl\s*bal|available\s*bal|avbl\s*bal|bal(?:ance)?\s*[:.]?\s*(?:is\s*)?(?:rs|inr|₹))/i;

/** `Rs.1,234.56`, `INR 1234`, `₹ 1,234.50`. */
const AMOUNT = /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;

/** `priya@okhdfcbank`, `9876543210@ybl`. */
const VPA = /\b([\w.\-]{2,64}@[a-zA-Z][\w.\-]{1,32})\b/;

/**
 * The bank's own reference. Between ten and sixteen digits in practice — a UPI
 * UTR is twelve — and always introduced by one of these words, because a bare
 * run of digits in a bank message is just as likely to be an account number.
 */
const REF =
  /\b(?:upi(?:\s*ref(?:erence)?)?(?:\s*no\.?)?|ref(?:erence)?(?:\s*no\.?)?|utr|txn(?:\s*id)?|transaction\s*id)\s*[:.\-#]?\s*([A-Z0-9]{6,22})\b/i;

/** `UPI/512345678901/...`, the slash-delimited form ICICI and Axis use. */
const REF_SLASHED = /\bUPI\s*\/\s*(?:CR|DR)?\s*\/?\s*([0-9]{9,18})\b/i;

/** This app's own reference, echoed back by the bank. */
const OWN_REF = /\b(CTR[A-Z0-9]{4,12})\b/;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * `03-09-26`, `03/09/2026`, `03-Sep-26`, `3 Sep 2026`.
 *
 * Day first, always. Indian bank messages are `dd-mm-yy`, and reading `03-09-26`
 * as the 9th of March would put a transaction six months out of place — far
 * enough to land in a different month's takings and quietly change every figure
 * derived from it.
 */
const DATE_NUMERIC = /\b([0-3]?\d)[-/.]([01]?\d)[-/.](\d{2}|\d{4})\b/;
const DATE_NAMED = /\b([0-3]?\d)[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]?\s?(\d{2}|\d{4})\b/;

function parseDate(text: string, now: number): number | null {
  const named = text.match(DATE_NAMED);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (month !== undefined) {
      return buildDate(Number(named[1]), month, Number(named[3]), now);
    }
  }

  const numeric = text.match(DATE_NUMERIC);
  if (numeric) {
    return buildDate(Number(numeric[1]), Number(numeric[2]) - 1, Number(numeric[3]), now);
  }

  return null;
}

function buildDate(day: number, month: number, year: number, now: number): number | null {
  if (day < 1 || day > 31 || month < 0 || month > 11) return null;
  const full = year < 100 ? 2000 + year : year;
  const at = new Date(full, month, day, 12, 0, 0, 0).getTime();
  if (Number.isNaN(at)) return null;

  /*
    A date the parser reads as being in the future is a misread, not a
    prediction — most often a `dd-mm` pair that was really `mm-dd`. Rejecting it
    means the importer falls back to today, which is wrong by hours rather than
    by months. One day of slack absorbs a phone whose clock is behind.
  */
  if (at > now + 24 * 60 * 60 * 1000) return null;
  return at;
}

/**
 * Where an expense probably belongs, from the words in the message.
 *
 * A suggestion and nothing more: it fills the field the owner would otherwise
 * pick from a list, and it is always visible and always changeable before
 * anything is written. Ordered so the specific wins over the general — `salary`
 * is checked before the electricity words, because "salary of electrician"
 * should be wages.
 */
const CATEGORY_HINTS: [RegExp, ExpenseCategory][] = [
  [/\b(rent|landlord|lease|shop\s*rent)\b/i, 'rent'],
  [/\b(salary|wages|payroll|stipend|staff\s*pay)\b/i, 'wages'],
  [/\b(electric|electricity|power|bses|tneb|mseb|water|gas|broadband|internet|airtel|jio|vodafone|vi\s|bsnl|recharge|bill\s*pay)\b/i, 'utilities'],
  [/\b(gst|income\s*tax|tds|challan|tax)\b/i, 'tax'],
  [/\b(ads?|advert|marketing|promotion|google\s*ads|meta|facebook|instagram)\b/i, 'marketing'],
  [/\b(equipment|machine|repair|service|amc|furniture|hardware)\b/i, 'equipment'],
  [/\b(stock|supplies|wholesale|traders|distributor|mart|kirana|grocery|bigbasket|zepto|blinkit|supplier)\b/i, 'stock'],
];

function suggestCategory(text: string): ExpenseCategory | null {
  for (const [pattern, category] of CATEGORY_HINTS) {
    if (pattern.test(text)) return category;
  }
  return null;
}

/**
 * A counterparty's name, where the message names one rather than only giving a
 * UPI id.
 *
 * Deliberately conservative. A wrong name attached to a payment is worse than no
 * name, because it will be matched to the wrong customer and quietly move money
 * onto somebody else's record — so anything that does not look like a person or
 * a business name is dropped rather than guessed at.
 */
function parseCounterparty(text: string): string | null {
  const patterns = [
    /\b(?:to|from|by)\s+(?:vpa\s+)?[\w.\-]{2,64}@[a-zA-Z][\w.\-]{1,32}\s*\(([^)]{2,40})\)/i,
    // Lazy, with an explicit terminator. Greedy, this swallowed the trailing
    // " on 03-09-26" and produced a payer called "RAVI KUMAR on" — a name that
    // matches no customer and would have been written into the ledger as one.
    /\bUPI\s*\/\s*(?:CR|DR)\s*\/\s*[0-9]{6,18}\s*\/\s*([A-Za-z][A-Za-z .'&-]{2,40}?)(?=\s+on\b|\s*[.,]|\s*$)/i,
    /\b(?:credited\s+by|received\s+from|debited.{0,20}?\bto|paid\s+to|sent\s+to|trf\s+to)\s+(?:vpa\s+)?([A-Za-z][A-Za-z .'&-]{2,40}?)(?=\s+(?:on|for|ref|upi|a\/c|avl|bal|\.|,|$))/i,
    /\bat\s+([A-Za-z][A-Za-z .'&-]{2,40}?)(?=\s+(?:on|ref|avl|bal|\.|,|$))/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const name = match?.[1]?.trim().replace(/\s+/g, ' ');
    // Bare noise words survive some of these patterns; a real name has a letter
    // pair and is not one of the words that mean "an account".
    if (name && name.length >= 3 && !/^(a\/c|acct|account|your|the|upi|vpa|bank)$/i.test(name)) {
      return name;
    }
  }
  return null;
}

/**
 * Splits a paste into one chunk per message.
 *
 * Blank lines are the reliable separator — every messaging app puts one between
 * forwarded messages — but a statement export gives one transaction per line
 * with no blank lines at all. So a block carrying more than one direction word
 * is split again on single newlines.
 */
function blocks(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const paragraph of paragraphs) {
    const hits = (paragraph.match(new RegExp(`${OUT_WORDS.source}|${IN_WORDS.source}`, 'gi')) ?? [])
      .length;
    if (hits > 1) {
      for (const line of paragraph.split(/\n+/)) {
        const trimmed = line.trim();
        if (trimmed) out.push(trimmed);
      }
    } else {
      out.push(paragraph);
    }
  }
  return out;
}

/**
 * Reads every transaction it can find in a paste.
 *
 * Anything it cannot read is left out rather than guessed at — a row the owner
 * has to correct costs more attention than a row they have to add.
 */
export function parseTransactions(text: string, now = Date.now()): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];

  for (const block of blocks(text)) {
    // Everything from the balance onwards is dropped before a single number is
    // read out of this block. See the note on BALANCE_TAIL.
    const balanceAt = block.search(BALANCE_TAIL);
    const body = balanceAt >= 0 ? block.slice(0, balanceAt) : block;

    const outward = OUT_WORDS.test(body);
    const inward = IN_WORDS.test(body);
    if (!outward && !inward) continue;

    AMOUNT.lastIndex = 0;
    const amounts = [...body.matchAll(AMOUNT)]
      .map((match) => Number(match[1].replace(/,/g, '')))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (amounts.length === 0) continue;

    // The first amount in the surviving text. Bank messages lead with the
    // transaction and trail with everything else, and the balance is already
    // gone by this point.
    const amount = amounts[0];

    /*
      When a message somehow carries both words, the debit wins. Getting the
      direction wrong turns an expense into revenue, which inflates every
      takings figure on every screen; the reverse merely understates them. Of the
      two mistakes, only one flatters the business, so the parser leans away
      from it.
    */
    const direction: MoneyDirection = outward ? 'out' : 'in';

    const own = body.match(OWN_REF)?.[1] ?? null;
    const ref = own ?? body.match(REF)?.[1] ?? body.match(REF_SLASHED)?.[1] ?? null;
    const vpa = body.match(VPA)?.[1] ?? null;
    const at = parseDate(body, now);
    const counterparty = parseCounterparty(body);

    /*
      Confidence is what decides whether a row arrives ticked. A transaction with
      an amount, a direction, a reference and a date has been read completely;
      each missing piece is a reason for a person to look at it before it becomes
      a permanent record.
    */
    let confidence = 0.4;
    if (ref) confidence += 0.25;
    if (at !== null) confidence += 0.2;
    if (vpa || counterparty) confidence += 0.15;
    // Two amounts left after the balance was stripped means something else in
    // the message looked like money, and one of them is wrong.
    if (amounts.length > 1) confidence -= 0.2;
    if (own) confidence = 1;

    out.push({
      ref,
      amount,
      direction,
      at,
      counterparty,
      vpa,
      suggestedCategory: direction === 'out' ? suggestCategory(body) : null,
      confidence: Math.max(0, Math.min(1, confidence)),
      raw: block.trim(),
    });
  }

  return out;
}

/* ---------------------------------------------------------------- matching -- */

/**
 * The person a transaction belongs to, if it can be told with certainty.
 *
 * Three ways, in descending order of how much they can be trusted, and the bar
 * is deliberately high. Attaching a payment to the wrong customer corrupts their
 * balance, their reliability score and every finding built on either — so a
 * near-match returns null and the row arrives unattached, which the owner can
 * fix in one tap and which breaks nothing in the meantime.
 */
export function matchParty(
  transaction: ParsedTransaction,
  parties: Party[],
): Party | null {
  // 1. The UPI id, when it is already on file. Exact, so it cannot be wrong.
  if (transaction.vpa) {
    const byVpa = parties.find(
      (p) => p.vpa && p.vpa.toLowerCase() === transaction.vpa!.toLowerCase(),
    );
    if (byVpa) return byVpa;
  }

  // 2. The phone number inside a numeric UPI id — `9876543210@ybl` is the
  //    commonest handle in India, and the digits are the person.
  if (transaction.vpa) {
    const digits = transaction.vpa.split('@')[0].replace(/\D/g, '');
    if (digits.length >= 10) {
      const tail = digits.slice(-10);
      const byPhone = parties.filter((p) => p.phone?.replace(/\D/g, '').endsWith(tail));
      if (byPhone.length === 1) return byPhone[0];
    }
  }

  // 3. The name, but only when exactly one person answers to it. Two customers
  //    called Priya make this ambiguous, and an ambiguous match is a wrong one
  //    half the time.
  if (transaction.counterparty) {
    const wanted = transaction.counterparty.toLowerCase().replace(/[^a-z ]/g, '').trim();
    if (wanted.length >= 4) {
      const byName = parties.filter(
        (p) => p.name.toLowerCase().replace(/[^a-z ]/g, '').trim() === wanted,
      );
      if (byName.length === 1) return byName[0];
    }
  }

  return null;
}

/* ------------------------------------------------------------------ import -- */

/**
 * Drops anything already recorded.
 *
 * Re-pasting the same statement has to be safe, because it is what an owner will
 * do the moment they are unsure whether the first import worked. Deduping on the
 * bank's reference is exact where a reference exists; where one does not, the
 * amount, direction and day together are close enough that a genuine second
 * identical payment on the same day is rarer than a double import.
 */
export function newTransactions(
  parsed: ParsedTransaction[],
  existing: MoneyEntry[],
  now = Date.now(),
): ParsedTransaction[] {
  const refs = new Set(
    existing.map((entry) => entry.ref?.toLowerCase()).filter((ref): ref is string => Boolean(ref)),
  );
  const rough = new Set(
    existing.map((entry) => `${entry.direction}|${entry.amount}|${dayKey(entry.at)}`),
  );

  const seen = new Set<string>();
  const out: ParsedTransaction[] = [];

  for (const transaction of parsed) {
    const ref = transaction.ref?.toLowerCase();
    if (ref && refs.has(ref)) continue;

    const key = ref
      ? `ref|${ref}`
      : `${transaction.direction}|${transaction.amount}|${dayKey(transaction.at ?? now)}`;

    // Guards against duplicates inside the paste itself as well as against the
    // ledger — a forwarded thread often contains the same message twice.
    if (seen.has(key)) continue;
    if (!ref && rough.has(key.replace(/^ref\|/, ''))) continue;

    seen.add(key);
    out.push(transaction);
  }

  return out;
}

function dayKey(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * A parsed row as a ledger entry.
 *
 * `source: 'import'` is what keeps the "recorded without typing" figure honest —
 * it is the measure of whether this app is doing its job, and an imported
 * payment counts precisely because nobody typed it.
 */
export function toMoneyEntry(
  transaction: ParsedTransaction,
  options: { partyId?: string | null; category?: ExpenseCategory | null; now?: number },
): Omit<MoneyEntry, 'id'> {
  const at = transaction.at ?? options.now ?? Date.now();
  return {
    partyId: options.partyId ?? null,
    amount: transaction.amount,
    direction: transaction.direction,
    at,
    status: 'settled',
    settledAt: at,
    label: transaction.counterparty ?? transaction.vpa ?? 'UPI',
    method: 'upi',
    category:
      transaction.direction === 'out'
        ? (options.category ?? transaction.suggestedCategory ?? 'other')
        : undefined,
    ref: transaction.ref,
    source: 'import',
  };
}
