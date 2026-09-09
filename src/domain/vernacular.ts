/**
 * Questions asked the way they are actually asked.
 *
 * `query.ts` answers a bounded set of questions on the device, and every
 * pattern in it is English. That was fine while the only way in was a keyboard,
 * and stopped being fine the moment the microphone arrived: Sarvam transcribes
 * Hindi, Marathi and Tamil accurately, and the transcript then met a matcher
 * that recognised none of it. So the owner this app is built for — the one who
 * runs a counter in Marathi and reaches for a keyboard last — got the slowest
 * and least private path for every question, while an English speaker got the
 * instant offline one. The property the whole product rests on was, in
 * practice, an English-language feature.
 *
 * ## Why this translates rather than matches
 *
 * The obvious fix is to add Devanagari alternatives to the twenty-five regexes
 * in `query.ts`. That would work once and rot immediately: every new question
 * shape would need four translations, and the branch order — which carries real
 * meaning, like takings excluding itself when the question is about spending —
 * would have to be reasoned about in four languages at once.
 *
 * Instead this normalises the question into the vocabulary `query.ts` already
 * speaks, and appends rather than replaces. Appending matters: `resolveParty`
 * looks for customer names in the same string, so the original words have to
 * survive. "कितना बाकी है" goes in and "कितना बाकी है · outstanding" comes out,
 * which the existing outstanding branch matches without knowing why.
 *
 * ## Two rules that keep it from firing on English
 *
 * - **Phrases, not words.** `log`, `band`, `top` and `kal` are all ordinary
 *   English or ambiguous, so the rules that use them require a second token —
 *   `kitne log`, `aana band`. A single word is only allowed when it cannot be
 *   mistaken for English: `kitna`, `udhaar`, `kharcha`, `grahak`.
 * - **One intent per question.** The intent list is ordered and stops at the
 *   first hit, because appending two of them would land in whichever branch
 *   `query.ts` happens to check first. Periods and per-person facets are
 *   separate lists precisely because they compose with any intent.
 *
 * Hindi and Marathi are covered properly, in both Devanagari and the romanised
 * spelling people actually type. Tamil covers the money questions only; that is
 * a deliberate floor rather than a finished job, and the roadmap's five
 * languages is still ahead of us.
 */

type Rule = {
  /** The English `query.ts` already understands. */
  add: string;
  when: RegExp;
};

/*
  Ordered, and the first match wins.

  "कितना खर्च" contains "कितना", which also opens the takings question — so
  spending is tested before earning, exactly as `query.ts` orders its own
  branches. Where the two files agree on precedence they agree by construction,
  not by coincidence: the token appended here is the token that branch reads.
*/
const INTENTS: Rule[] = [
  // Who owes — before the outstanding total, because both mention udhaar and
  // only this one names a person to chase.
  {
    add: 'who owe',
    when: /\b(kaun|kon|kis(ne|ka|ko)|yaar)\b.*\b(udh?aa?r|udhari|paise?|paisa|baa?ki|bakaya|paakki)\b|\b(paise?|paisa)\b.*\bnahi+n?\s+diy[ae]\b|कौन.*(उधार|पैसे|बाकी)|किसने.*(नहीं दिया|उधार|पैसे)|किसका.*उधार|कोण.*(उधारी|पैसे|बाकी)|कोणाकडे.*उधारी|யார்.*(பாக்கி|பணம்)/,
  },
  // The outstanding total.
  {
    add: 'outstanding',
    when: /\b(kitn[aie]|kiti|evvalavu)\b.*\b(baa?ki|bakaya|udh?aa?r|udhari|paakki)\b|\b(baa?ki|udh?aa?r|udhari)\b.*\b(kitn[aie]|kiti)\b|\bbakaya\b|कितना\s*(बाकी|उधार)|बाकी\s*कितना|बकाया|किती\s*(बाकी|उधारी)|उधारी\s*किती|येणे\s*बाकी|எவ்வளவு.*பாக்கி/,
  },
  // Spending.
  {
    add: 'spent',
    when: /\bkharch[ae]?\b|\bkitn[aie]\s+kharch|\bkiti\s+kharch|खर्च|खर्चा|செலவு/,
  },
  // Takings.
  {
    add: 'how much made',
    when: /\b(kitn[aie]|kiti)\b.*\b(kamaya|kamai|kamav?le|aay?a|aaye|aale|mila|milaa)\b|\b(kamai|kamaai|aamdani|amdani|bikri|utpann?a|varum[aā]nam)\b|कितन[ाीे]\s*(कमाया|कमाई|आया|आये|मिला)|कमाई|आमदनी|बिक्री|किती\s*(कमावले|आले|मिळाले)|उत्पन्न|வருமானம்|எவ்வளவு\s*சம்பாதி/,
  },
  // People drifting away.
  {
    add: 'stopped',
    when: /\b(kaun|kon|kaun\s*se|yaar)\b.*\b(nahi+n?\s*aa|aana\s*band|aata\s*nahi|yet\s*nahi|gayab|chhoot|chhut)\b|\baana\s+band\b|\bgayab\b|कौन.*(नहीं आ|आना बंद|गायब)|आना\s*बंद|गायब|कोण.*(येत नाही|बंद)|छूट\s*गए/,
  },
  // Busiest or quietest day.
  {
    add: 'busiest day',
    when: /\b(kaun\s*sa\s*din|konta\s*divas|sabse\s*(zyada|jyada)\s*bh?ee?d|sabse\s*vyast|gardi)\b|कौन\s*सा\s*दिन|सबसे\s*(ज्यादा|अधिक)\s*भीड़|भीड़\s*कब|कोणता\s*दिवस|सर्वात\s*गर्दी/,
  },
  {
    add: 'quietest day',
    when: /\b(sabse\s*kam\s*bh?ee?d|khali\s*din|sabse\s*shant)\b|सबसे\s*कम\s*भीड़|खाली\s*दिन|सर्वात\s*कमी\s*गर्दी/,
  },
  // Most valuable.
  {
    add: 'best',
    when: /\b(sabse\s*(acch?[ae]|badh?[ae]|zyada\s*dene)|top\s*(grahak|customer)|sarvat\s*changl[ae])\b.*|सबसे\s*(अच्छे|बड़े|ज्यादा देने)|सर्वात\s*चांगल[ेा]|சிறந்த\s*வாடிக்கை/,
  },
  // Counting.
  {
    add: 'how many',
    when: /\b(kitne\s*(log|grahak|customer|member|bacche|naye)|kiti\s*(lok|grahak|navin)|kul\s*kitne)\b|कितने\s*(लोग|ग्राहक|सदस्य|नए)|किती\s*(लोक|ग्राहक|नवीन)|कुल\s*कितने/,
  },
  // How is business.
  {
    add: 'how is business',
    when: /\b(dh?and[ha]{1,2}[ae]?\s*(kaisa|kasa)|kaisa\s*chal|kaise\s*chal|kasa\s*chal|sab\s*kaisa|business\s*kaisa)\b|धंधा\s*कैसा|कैसा\s*चल|सब\s*कैसा|धंदा\s*कसा|कसं\s*चालल|வியாபாரம்\s*எப்படி/,
  },
  // What needs doing.
  {
    add: 'what should i do',
    when: /\b(kya\s*kar(na|un|oon|u)\b|aaj\s*kya|kay\s*karav|kay\s*karu)\b|क्या\s*कर(ना|ूं|ूँ|ें)|आज\s*क्या|काय\s*कराव|आज\s*काय/,
  },
  // Renewals and filings.
  {
    add: 'renew',
    when: /\b(renew\s*karna|licen[cs]e\s*(kab|kitna)|gst\s*bharna|bharna\s*hai)\b|रिन्यू|लाइसेंस|भरना\s*है|परवाना|नूतनीकरण/,
  },
  // Averages.
  {
    add: 'average',
    when: /\b(ausat|sarasari|average\s*kitna)\b|औसत|सरासरी|சராசரி/,
  },
];

/*
  Periods compose with any intent, so they are their own list. `query.ts` only
  ever resolves a period inside a backward-looking branch, which is what makes
  the कल / kal ambiguity safe to ignore: it means both yesterday and tomorrow,
  and the one branch that could be misled by "yesterday" — what should I do —
  never reads a period at all. Marathi काल is unambiguous.
*/
const PERIODS: Rule[] = [
  {
    add: 'last month',
    when: /\b(pichl[ae]|gay[ae]|last)\s*(mahin[aey]|month)\b|\bmagchya\s*mahinya|पिछले\s*महीने|पिछला\s*महीना|मागच्या\s*महिन्यात|கடந்த\s*மாதம்/,
  },
  { add: 'this month', when: /\b(is|iss|ya)\s*mahin[aey]\b|इस\s*महीने|या\s*महिन्यात/ },
  { add: 'last week', when: /\b(pichl[ae]|gay[ae])\s*(haft[ae]|saptah)\b|पिछले\s*(हफ्ते|सप्ताह)|मागच्या\s*आठवड/ },
  { add: 'this week', when: /\b(is|iss|ya)\s*(haft[ae]|saptah|athvad)\b|इस\s*हफ्ते|या\s*आठवड/ },
  { add: 'last year', when: /\b(pichl[ae]|gay[ae])\s*(saal|sal|varsh)\b|पिछले\s*साल|मागच्या\s*वर्ष/ },
  { add: 'this year', when: /\b(is|iss|ya)\s*(saal|sal|varsh)\b|इस\s*साल|या\s*वर्ष/ },
  { add: 'today', when: /\baaj\b|\bindru\b|आज|இன்று/ },
  { add: 'yesterday', when: /\b(kal|kaal|netru)\b|कल\b|काल\b|நேற்று/ },
];

/*
  Facets only mean anything once a name has been found, and `query.ts` decides
  that for itself — so these are appended whenever they match and simply go
  unread when the question named nobody.
*/
const FACETS: Rule[] = [
  {
    add: 'paid',
    when: /\b(kitn[aie]|kiti)\s*(diy[ae]|dil[ae]|paid)\b|कितना\s*दिया|किती\s*दिले/,
  },
  {
    add: 'when came',
    when: /\b(kab|kadhi|kabse)\s*(aay?[ai]|aal[ae]|gay[ae])\b|\blast\s*kab\b|कब\s*आय[ाी]|कधी\s*आल[ाे]|எப்போது\s*வந்த/,
  },
];

/** Every canonical token this can emit — the check script asserts on these. */
export const CANONICAL = [
  ...INTENTS.map((r) => r.add),
  ...PERIODS.map((r) => r.add),
  ...FACETS.map((r) => r.add),
];

/**
 * The question, plus the English that says what it asked.
 *
 * Returns the input lowercased and trimmed when nothing matched, so this is
 * safe to call on every question rather than only the ones that look foreign —
 * an English question matches no rule and passes through untouched.
 */
export function normalise(question: string): string {
  const q = question.toLowerCase().trim();

  const added: string[] = [];
  const first = (rules: Rule[]) => rules.find((r) => r.when.test(q));

  const intent = first(INTENTS);
  if (intent) added.push(intent.add);

  const facet = first(FACETS);
  if (facet) added.push(facet.add);

  // A period on its own says nothing worth acting on, and appending "today" to
  // an English question that already resolves its own period is noise.
  if (added.length > 0) {
    const period = first(PERIODS);
    if (period) added.push(period.add);
  }

  return added.length === 0 ? q : `${q} · ${added.join(' ')}`;
}

/** Whether the question needed translating. Used by the surfaces, not by `ask`. */
export function isVernacular(question: string): boolean {
  return normalise(question) !== question.toLowerCase().trim();
}
