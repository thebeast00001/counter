import { describe, expect, it } from 'vitest';

import { matchParty, type ParsedTransaction } from '@/domain/upi';
import type { Party } from '@/domain/model';

/**
 * Who a payment is from.
 *
 * `scripts/upi-check.mjs` covers the parser against real bank formats. This
 * covers the half that decides whose money it was, which is the half that can
 * be wrong quietly: a payment booked against the wrong customer moves two
 * balances and looks perfectly normal on both.
 */

const party = (over: Partial<Party> & { id: string; name: string }): Party => ({
  joinedAt: 0,
  contactable: true,
  ...over,
});

const txn = (over: Partial<ParsedTransaction>): ParsedTransaction =>
  ({
    amount: 500,
    direction: 'in',
    at: 0,
    raw: '',
    confidence: 1,
    ...over,
  }) as ParsedTransaction;

describe('matchParty', () => {
  const people = [
    party({ id: 'a', name: 'Meera Sharma', phone: '9876543210', vpa: 'meera@okhdfcbank' }),
    party({ id: 'b', name: 'Rahul Sharma', phone: '9811122233' }),
    party({ id: 'c', name: 'Priya Patel' }),
    party({ id: 'd', name: 'Priya Nair' }),
  ];

  it('matches an exact handle already on file', () => {
    expect(matchParty(txn({ vpa: 'meera@okhdfcbank' }), people)?.id).toBe('a');
  });

  it('is not case sensitive about the handle', () => {
    expect(matchParty(txn({ vpa: 'MEERA@OKHDFCBANK' }), people)?.id).toBe('a');
  });

  it('reads a phone number out of a numeric handle', () => {
    // `9876543210@ybl` is the commonest handle in India and the digits are the
    // person, so this is a real match rather than a guess.
    expect(matchParty(txn({ vpa: '9811122233@ybl' }), people)?.id).toBe('b');
  });

  it('refuses to guess when a name is ambiguous', () => {
    // Two Priyas. Half of the time an ambiguous match is simply wrong, and a
    // payment on the wrong customer is worse than one on nobody.
    expect(matchParty(txn({ counterparty: 'Priya' }), people)).toBeNull();
  });

  it('refuses a handle nobody owns', () => {
    expect(matchParty(txn({ vpa: 'stranger@paytm' }), people)).toBeNull();
  });

  it('refuses rather than matching on a first name alone', () => {
    // "meera@okhdfcbank" would match Meera Sharma to a human. It is refused
    // until the owner says so once, and then the handle is remembered.
    expect(matchParty(txn({ vpa: 'meera@differentbank' }), [people[1], people[2]])).toBeNull();
  });
});
