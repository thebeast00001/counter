import { describe, expect, it } from 'vitest';

import { ARCHETYPES } from '@/domain/archetypes';
import { buildProfile } from '@/domain/compile';
import { ask } from '@/domain/query';
import { buildSeed } from '@/domain/seed';
import { normalise } from '@/domain/vernacular';

/**
 * The translation layer in front of `ask`.
 *
 * Two failure modes matter and they pull against each other. Missing a real
 * Hindi question sends it to a model — slower, and it carries the question off
 * the phone. Firing on an English one silently answers a different question
 * than the one asked, which is worse: the owner gets a confident number with no
 * sign anything went wrong. The false-positive block below is therefore the
 * more important half of this file, and it is built out of the English words
 * that collide with romanised Hindi: log, band, top, kal, sal, is.
 */

/** What `normalise` appended, or null when it passed the question through. */
const reading = (q: string): string | null => {
  const out = normalise(q);
  const marker = out.indexOf(' · ');
  return marker === -1 ? null : out.slice(marker + 3);
};

describe('English is left alone', () => {
  const untouched = [
    'how much did i make last month',
    'who owes me money',
    'who has stopped coming',
    'what is my busiest day',
    'show me the log',
    'is the band booked',
    'top up my balance',
    'what should i do today',
  ];

  for (const q of untouched) {
    it(`passes through: ${q}`, () => {
      expect(reading(q)).toBeNull();
      expect(normalise(q)).toBe(q);
    });
  }

  it('lowercases and trims, as ask() always did', () => {
    expect(normalise('  Who Owes Me Money  ')).toBe('who owes me money');
  });
});

describe('Hindi', () => {
  const cases: [string, string][] = [
    ['कितना बाकी है', 'outstanding'],
    ['kitna baaki hai', 'outstanding'],
    ['bakaya kitna hai', 'outstanding'],
    ['कौन पैसे नहीं दिया', 'who owe'],
    ['kaun udhaar hai', 'who owe'],
    ['kisne paise nahi diye', 'who owe'],
    ['कितना कमाया', 'how much made'],
    ['kitna kamaya', 'how much made'],
    ['आमदनी', 'how much made'],
    ['kitna kharcha hua', 'spent'],
    ['खर्च कितना', 'spent'],
    ['कौन नहीं आ रहा', 'stopped'],
    ['kaun aana band kar diya', 'stopped'],
    ['कौन सा दिन सबसे ज्यादा भीड़', 'busiest day'],
    ['sabse acche grahak', 'best'],
    ['kitne log hain', 'how many'],
    ['धंधा कैसा चल रहा है', 'how is business'],
    ['aaj kya karu', 'what should i do'],
    ['औसत कितना', 'average'],
  ];

  for (const [q, want] of cases) {
    it(`${q} → ${want}`, () => {
      expect(reading(q)).toContain(want);
    });
  }
});

describe('Marathi', () => {
  const cases: [string, string][] = [
    ['किती बाकी आहे', 'outstanding'],
    ['kiti baki aahe', 'outstanding'],
    ['किती कमावले', 'how much made'],
    ['किती खर्च झाला', 'spent'],
    ['कोण येत नाही', 'stopped'],
    ['कोणता दिवस', 'busiest day'],
    ['किती लोक आहेत', 'how many'],
    ['धंदा कसा चाललाय', 'how is business'],
    ['सरासरी किती', 'average'],
  ];

  for (const [q, want] of cases) {
    it(`${q} → ${want}`, () => {
      expect(reading(q)).toContain(want);
    });
  }
});

describe('Tamil — the money questions only, for now', () => {
  const cases: [string, string][] = [
    ['எவ்வளவு பாக்கி', 'outstanding'],
    ['வருமானம் எவ்வளவு', 'how much made'],
    ['செலவு எவ்வளவு', 'spent'],
    ['யார் பாக்கி', 'who owe'],
    ['வியாபாரம் எப்படி', 'how is business'],
  ];

  for (const [q, want] of cases) {
    it(`${q} → ${want}`, () => {
      expect(reading(q)).toContain(want);
    });
  }
});

describe('periods ride along with an intent', () => {
  it('reads last month in romanised Hindi', () => {
    expect(reading('pichle mahine kitna kamaya')).toContain('last month');
  });

  it('reads last month in Devanagari', () => {
    expect(reading('पिछले महीने कितना कमाया')).toContain('last month');
  });

  it('reads Marathi last month', () => {
    expect(reading('magchya mahinyat kiti kamavle')).toContain('last month');
  });

  it('does not append a bare period with no question attached', () => {
    // "aaj" alone is not a question, and appending "today" to it would leave a
    // string that matches nothing and reads as though something was understood.
    expect(reading('aaj')).toBeNull();
  });
});

describe('exactly one intent', () => {
  /*
    Two intents in one string lands in whichever branch query.ts happens to
    check first, which is a coin toss dressed up as an answer. Spending is the
    case that actually collides — "kitna kharcha" contains "kitna", which also
    opens the takings question.
  */
  it('spending beats takings when both could match', () => {
    const said = reading('is mahine kitna kharcha hua') ?? '';
    expect(said).toContain('spent');
    expect(said).not.toContain('how much made');
  });

  it('who-owes beats the outstanding total when a person is asked for', () => {
    const said = reading('kaun kitna udhaar hai') ?? '';
    expect(said).toContain('who owe');
    expect(said).not.toContain('outstanding');
  });
});

describe('per-person facets', () => {
  it('reads how much someone paid', () => {
    expect(reading('meera ne kitna diya')).toContain('paid');
  });

  it('reads when someone last came', () => {
    expect(reading('meera kab aayi thi')).toContain('when came');
  });

  it('keeps the name in the string for resolveParty to find', () => {
    expect(normalise('meera ne kitna diya')).toContain('meera');
  });
});

/*
  The unit tests above prove the right token comes out. This proves the token
  is one `query.ts` actually reads — which is the failure that would otherwise
  be silent, because a token that no branch matches looks exactly like a
  question the device could not answer, and falls through to the model.
*/
describe('reaches a real answer through ask()', () => {
  const profile = buildProfile({
    name: 'Test Studio',
    ownerName: 'Owner',
    archetype: 'gym',
    shape: ARCHETYPES.gym.shape,
    description: 'A gym.',
  });
  const data = buildSeed(profile, { parties: 40 });

  const answered: [string, string][] = [
    ['कितना बाकी है', 'Everything outstanding'],
    ['kitna baaki hai', 'Everything outstanding'],
    ['कौन पैसे नहीं दिया', 'Who owes money'],
    ['pichle mahine kitna kamaya', 'Takings, last month'],
    ['कौन नहीं आ रहा', 'Who is drifting away'],
    ['kitna kharcha hua', 'Spending, this month'],
    ['धंधा कैसा चल रहा है', 'How the business is doing'],
    ['aaj kya karu', 'What needs doing'],
    ['sabse acche grahak', 'Most valuable'],
    ['எவ்வளவு பாக்கி', 'Everything outstanding'],
    ['किती लोक आहेत', 'Number of'],
  ];

  for (const [q, understood] of answered) {
    it(`answers ${q} without a model`, () => {
      const a = ask(profile, data, q);
      expect(a.ok).toBe(true);
      expect(a.understood).toContain(understood);
    });
  }

  it('still answers the English it always did', () => {
    expect(ask(profile, data, 'who owes me money').understood).toBe('Who owes money');
    expect(ask(profile, data, 'how much did i make last month').understood).toBe(
      'Takings, last month',
    );
  });

  it('still refuses what it does not know, in any language', () => {
    expect(ask(profile, data, 'what is the weather').ok).toBe(false);
    expect(ask(profile, data, 'मौसम कैसा है').ok).toBe(false);
  });
});

/*
  The chips in `AssistantSheet` are only as good as this.

  `assistant.tsx` builds a turn's `partyIds` out of `answer.rows[].partyId`, so
  an answer that lists people without carrying their ids renders a sentence with
  nothing to tap — which is exactly the regression the sheet shipped with, and
  is invisible from the sheet's own code.
*/
describe('answers about people carry ids to open them with', () => {
  const profile = buildProfile({
    name: 'Test Studio',
    ownerName: 'Owner',
    archetype: 'gym',
    shape: ARCHETYPES.gym.shape,
    description: 'A gym.',
  });
  const data = buildSeed(profile, { parties: 40 });

  const naming = ['sabse acche grahak', 'कौन नहीं आ रहा', 'who are my best customers'];

  for (const q of naming) {
    it(`${q} returns rows that resolve to real people`, () => {
      const rows = ask(profile, data, q).rows;
      const ids = rows.map((r) => r.partyId).filter(Boolean) as string[];
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(data.parties.some((p) => p.id === id)).toBe(true);
      }
    });
  }
});
