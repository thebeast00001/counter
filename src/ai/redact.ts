import type { BusinessData } from '@/domain/model';

/**
 * The curtain between the owner's customers and whoever is running the model.
 *
 * Every free inference tier is free for a reason, and the reason is usually that
 * the traffic trains the next model. This app holds names, phone numbers and
 * payment histories for real people who never agreed to that, sealed with
 * AES-256-GCM precisely so they stay local — sending them to a free endpoint
 * would quietly undo the entire security posture.
 *
 * So nothing identifying is sent. Parties become `P1`, staff become `S1`,
 * numbers become `#1`. The model reasons perfectly well about "P4 has not been
 * in for 38 days", and the owner reads "Priya Sharma has not been in for 38
 * days", because the tokens are swapped back on arrival.
 *
 * This is not obfuscation for its own sake. It means the answer to "what happens
 * if the provider logs everything" is "they log arithmetic about strangers".
 */

export type Curtain = {
  /** Replaces every identifying string in `text` with its token. */
  hide: (text: string) => string;
  /** Puts the real names back. Applied to whatever the model returns. */
  reveal: (text: string) => string;
  /** The token for a party id, for building tool output directly. */
  token: (partyId: string) => string;
  /** How many identities are behind the curtain. Useful for the privacy notice. */
  size: number;
};

/**
 * Words that happen to be names but are also ordinary English. Substituting
 * these would mangle the question rather than protect anyone — replacing "May"
 * in "how much did I make in May" with `P7` loses the month.
 */
const AMBIGUOUS = new Set([
  'may',
  'april',
  'june',
  'july',
  'august',
  'mark',
  'bill',
  'rose',
  'grace',
  'hope',
  'joy',
  'sunny',
  'happy',
  'raj',
  'dev',
  'kal',
  'man',
  'sun',
  'day',
  'week',
  'year',
]);

/** Escapes a string for literal use inside a RegExp. */
function literal(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function curtain(data: BusinessData): Curtain {
  // token -> real, and the ordered list of substitutions to apply.
  const back = new Map<string, string>();
  const byParty = new Map<string, string>();
  const subs: { pattern: RegExp; token: string }[] = [];

  const add = (real: string | undefined | null, token: string) => {
    const value = (real ?? '').trim();
    if (value.length < 2) return;
    back.set(token, value);
    subs.push({ pattern: new RegExp(literal(value), 'gi'), token });
  };

  data.parties.forEach((p, i) => {
    const token = `P${i + 1}`;
    byParty.set(p.id, token);
    add(p.name, token);
    // The full name goes first; a bare first name is added separately below so
    // "Priya Sharma" wins over "Priya" when both could match.
    const first = p.name.split(' ')[0];
    if (first && first.length >= 4 && !AMBIGUOUS.has(first.toLowerCase())) {
      subs.push({ pattern: new RegExp(`\\b${literal(first)}\\b`, 'gi'), token });
    }
    if (p.phone) subs.push({ pattern: new RegExp(literal(p.phone), 'g'), token: `${token}-phone` });
    if (p.detail) add(p.detail, `${token}-detail`);
  });

  data.staff?.forEach((s, i) => {
    const token = `S${i + 1}`;
    add(s.name, token);
  });

  // Longest patterns first. Without this "Priya" fires before "Priya Sharma"
  // and leaves a dangling surname in the payload — which is exactly the leak
  // the curtain exists to prevent.
  subs.sort((a, b) => b.pattern.source.length - a.pattern.source.length);

  // Any run of 7+ digits is treated as a phone number whether or not it belongs
  // to a party on file. Typed-in numbers are the likeliest accidental leak.
  const LOOSE_DIGITS = /\b(?:\+?\d[\d\s-]{6,}\d)\b/g;

  const hide = (text: string): string => {
    let out = text;
    for (const { pattern, token } of subs) out = out.replace(pattern, token);
    return out.replace(LOOSE_DIGITS, '#number');
  };

  const reveal = (text: string): string => {
    let out = text;
    // Longest tokens first, so `P12` is not clipped by the rule for `P1`.
    const tokens = [...back.keys()].sort((a, b) => b.length - a.length);
    for (const token of tokens) {
      out = out.replace(new RegExp(`\\b${literal(token)}\\b`, 'g'), back.get(token) as string);
    }
    return out;
  };

  return { hide, reveal, token: (id) => byParty.get(id) ?? 'someone', size: byParty.size };
}
