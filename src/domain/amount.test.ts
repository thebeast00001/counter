import { describe, expect, it } from 'vitest';

import { parseAmount, sanitiseAmountInput } from '@/domain/amount';

/** `parseAmount` returns a result rather than a nullable number, so that an
 *  empty field and an unreadable one can be told apart by the hint below it. */
const value = (text: string): number | null => {
  const parsed = parseAmount(text);
  return parsed.ok ? parsed.value : null;
};

const refusal = (text: string): string | null => {
  const parsed = parseAmount(text);
  return parsed.ok ? null : parsed.reason;
};

/**
 * The field an owner types money into.
 *
 * Every one of these is a way somebody actually writes a number down in India,
 * and the ones that are refused are refused on purpose — a money field that
 * quietly accepts nonsense produces a ledger nobody can audit.
 */
describe('sanitiseAmountInput', () => {
  it('keeps digits and a single decimal point', () => {
    expect(sanitiseAmountInput('1200')).toBe('1200');
    expect(sanitiseAmountInput('1200.50')).toBe('1200.50');
  });

  it('strips the separators people type', () => {
    expect(sanitiseAmountInput('₹1,200')).toBe('1200');
    expect(sanitiseAmountInput('1 200')).toBe('1200');
  });

  it('keeps a scale suffix while it is still being typed', () => {
    // "60k" must survive keystroke by keystroke, or the field fights the finger.
    expect(sanitiseAmountInput('60')).toBe('60');
    expect(sanitiseAmountInput('60k')).toBe('60k');
    expect(sanitiseAmountInput('60l')).toBe('60l');
    expect(sanitiseAmountInput('60la')).toBe('60la');
    expect(sanitiseAmountInput('60lakh')).toBe('60lakh');
    expect(sanitiseAmountInput('2cr')).toBe('2cr');
  });

  it('refuses letters that are not the start of a scale word', () => {
    // This is the whole reason the check is a prefix match rather than a
    // character allowlist: spelling "crore" needs most of the alphabet, so an
    // allowlist let "Sharma wedding" through nearly intact.
    expect(sanitiseAmountInput('60x')).toBe('60');
    expect(sanitiseAmountInput('Sharma wedding')).toBe('');
    expect(sanitiseAmountInput('12 payments')).toBe('12');
  });

  it('will not start with a suffix', () => {
    expect(sanitiseAmountInput('k')).toBe('');
    expect(sanitiseAmountInput('lakh')).toBe('');
  });
});

describe('parseAmount', () => {
  it('reads plain figures', () => {
    expect(value('1200')).toBe(1200);
    expect(value('1,200.50')).toBe(1200.5);
    expect(value('₹ 1200')).toBe(1200);
  });

  it('scales the Indian shorthand', () => {
    // The bug this exists for: "60k" was read as ₹60, a thousandfold error in
    // the direction that makes a business look broke.
    expect(value('60k')).toBe(60_000);
    expect(value('1.5k')).toBe(1500);
    expect(value('2l')).toBe(200_000);
    expect(value('2 lakh')).toBe(200_000);
    expect(value('1cr')).toBe(10_000_000);
  });

  it('strips a trailing rupee dash but not a leading minus', () => {
    // `60,000/-` is how half of India writes it. `-500` is a different claim
    // entirely, and a money field that accepts it silently books a negative.
    expect(value('60,000/-')).toBe(60_000);
    expect(value('-500')).toBeNull();
  });

  it('refuses what it cannot read', () => {
    // The two refusals are distinct so the field can stay silent on an empty
    // box and speak up on a wrong one.
    expect(refusal('')).toBe('empty');
    expect(refusal('abc')).toBe('unreadable');
    expect(refusal('.')).toBe('unreadable');
  });

  it('refuses a second decimal point rather than merging it', () => {
    /*
      Two halves of the same decision, in the two places that make it.

      The field truncates as it is typed, so `1.2.3` can never be committed —
      and `parseAmount` refuses the raw string outright rather than reading it
      as 1.23, because merging the digits invents a figure nobody typed. The
      field is the forgiving one and the parser is the strict one, which is the
      right way round: only the field has a human watching it.
    */
    expect(sanitiseAmountInput('1.2.3')).toBe('1.2');
    expect(refusal('1.2.3')).toBe('unreadable');
  });
});
