import { ARCHETYPES, ARCHETYPE_ORDER } from '@/domain/archetypes';
import type {
  ArchetypeKey,
  BusinessProfile,
  BusinessShape,
  Vocabulary,
} from '@/domain/model';

/**
 * Compiles a plain-language description into a configured business.
 *
 * This is the moment the whole product rests on: a sentence in, a working
 * business model out. It runs on-device with no network, which shapes what it
 * can be — this is deterministic inference over cues and numbers, not a language
 * model. It reads the description for trade signals, pulls out any figures, and
 * adjusts the archetype's weights from phrases that change how the business
 * actually works.
 *
 * That is honest about its limits: it will read "I run a gym with 400 members"
 * correctly and will not understand an unusual business described obliquely.
 * `refine()` exists for exactly that — the follow-up questions resolve what the
 * text could not. When a model is available it slots in at `inferArchetype` and
 * `inferAdjustments` without anything downstream changing, because both already
 * return the same structures.
 */

export type Confidence = 'high' | 'medium' | 'low';

export type CompileResult = {
  archetype: ArchetypeKey;
  confidence: Confidence;
  shape: BusinessShape;
  /** Figures lifted from the text, for pre-filling rather than re-asking. */
  scale: { parties?: number; staff?: number };
  /** Weights the text could not settle. These become the follow-up questions. */
  unresolved: UnresolvedKey[];
};

export type UnresolvedKey = 'staffAttribution' | 'commitmentWeight' | 'paymentTiming';

/* ------------------------------------------------------------- archetype -- */

function scoreArchetype(text: string, key: ArchetypeKey): number {
  const { cues } = ARCHETYPES[key];
  let score = 0;
  for (const cue of cues) {
    // Word-boundary match so "car" does not fire inside "care", plus an optional
    // plural — people write "five trainers" and "monthly memberships", and
    // missing those was quietly halving every confidence score.
    const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}s?\\b`, 'i');
    if (pattern.test(text)) score += cue.includes(' ') ? 3 : 2;
  }
  return score;
}

function inferArchetype(text: string): { archetype: ArchetypeKey; confidence: Confidence } {
  const scored = ARCHETYPE_ORDER.filter((k) => k !== 'generic')
    .map((key) => ({ key, score: scoreArchetype(text, key) }))
    .sort((a, b) => b.score - a.score);

  const [best, second] = scored;
  if (!best || best.score === 0) return { archetype: 'generic', confidence: 'low' };

  // A clear winner is one that beats the runner-up outright, not one that merely
  // scored. Two trades tying means the description was ambiguous, and saying so
  // is better than picking.
  const margin = best.score - (second?.score ?? 0);
  const confidence: Confidence = best.score >= 4 && margin >= 2 ? 'high' : margin >= 1 ? 'medium' : 'low';
  return { archetype: best.key, confidence };
}

/* ----------------------------------------------------------------- scale -- */

/** Pulls "400 members" and "five trainers" out of the text, words included. */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20,
};

function readNumberNear(text: string, nouns: string[]): number | undefined {
  for (const noun of nouns) {
    const digits = new RegExp(`(\\d[\\d,]*)\\s*(?:\\w+\\s+){0,2}${noun}`, 'i').exec(text);
    if (digits) {
      const n = Number(digits[1].replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
    const words = new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join('|')})\\s+(?:\\w+\\s+){0,2}${noun}`, 'i').exec(text);
    if (words) return WORD_NUMBERS[words[1].toLowerCase()];
  }
  return undefined;
}

/* ----------------------------------------------------------- adjustments -- */

/**
 * Phrases that genuinely change the shape, and therefore the product.
 *
 * Each entry is a signal that overrides the archetype's default, because the
 * archetype is only a starting guess — a gym selling class packs is not the gym
 * the default assumes.
 */
function inferAdjustments(text: string, base: BusinessShape): { shape: BusinessShape; resolved: Set<UnresolvedKey> } {
  const shape = { ...base };
  const resolved = new Set<UnresolvedKey>();

  const has = (...phrases: string[]) => phrases.some((p) => new RegExp(p, 'i').test(text));

  // Commitment weight — is revenue promised in advance, or earned per visit?
  if (has('per session', 'per class', 'per visit', 'walk[- ]?in', 'pay as you go', 'drop[- ]?in')) {
    shape.commitmentWeight = Math.min(shape.commitmentWeight, 0.15);
    resolved.add('commitmentWeight');
  }
  if (has('membership', 'subscription', 'monthly plan', 'annual', 'yearly plan', 'enrol')) {
    shape.commitmentWeight = Math.max(shape.commitmentWeight, 0.7);
    resolved.add('commitmentWeight');
  }

  // Staff attribution — do customers belong to a person?
  if (has('each .{0,20}(has|with) (a|their own) (trainer|teacher|stylist|doctor)', 'personal trainer', 'assigned')) {
    shape.staffAttribution = true;
    resolved.add('staffAttribution');
  }
  if (has('no trainers?', 'no staff', 'just me', 'i work alone', 'on my own', 'solo')) {
    shape.staffAttribution = false;
    resolved.add('staffAttribution');
  }

  /*
    Payment timing — decides whether receivables exist at all.

    The advance patterns used to require the words to touch: `pay (in )?advance`
    matched "pay in advance" and missed "pay 40 percent advance", which is how
    an owner actually writes it. Anything may now sit between the verb and the
    noun.

    Split payments are the case that matters most and had no representation at
    all. "40 percent advance and the rest after delivery" is how weddings,
    tailoring, catering and construction are all paid in this market, and it is
    *both* answers at once. It resolves to `after`, because the half that
    decides the app's behaviour is the balance still owed — that is what makes
    receivables, chasing and reliability scores exist. Recording it as `before`
    would leave an owner with no way to see what is outstanding.
  */
  const paysAhead = has(
    'advance',
    'upfront',
    'up front',
    'prepaid',
    'deposit',
    'booking amount',
    'token amount',
    'pay before',
  );
  const paysAfter = has(
    'pay later',
    'on credit',
    'after (the )?(service|work|delivery|shoot|job|event)',
    // A bare "they pay after", with nothing following it, is the commonest
    // phrasing of all and matched none of the patterns above.
    'pays? after',
    'paid after',
    'paid later',
    'on delivery',
    '(rest|balance|remainder|remaining)[^.]{0,20}(after|later|on delivery)',
    'monthly bill',
    'invoice',
    'pending fees?',
  );

  if (paysAhead && !paysAfter) {
    shape.paymentTiming = 'before';
    resolved.add('paymentTiming');
  } else if (paysAfter) {
    shape.paymentTiming = 'after';
    resolved.add('paymentTiming');
  }

  return { shape, resolved };
}

/* --------------------------------------------------------------- compile -- */

export function compile(description: string): CompileResult {
  const text = description.trim();
  const { archetype, confidence } = inferArchetype(text);
  const base = ARCHETYPES[archetype].shape;
  const { shape, resolved } = inferAdjustments(text, base);

  const parties = readNumberNear(text, [
    'members?', 'students?', 'clients?', 'customers?', 'patients?', 'people',
  ]);
  const staff = readNumberNear(text, [
    'trainers?', 'teachers?', 'stylists?', 'mechanics?', 'staff', 'employees?',
  ]);

  // Only ask about what the description left genuinely open, and only where the
  // answer changes the product. Every avoidable question is a question the
  // owner should not have been asked.
  const candidates: UnresolvedKey[] = ['commitmentWeight', 'staffAttribution', 'paymentTiming'];
  const unresolved = candidates.filter((key) => {
    if (resolved.has(key)) return false;
    if (key === 'staffAttribution' && staff === undefined) return false;
    return true;
  });

  return {
    archetype,
    confidence,
    shape,
    scale: { parties, staff },
    unresolved,
  };
}

/** Applies a follow-up answer to the compiled shape. */
/**
 * Applies one follow-up answer.
 *
 * Takes the option's own value rather than a boolean. The questions used to be
 * strictly yes/no, which was fine until payment timing needed three answers —
 * and "part up front, the rest afterwards" is not an edge case here, it is how
 * most project work in this market is paid.
 */
export function refine(shape: BusinessShape, key: UnresolvedKey, answer: string): BusinessShape {
  switch (key) {
    case 'commitmentWeight':
      return { ...shape, commitmentWeight: answer === 'plan' ? 0.85 : 0.1 };
    case 'staffAttribution':
      return { ...shape, staffAttribution: answer === 'own' };
    case 'paymentTiming':
      return {
        ...shape,
        paymentTiming: answer === 'before' || answer === 'split' || answer === 'after' ? answer : 'at',
      };
    default:
      return shape;
  }
}

/** The follow-up copy, in the owner's terms rather than the model's. */
export type FollowUp = {
  question: string;
  options: { value: string; label: string }[];
};

export const FOLLOW_UPS: Record<UnresolvedKey, FollowUp> = {
  commitmentWeight: {
    question: 'How do people usually pay you?',
    options: [
      { value: 'plan', label: 'A plan they renew' },
      { value: 'each', label: 'Each time they come' },
    ],
  },
  staffAttribution: {
    question: 'Do customers stay with one particular person?',
    options: [
      { value: 'own', label: 'Yes, they have their own' },
      { value: 'any', label: 'No, whoever is free' },
    ],
  },
  paymentTiming: {
    question: 'When does the money come in?',
    options: [
      { value: 'before', label: 'Before or at the time' },
      // Third because it is the one an owner looks for after finding neither of
      // the others true, and offering it first would over-suggest it.
      { value: 'split', label: 'Part up front, rest after' },
      { value: 'after', label: 'Afterwards, sometimes late' },
    ],
  },
};

/* ------------------------------------------------------------ vocabulary -- */

/*
  The owner's own nouns, for a business the archetypes cannot name.

  `generic` calls everybody a "Customer" and everything a "Visit", which is true
  of nothing in particular — it is the placeholder the other six exist to avoid.
  But an owner who wrote "I shoot weddings for clients" has already said what
  they call the two things this app puts on screen most often, and their word is
  right more often than the placeholder and costs nothing to use.

  Deliberately only for `generic`. A named archetype's vocabulary was chosen for
  the trade and is better than one noun lifted out of a sentence: a gym whose
  description happens to say "clients" once should not have every member in the
  app quietly renamed.
*/

type WordRule = [RegExp, string, string];

const PARTY_WORDS: WordRule[] = [
  [/\bstudents?\b/i, 'Student', 'Students'],
  [/\bpupils?\b/i, 'Pupil', 'Pupils'],
  [/\bpatients?\b/i, 'Patient', 'Patients'],
  [/\bclients?\b/i, 'Client', 'Clients'],
  [/\bmembers?\b/i, 'Member', 'Members'],
  [/\bguests?\b/i, 'Guest', 'Guests'],
  [/\btenants?\b/i, 'Tenant', 'Tenants'],
  [/\bsubscribers?\b/i, 'Subscriber', 'Subscribers'],
];

const ENGAGEMENT_WORDS: WordRule[] = [
  [/\bclass(?:es)?\b/i, 'Class', 'Classes'],
  [/\blessons?\b/i, 'Lesson', 'Lessons'],
  [/\bsessions?\b/i, 'Session', 'Sessions'],
  [/\bappointments?\b/i, 'Appointment', 'Appointments'],
  [/\bbookings?\b/i, 'Booking', 'Bookings'],
  [/\bshoots?\b/i, 'Shoot', 'Shoots'],
  [/\bdeliver(?:y|ies)\b/i, 'Delivery', 'Deliveries'],
  [/\borders?\b/i, 'Order', 'Orders'],
  [/\brepairs?\b/i, 'Repair', 'Repairs'],
  [/\bjobs?\b/i, 'Job', 'Jobs'],
];

/**
 * The earliest of these words in the text, not the first in the list.
 *
 * Someone who writes "I teach students, mostly for corporate clients" calls
 * them students; list order would have made that depend on which rule happened
 * to be written first, which is not a decision the table should be making.
 */
function firstWord(text: string, rules: WordRule[]): { one: string; many: string } | null {
  let best: { at: number; one: string; many: string } | null = null;
  for (const [pattern, one, many] of rules) {
    const at = text.search(pattern);
    if (at < 0) continue;
    if (best === null || at < best.at) best = { at, one, many };
  }
  return best ? { one: best.one, many: best.many } : null;
}

function deriveVocabulary(archetype: ArchetypeKey, description: string): Vocabulary {
  const base = ARCHETYPES[archetype].vocabulary;
  if (archetype !== 'generic' || description.trim().length === 0) return base;

  const party = firstWord(description, PARTY_WORDS);
  const engagement = firstWord(description, ENGAGEMENT_WORDS);
  if (!party && !engagement) return base;

  return { ...base, ...(party ? { party } : {}), ...(engagement ? { engagement } : {}) };
}

/**
 * Repairs a stored profile against the current archetype table.
 *
 * A profile is written once at onboarding and never touched again, so a
 * correction to the vocabulary reaches every new business and no existing one.
 * Two archetypes shipped with `['Staff', 'Staff']` — the team screen read "Add
 * a staff" — and fixing the table left every device that had already onboarded
 * saying it forever.
 *
 * Only terms that break the invariant `scripts/compile-check.mjs` asserts get
 * replaced: a singular that is really a plural, so "Add a {one}" is not a
 * sentence. Everything else is left exactly as stored, because a vocabulary an
 * owner is used to is not something an update should quietly rewrite — this is
 * a repair, not a migration to the newest wording.
 */
export function hydrateProfile(profile: BusinessProfile | null): BusinessProfile | null {
  if (!profile) return null;
  const table = ARCHETYPES[profile.archetype]?.vocabulary;
  if (!table) return profile;

  let repaired: Vocabulary | null = null;
  for (const key of Object.keys(table) as (keyof Vocabulary)[]) {
    const term = profile.vocabulary?.[key];
    if (term && term.one !== term.many) continue;
    repaired ??= { ...profile.vocabulary };
    repaired[key] = table[key];
  }
  return repaired ? { ...profile, vocabulary: repaired } : profile;
}

/** Builds the finished profile once the shape has settled. */
export function buildProfile(input: {
  name: string;
  ownerName?: string;
  description: string;
  archetype: ArchetypeKey;
  shape: BusinessShape;
}): BusinessProfile {
  return {
    id: `b_${Date.now().toString(36)}`,
    name: input.name.trim() || ARCHETYPES[input.archetype].label,
    ownerName: input.ownerName?.trim() || undefined,
    archetype: input.archetype,
    vocabulary: deriveVocabulary(input.archetype, input.description),
    shape: input.shape,
    description: input.description.trim(),
    createdAt: Date.now(),
  };
}
