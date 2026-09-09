import type { Vocabulary } from '@/domain/model';

/**
 * The right form of a word for a count.
 *
 * Every label in this app is built from the business's own vocabulary, which
 * stores a singular and a plural — and almost every use joined the count to the
 * *plural*, unconditionally. The first customer read "1 Customers", the first
 * visit "1 visits written down today". On a screen whose whole purpose is to be
 * trusted with somebody's records, that is the first thing a reader sees on
 * their first day, and it reads as carelessness about everything else.
 */
export function plural(count: number, term: { one: string; many: string }): string {
  return count === 1 ? term.one : term.many;
}

/** The same, for a `Vocabulary` key. */
export function say(
  vocabulary: Vocabulary,
  key: keyof Vocabulary,
  count: number,
): string {
  return plural(count, vocabulary[key]);
}

/**
 * Whether money is still owed after the work is done.
 *
 * `split` — an advance plus a balance — counts, because the balance is a
 * receivable exactly like a wholly-deferred payment is. Written once and shared
 * so that adding a fourth timing later cannot silently miss a branch: every
 * consumer used to compare against the literal `'after'`, and `split` would
 * have quietly behaved like "paid at the time" in each of them.
 */
export function billsAfterwards(shape: { paymentTiming: string }): boolean {
  return shape.paymentTiming === 'after' || shape.paymentTiming === 'split';
}
