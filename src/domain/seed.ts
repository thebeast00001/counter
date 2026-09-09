import { ARCHETYPES } from '@/domain/archetypes';
import type {
  BusinessData,
  BusinessProfile,
  Closure,
  Commitment,
  Engagement,
  EventNote,
  ExpenseCategory,
  FixedCost,
  MemoryFact,
  MoneyEntry,
  Obligation,
  Offering,
  Party,
  PaymentMethod,
  Staff,
  Template,
} from '@/domain/model';
import { EMPTY_DATA } from '@/domain/model';

/**
 * Generates a plausible history for a freshly compiled business.
 *
 * A new owner needs to see the product working before she has entered anything —
 * an empty intelligence layer is indistinguishable from a broken one. This
 * builds ninety days of records shaped by the business's own weights, so a
 * commitment-heavy gym gets renewals and expiries while a café gets order volume
 * and neither gets the other.
 *
 * Deterministic on purpose: a demo that reshuffles between rehearsal and the
 * real pitch is a liability.
 *
 * Everything the intelligence layer can read is generated, including the parts
 * that are inconvenient — late payers, no-shows, a fee rise, a closed day. A
 * seed where nothing is ever wrong produces an app with nothing to say.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Stable pseudo-random in [0,1) from an integer seed. */
function rand(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const FIRST = [
  'Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Sana', 'Vikram', 'Ananya',
  'Arjun', 'Isha', 'Neha', 'Rahul', 'Priya', 'Karan', 'Tara', 'Aditya',
  'Nikhil', 'Riya', 'Sameer', 'Pooja', 'Manav', 'Kavya', 'Dev', 'Anjali',
];
const LAST = ['Sharma', 'Patel', 'Nair', 'Reddy', 'Iyer', 'Khan', 'Bose', 'Mehta', 'Rao', 'Gupta'];

function personName(i: number): string {
  return `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;
}

const STAFF_NAMES = ['Ravi', 'Simran', 'Imran', 'Leela', 'Vikas', 'Farah', 'Joseph', 'Nisha'];

const METHODS: PaymentMethod[] = ['upi', 'cash', 'upi', 'card', 'upi', 'transfer', 'cash'];

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * A business with nothing in it yet.
 *
 * What a real new account starts as. `buildSeed` is kept beside it for the
 * sample-data option in Settings — demonstrating the app to somebody needs a
 * populated one, and an owner who wants to see what a full month looks like
 * before committing should be able to.
 *
 * The two must never be confused at install time. Every derived figure in the
 * app — churn, forecasts, findings — is only as honest as the records under it,
 * and a new owner cannot tell an invented member from one of their own.
 */
export function emptyData(): BusinessData {
  return {
    parties: [],
    commitments: [],
    engagements: [],
    money: [],
    offerings: [],
    staff: [],
    resources: [],
    obligations: [],
    templates: [],
    closures: [],
    waitlist: [],
    fixedCosts: [],
    facts: [],
    events: [],
    actions: [],
    rules: [],
    forecasts: [],
  };
}

export function buildSeed(
  profile: BusinessProfile,
  scale: { parties?: number; staff?: number },
): BusinessData {
  const { shape } = profile;
  const now = Date.now();

  // Cap the generated set well below a real roster: enough for every metric to
  // be meaningful, small enough that the first screen is instant.
  const partyCount = Math.max(12, Math.min(scale.parties ?? 60, 90));
  const staffCount = Math.max(0, Math.min(scale.staff ?? (shape.staffAttribution ? 3 : 0), 8));

  /* ------------------------------------------------------------- staff -- */
  const staff: Staff[] = Array.from({ length: staffCount }, (_, i) => ({
    id: `s${i}`,
    name: STAFF_NAMES[i % STAFF_NAMES.length],
    role: profile.vocabulary.person.one,
    // One manager, everyone else on the restricted level — the arrangement most
    // owners actually want and assume no software supports.
    access: i === 0 ? 'manager' : 'staff',
    active: true,
    phone: `9${String(700000000 + Math.floor(rand(i + 301) * 99999999)).slice(0, 9)}`,
  }));

  /* ---------------------------------------------------------- offerings -- */
  const offerings: Offering[] = ARCHETYPES[profile.archetype].starterOfferings.map((o, i) => ({
    id: `o${i}`,
    name: o.name,
    price: o.price,
    durationDays: o.durationDays,
    cost: Math.round(o.price * 0.35),
    active: true,
  }));

  const recurring = offerings.filter((o) => o.durationDays);
  const oneOff = offerings.filter((o) => !o.durationDays);

  /* ------------------------------------------------------------ parties -- */
  const parties: Party[] = Array.from({ length: partyCount }, (_, i) => ({
    id: `p${i}`,
    name: personName(i),
    phone: `9${String(800000000 + Math.floor(rand(i + 1) * 99999999)).slice(0, 9)}`,
    joinedAt: now - Math.floor(rand(i + 7) * 300 + 5) * DAY,
    staffId: shape.staffAttribution && staff.length ? staff[i % staff.length].id : null,
    contactable: rand(i + 401) > 0.04,
    // A tenth of the roster arrived by word of mouth, attributed to an earlier
    // member. Without this the referral graph has nothing to draw.
    referredBy: i > 8 && rand(i + 211) < 0.22 ? `p${Math.floor(rand(i + 212) * 8)}` : null,
  }));

  /**
   * How late this person pays, as a stable trait.
   *
   * Assigned per party rather than per payment, because reliability is a property
   * of a person. Randomising it per payment would make every score converge on
   * the same average and the whole signal would disappear.
   *
   * Only businesses that invoice after the work have late payers at all. Giving a
   * pay-up-front gym a spread of delays contradicted its own declared shape, and
   * the drift detector correctly — and embarrassingly — reported that the
   * business had changed shape within seconds of being created.
   */
  const lateness = (i: number): number => {
    if (shape.paymentTiming !== 'after') return 0;
    const r = rand(i + 501);
    if (r < 0.55) return 0; // pays on the day
    if (r < 0.85) return 2 + rand(i + 502) * 4; // a few days
    return 9 + rand(i + 503) * 14; // chronically late
  };

  const commitments: Commitment[] = [];
  const engagements: Engagement[] = [];
  const money: MoneyEntry[] = [];

  /* -------------------------------------------------------- commitments -- */
  if (shape.commitmentWeight > 0.4 && recurring.length > 0) {
    parties.forEach((party, i) => {
      const offering = recurring[i % recurring.length];
      const days = offering.durationDays ?? 30;

      // Spread expiry so some are live, some just gone, and a realistic handful
      // fall inside the next week — the case the product exists to catch.
      const endOffset = Math.floor(rand(i + 21) * 70) - 22;
      const endAt = now + endOffset * DAY;
      // A plan cannot begin before the person existed. Without this clamp the
      // timeline on a recent joiner read "Enrolment started 30 July / Joined 13
      // August", which is the kind of small impossibility that makes an owner
      // stop trusting every other date on the screen.
      const startAt = Math.max(endAt - days * DAY, party.joinedAt);

      commitments.push({
        id: `c${i}`,
        partyId: party.id,
        offeringId: offering.id,
        startAt,
        endAt,
        price: offering.price,
        status: endAt < now ? 'expired' : 'active',
        autoRenew: rand(i + 601) < 0.3,
      });

      // Payments are emitted as a renewal process anchored in the past, not
      // derived from the commitment's own cycles.
      //
      // Deriving them from a forward-spread expiry date biases every comparison:
      // the older window collects payments from two cycles while the recent one
      // collects from fewer, so every seeded business read as though takings had
      // collapsed. Anchoring each party at a random phase and stepping backwards
      // gives a flat aggregate — which is what a stable business actually looks
      // like, and lets a real trend show up as a real trend.
      const phase = rand(i + 101) * days;
      const delay = lateness(i);

      for (let j = 0; ; j++) {
        const dueAt = now - (phase + j * days) * DAY;
        if (dueAt < now - 200 * DAY || dueAt < party.joinedAt) break;

        const settledAt = dueAt + delay * DAY;
        // A payment whose settle date has not arrived yet has not been made.
        // Clamping it to `now` instead piled every late payer's instalment onto
        // today, so the first screen an owner saw claimed a ₹23k morning against
        // a normal Wednesday of ₹3k.
        const unpaid =
          settledAt > now ||
          (shape.paymentTiming === 'after' && j === 0 && rand(i + 33) < 0.18);

        money.push({
          id: `m_c${i}_${j}`,
          partyId: party.id,
          amount: offering.price,
          direction: 'in',
          // An unpaid entry is dated when it fell due; a settled one when it landed.
          at: unpaid ? dueAt : settledAt,
          dueAt,
          settledAt: unpaid ? null : settledAt,
          status: unpaid ? 'due' : 'settled',
          label: offering.name,
          method: unpaid ? undefined : METHODS[(i + j) % METHODS.length],
          offeringId: offering.id,
        });
      }
    });
  }

  /* -------------------------------------------------------- engagements -- */
  const perParty = shape.engagementFreq === 'high' ? 14 : shape.engagementFreq === 'medium' ? 4 : 1.4;

  parties.forEach((party, i) => {
    // Roughly a sixth of people are drifting — their visits stop well before the
    // present. This is what gives lapse detection something real to find, and it
    // is capped deliberately: a seed where a third of the roster has vanished
    // describes a business in crisis, not a business worth demonstrating.
    const fading = rand(i + 51) < 0.16;
    const count = Math.max(3, Math.round(perParty * (0.6 + rand(i + 61) * 0.8)));
    const delay = lateness(i);

    /**
     * Visits step backwards from a recent anchor at this person's own cadence.
     *
     * They used to be scattered uniformly across the window, which looks right in
     * aggregate and is completely wrong per person: a member with fourteen
     * independent uniform draws has a good chance their latest one landed ten days
     * ago purely by luck. Nobody had a rhythm, so the churn model — which asks
     * whether someone has departed from their rhythm — flagged half the roster.
     *
     * A cadence with jitter gives each person a habit to keep or break, which is
     * what the entire intelligence layer is built to read.
     */
    const cadence = (90 / count) * (0.75 + rand(i + 81) * 0.5);
    // Regulars were in within the last cycle; faders stopped a month or more ago.
    const lastVisit = fading
      ? now - (30 + rand(i + 91) * 55) * DAY
      : now - rand(i + 91) * cadence * DAY;

    for (let k = 0; k < count; k++) {
      const jitter = (rand(i * 31 + k + 3) - 0.5) * cadence * 0.5;
      const at =
        lastVisit -
        (k * cadence + jitter) * DAY -
        Math.floor(rand(i + k) * 12) * 60 * 60 * 1000;
      if (at > now || at < party.joinedAt || at < now - 180 * DAY) continue;

      const offering = oneOff.length ? oneOff[(i + k) % oneOff.length] : null;
      const value =
        shape.commitmentWeight > 0.4 ? undefined : (offering?.price ?? 0) * (0.8 + rand(i + k + 11) * 0.6);
      const missed = rand(i * 17 + k + 701) < 0.05;

      engagements.push({
        id: `e${i}_${k}`,
        partyId: party.id,
        at,
        staffId: staff.length ? staff[(i + k) % staff.length].id : null,
        offeringId: offering?.id ?? null,
        value: value && !missed ? Math.round(value) : undefined,
        noShow: missed || undefined,
        source: 'seed',
      });

      if (value && !missed) {
        const settledAt = at + delay * DAY;
        const unpaid = settledAt > now || (shape.paymentTiming === 'after' && rand(i + k + 71) < 0.18);
        money.push({
          id: `m_e${i}_${k}`,
          partyId: party.id,
          amount: Math.round(value),
          direction: 'in',
          at: unpaid ? at : settledAt,
          dueAt: at,
          settledAt: unpaid ? null : settledAt,
          status: unpaid ? 'due' : 'settled',
          label: offering?.name ?? profile.vocabulary.engagement.one,
          method: unpaid ? undefined : METHODS[(i + k) % METHODS.length],
          offeringId: offering?.id ?? null,
        });
      }
    }
  });

  /* ----------------------------------------------------------- expenses -- */
  const monthlyRent = shape.capacityBound ? 18000 : 9000;
  const monthlyWages = staff.length * 14000;

  const fixedCosts: FixedCost[] = [
    { id: 'f0', label: 'Rent', amount: monthlyRent, category: 'rent', dayOfMonth: 5 },
    ...(staff.length
      ? [{ id: 'f1', label: 'Wages', amount: monthlyWages, category: 'wages' as ExpenseCategory, dayOfMonth: 1 }]
      : []),
    { id: 'f2', label: 'Electricity and water', amount: 3200, category: 'utilities', dayOfMonth: 12 },
  ];

  // Three months of the fixed costs actually going out, plus variable spend.
  for (let m = 0; m < 4; m++) {
    const monthRef = new Date(now);
    monthRef.setMonth(monthRef.getMonth() - m, 1);
    monthRef.setHours(10, 0, 0, 0);

    for (const fixed of fixedCosts) {
      const at = new Date(monthRef).setDate(fixed.dayOfMonth ?? 1);
      if (at > now) continue;
      money.push({
        id: `m_f${fixed.id}_${m}`,
        amount: fixed.amount,
        direction: 'out',
        at,
        status: 'settled',
        label: fixed.label,
        category: fixed.category,
        method: 'transfer',
      });
    }
  }

  const variable: { label: string; category: ExpenseCategory }[] = [
    { label: 'Supplies', category: 'stock' },
    { label: 'Repairs', category: 'equipment' },
    { label: 'Advertising', category: 'marketing' },
  ];
  for (let w = 0; w < 13; w++) {
    const pick = variable[w % variable.length];
    money.push({
      id: `m_x${w}`,
      amount: Math.round(1200 + rand(w + 91) * 2600),
      direction: 'out',
      at: now - w * 7 * DAY,
      status: 'settled',
      label: pick.label,
      category: pick.category,
      method: w % 3 === 0 ? 'cash' : 'upi',
    });
  }

  /* ---------------------------------------------------------- templates -- */
  // Only businesses whose customers come on a schedule get templates. A garage
  // has no Tuesday 5:30 batch, and inventing one would put a fiction on the
  // home screen.
  const templates: Template[] =
    shape.engagementFreq === 'high' && parties.length >= 12
      ? [
          {
            id: 't0',
            name: `Morning ${profile.vocabulary.engagement.one.toLowerCase()}`,
            weekdays: [1, 3, 5],
            minuteOfDay: 7 * 60,
            partyIds: parties.slice(0, Math.min(14, parties.length)).map((p) => p.id),
            staffId: staff[0]?.id ?? null,
            offeringId: recurring[0]?.id ?? null,
            durationMin: 60,
            active: true,
          },
          {
            id: 't1',
            name: `Evening ${profile.vocabulary.engagement.one.toLowerCase()}`,
            weekdays: [1, 2, 3, 4, 5],
            minuteOfDay: 17 * 60 + 30,
            partyIds: parties.slice(14, Math.min(32, parties.length)).map((p) => p.id),
            staffId: staff[1]?.id ?? staff[0]?.id ?? null,
            offeringId: recurring[0]?.id ?? null,
            durationMin: 90,
            active: true,
          },
        ]
      : [];

  /* ------------------------------------------------------ template runs -- */
  /*
    Attendance that actually belongs to the timetable above.

    Without this the sample data contradicts itself: it describes a business
    with a fourteen-person morning batch and a Tuesday evening batch, and then
    records every visit as a lone individual arriving at a random minute. Nothing
    grouped, so `sessionRead` correctly reported one head per session and the
    split between "sessions run" and "people present" — the thing that separates
    a class from a walk-in — was invisible in the one data set anyone demos with.

    Three weeks rather than the full history. That is enough for the eight-week
    averages to be honest about the shape of the business without adding a
    thousand records to a sample whose job is to be legible.
  */
  for (const template of templates) {
    for (let back = 21; back >= 0; back--) {
      const day = startOfDay(now - back * DAY);
      if (!template.weekdays.includes(new Date(day).getDay())) continue;

      const at = day + template.minuteOfDay * 60 * 1000;
      if (at > now) continue;

      template.partyIds.forEach((partyId, seat) => {
        // About three quarters turn up, and the rest are recorded absent rather
        // than left out — an unrecorded absence and a session that never ran
        // look identical, which is the thing the attendance grid exists to stop.
        const roll = rand(back * 97 + seat * 13 + template.id.length);
        if (roll > 0.92) return;

        engagements.push({
          id: `t_${template.id}_${back}_${seat}`,
          partyId,
          at,
          staffId: template.staffId ?? null,
          offeringId: template.offeringId ?? null,
          templateId: template.id,
          noShow: roll > 0.78 || undefined,
          source: 'seed',
        });
      });
    }
  }

  /* ----------------------------------------------------------- closures -- */
  const closures: Closure[] = [
    {
      id: 'cl0',
      date: startOfDay(now - 26 * DAY),
      label: 'Public holiday',
      annual: true,
    },
  ];

  /* -------------------------------------------------------- obligations -- */
  const obligations: Obligation[] = [
    {
      id: 'ob0',
      kind: 'custom',
      dueAt: startOfDay(now) + 6 * DAY + 10 * 60 * 60 * 1000,
      label: 'Rent due',
      done: false,
      repeatDays: 30,
      leadDays: 5,
      amount: monthlyRent,
    },
    {
      id: 'ob1',
      kind: 'custom',
      dueAt: startOfDay(now) + 21 * DAY,
      label: 'Trade licence renewal',
      done: false,
      repeatDays: 365,
      leadDays: 30,
    },
  ];

  /* ------------------------------------------------------------- memory -- */
  const declaredCount = scale.parties ?? partyCount;
  const facts: MemoryFact[] = [
    {
      id: 'fact-declared-parties',
      key: 'party-count',
      origin: 'declared',
      value: `about ${declaredCount}`,
      numeric: declaredCount,
      at: profile.createdAt,
      confidence: 0.9,
      note: 'From what you told us at setup',
    },
    {
      id: 'fact-observed-parties',
      key: 'party-count',
      origin: 'observed',
      value: String(partyCount),
      numeric: partyCount,
      at: now,
      confidence: 1,
    },
  ];

  const events: EventNote[] = [
    {
      id: 'ev0',
      at: now - 120 * DAY,
      label: `Started using ${profile.name}'s records`,
      origin: 'detected',
      basis: 'first record',
    },
  ];

  return {
    ...EMPTY_DATA,
    parties,
    commitments,
    engagements: engagements.sort((a, b) => b.at - a.at),
    money: money.sort((a, b) => b.at - a.at),
    offerings,
    staff,
    templates,
    closures,
    fixedCosts,
    obligations,
    facts,
    events,
  };
}
