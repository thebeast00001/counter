/**
 * Reading an amount the way an Indian owner actually types one.
 *
 * The money field used to accept any text at all and quietly keep whatever
 * digits it found. That is mostly harmless — `60,000/-` and `₹60,000` both
 * reduce to 60000 — but it hides two failures that are not:
 *
 *   - **`60k` became 60.** A thousandfold under-reading, recorded silently, with
 *     the owner's own shorthand as the cause. Nothing on any screen would ever
 *     indicate which figure was wrong.
 *   - **Free text was accepted and ignored.** Typing a note into the amount box
 *     left it looking filled, the save button enabled, and no payment recorded.
 *
 * So shorthand is understood rather than truncated, and anything that cannot be
 * read is refused at the keystroke instead of being dropped at save time.
 */

export type ParsedAmount =
  | { ok: true; value: number }
  | { ok: false; reason: 'empty' | 'unreadable' };

/**
 * `k`, `L`/`lakh` and `cr`/`crore`, because those are what people write.
 *
 * Ordered longest-first so `crore` is tested before `cr`, and `lakh` before the
 * bare `l` — otherwise `1 lakh` reads as 1 × 50 and produces fifty rupees.
 */
const SUFFIXES: [RegExp, number][] = [
  [/(crore|cr)$/i, 10_000_000],
  [/(lakhs?|lacs?|lak|l)$/i, 100_000],
  [/(k|thousand)$/i, 1_000],
];

/** Every shorthand word, so a partly-typed one can be allowed through. */
const SUFFIX_WORDS = ['k', 'thousand', 'l', 'lakh', 'lakhs', 'lac', 'lacs', 'cr', 'crore'];

/**
 * What the field is allowed to contain as somebody types.
 *
 * Digits, at most one decimal point, and a trailing shorthand word — nothing
 * else reaches the input, so it can never display a value that will later be
 * discarded. That is the whole point: the old field accepted a sentence, looked
 * filled, enabled the save button, and recorded no payment.
 *
 * The trailing letters are checked against the shorthand words rather than
 * against an alphabet. Allowing every letter that appears in "crore" and
 * "thousand" would let most of the alphabet through — `Sharma wedding` survives
 * such a filter almost intact, which is the bug rather than the fix.
 *
 * A partly-typed word is allowed (`1 lak` on the way to `1 lakh`), because
 * refusing keystrokes mid-word makes a field feel broken.
 */
export function sanitiseAmountInput(text: string): string {
  const stripped = text.replace(/[₹,\s]/g, '');

  const digits = stripped.match(/^[0-9]*\.?[0-9]*/)?.[0] ?? '';
  const tail = stripped.slice(digits.length).toLowerCase();
  if (tail.length === 0) return digits;

  // Only a prefix of a real shorthand word, and only after a number.
  const valid = digits.length > 0 && SUFFIX_WORDS.some((word) => word.startsWith(tail));
  return valid ? digits + tail : digits;
}

/** The rupee value of what was typed, or why it cannot be read. */
export function parseAmount(text: string): ParsedAmount {
  const cleaned = text
    .replace(/\/-\s*$/, '')
    .replace(/[₹,\s]/g, '')
    .trim();
  if (cleaned.length === 0) return { ok: false, reason: 'empty' };

  for (const [pattern, multiplier] of SUFFIXES) {
    if (pattern.test(cleaned)) {
      const digits = cleaned.replace(pattern, '');
      const base = Number(digits);
      if (digits.length === 0 || !Number.isFinite(base) || base <= 0) {
        return { ok: false, reason: 'unreadable' };
      }
      return { ok: true, value: Math.round(base * multiplier) };
    }
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, reason: 'unreadable' };
  // Sub-rupee precision is not a thing anybody records here, and a stray third
  // decimal is far more likely to be a typo than an intention.
  return { ok: true, value: Math.round(value * 100) / 100 };
}

/**
 * What to show under the field while typing.
 *
 * Only ever *confirms* an interpretation — it never corrects one. Silently
 * turning `60k` into `₹60,000` without saying so would be the same class of
 * error as the bug this replaced, just in the other direction.
 */
export function amountHint(text: string, format: (n: number) => string): string | null {
  const parsed = parseAmount(text);
  if (!parsed.ok) return parsed.reason === 'empty' ? null : 'That is not an amount.';

  // Plain digits need no echo — the figure is already on screen.
  if (/^[0-9.]+$/.test(text.replace(/[₹,\s]/g, ''))) return null;
  return format(parsed.value);
}
