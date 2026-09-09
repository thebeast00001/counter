/**
 * The universal business model.
 *
 * Eight primitives compose every local business the product supports. A trade
 * is not a type in this file — a gym and a garage are the same eight objects
 * under different names, with different weights on which of them matter.
 *
 * The discipline that keeps this from becoming an ERP: a trade-specific detail
 * (a vehicle, a batch, a table number) is an attribute on one of the eight,
 * never a ninth primitive.
 */

export type PrimitiveKey =
  | 'party'
  | 'commitment'
  | 'engagement'
  | 'money'
  | 'offering'
  | 'person'
  | 'resource'
  | 'obligation';

/** What this business calls each primitive, singular and plural. */
export type Vocabulary = Record<PrimitiveKey, { one: string; many: string }>;

/**
 * The shape of a business, as weights rather than a category.
 *
 * Two gyms — one selling annual memberships, one selling ten-class packs — are
 * opposite businesses wearing the same label. Weights tell them apart; a
 * category never could.
 */
export type BusinessShape = {
  /** 0..1 — how much revenue is promised in advance. Drives expiry surfaces. */
  commitmentWeight: number;
  /** Visits per party per month. High → attendance and lapse detection. */
  engagementFreq: 'low' | 'medium' | 'high';
  /** Money per interaction. High → per-job margin. Low → volume and peaks. */
  engagementValue: 'low' | 'medium' | 'high';
  /** Is throughput limited by a finite resource? */
  capacityBound: boolean;
  /** Do parties belong to a particular staff member? */
  staffAttribution: boolean;
  /**
   * When money changes hands. Anything but 'before' or 'at' makes receivables
   * first-class.
   *
   * `split` is an advance plus a balance — how weddings, tailoring, catering
   * and construction are all paid in this market. It behaves exactly like
   * `after` everywhere that branches on this, because the half that decides
   * behaviour is the balance still owed. It is kept distinct anyway so the
   * profile records what the owner actually said rather than the nearest
   * approximation, and so a screen can name it correctly.
   */
  paymentTiming: 'before' | 'at' | 'after' | 'split';
};

export type ArchetypeKey =
  | 'gym'
  | 'tuition'
  | 'salon'
  | 'restaurant'
  | 'mechanic'
  | 'clinic'
  | 'generic';

export type BusinessProfile = {
  id: string;
  /** The trading name, as the owner says it. */
  name: string;
  ownerName?: string;
  /**
   * A local file URI for the owner's photo, or undefined.
   *
   * A URI rather than the image bytes: the picker already copied the file into
   * the app's own storage, and inlining a base64 photo would put a few hundred
   * kilobytes through the encrypt-and-write path on every unrelated save.
   */
  avatarUri?: string;
  archetype: ArchetypeKey;
  vocabulary: Vocabulary;
  shape: BusinessShape;
  /** What the owner said at onboarding, kept verbatim as declared memory. */
  description: string;
  createdAt: number;
  /**
   * The business's own UPI id, if the owner has set one.
   *
   * Only used to build a `upi://pay` request a customer can settle — the app is
   * never the payee's agent and never touches the money. Absent, collection by
   * UPI is simply not offered.
   */
  vpa?: string;
};

/* ----------------------------------------------------------------- records */

export type Party = {
  id: string;
  name: string;
  phone?: string;
  joinedAt: number;
  /** Only meaningful when shape.staffAttribution is true. */
  staffId?: string | null;
  /** Free-form trade detail — a vehicle, a batch, a preferred stylist. */
  detail?: string;
  /**
   * Their UPI id, where it is known.
   *
   * Recorded for one reason: an incoming payment carries the payer's handle and
   * nothing else, so this is what turns an anonymous credit into a payment from
   * a named customer without anybody typing a name.
   */
  vpa?: string;
  notes?: string;
  /** Owner-defined labels. Segments are computed, these are declared. */
  tags?: string[];
  /** Who brought them in, if anyone. Makes the referral graph derivable. */
  referredBy?: string | null;
  /**
   * Links siblings, couples, company accounts. A group shares a payer but not a
   * history — two children at the same tuition centre attend separately and
   * lapse separately, so they stay two parties.
   */
  groupId?: string | null;
  /**
   * False stops every outbound suggestion for this person. Consent is a property
   * of the relationship, not a setting buried in preferences.
   */
  contactable?: boolean;
  /** Ids absorbed by a merge, kept so the merge can be explained and undone. */
  mergedFrom?: string[];
  archivedAt?: number | null;
};

export type CommitmentStatus = 'active' | 'expired' | 'cancelled';

export type Commitment = {
  id: string;
  partyId: string;
  offeringId: string;
  startAt: number;
  endAt: number;
  price: number;
  status: CommitmentStatus;
  /** Set when a renewal was recorded, so renewal rate is measurable. */
  renewedFrom?: string;
  autoRenew?: boolean;
  cancelledAt?: number | null;
  /** Why it ended, in the owner's words. The only reliable churn reason there is. */
  cancelReason?: string;
};

export type Engagement = {
  id: string;
  partyId: string;
  at: number;
  staffId?: string | null;
  offeringId?: string | null;
  /** Money attached to this interaction, if any. */
  value?: number;
  resourceId?: string | null;
  /**
   * Booked and not attended. Distinct from no record at all: a no-show consumed
   * a slot somebody else could have had, so it costs more than an empty diary.
   */
  noShow?: boolean;
  note?: string;
  /** Set when generated from a recurring template rather than entered by hand. */
  templateId?: string | null;
  /** How it reached the app. Drives the zero-typing-day measurement. */
  source?: RecordSource;
};

/**
 * How a record reached the app.
 *
 * Shared by engagements and money so the zero-typing measurement means the same
 * thing on both. Anything other than `manual` is a record nobody typed, which is
 * the only honest way to score whether this app is saving anyone time.
 */
export type RecordSource = 'manual' | 'template' | 'checkin' | 'import' | 'upi' | 'seed';

export type MoneyDirection = 'in' | 'out';
export type MoneyStatus = 'settled' | 'due';
export type PaymentMethod = 'cash' | 'upi' | 'card' | 'transfer' | 'cheque' | 'other';

/** Expense buckets. Fixed ones feed the break-even line. */
export type ExpenseCategory =
  | 'rent'
  | 'wages'
  | 'stock'
  | 'utilities'
  | 'marketing'
  | 'equipment'
  | 'tax'
  | 'other';

export const FIXED_EXPENSES: ExpenseCategory[] = ['rent', 'wages', 'utilities'];

export type MoneyEntry = {
  id: string;
  partyId?: string | null;
  amount: number;
  direction: MoneyDirection;
  at: number;
  status: MoneyStatus;
  label: string;
  method?: PaymentMethod;
  /** When it was expected. `at - dueAt` is the delay a reliability score is built from. */
  dueAt?: number | null;
  settledAt?: number | null;
  /** Only on direction 'out'. */
  category?: ExpenseCategory;
  /** Set on each slice of an instalment plan, pointing at the original total. */
  partOf?: string | null;
  /** Negative-amount entry reversing another. Refunds never delete history. */
  refundOf?: string | null;
  offeringId?: string | null;
  /** How it reached the app. Same meaning as on an engagement. */
  source?: RecordSource;
  /**
   * The bank's own reference for the transaction — a UPI UTR, or a reference
   * this app generated for a collection it started.
   *
   * Its only job is deduplication. Re-importing the same statement is what an
   * owner does when they are unsure the first import worked, and without this
   * every re-import would double the month's takings.
   */
  ref?: string | null;
};

export type Offering = {
  id: string;
  name: string;
  price: number;
  cost?: number;
  /** Non-null makes this a commitment-creating offering, e.g. a 30-day plan. */
  durationDays?: number | null;
  capacity?: number | null;
  active?: boolean;
};

export type StaffRole = 'owner' | 'manager' | 'staff';

export type Staff = {
  id: string;
  name: string;
  role: string;
  /**
   * Access level, distinct from job title. `staff` never sees money — the most
   * common reason an owner refuses to let anyone else touch the software.
   */
  access?: StaffRole;
  active?: boolean;
  phone?: string;
};

export type Resource = {
  id: string;
  name: string;
  capacity: number;
};

/**
 * A recurring engagement pattern — "Batch A, Mon/Wed/Fri, 17:30".
 *
 * Templates are how a business stops typing. The records they produce are
 * ordinary engagements with `templateId` set, so nothing downstream needs to
 * know templates exist.
 */
export type Template = {
  id: string;
  name: string;
  /** 0=Sunday. */
  weekdays: number[];
  /** Minutes from midnight. */
  minuteOfDay: number;
  partyIds: string[];
  staffId?: string | null;
  resourceId?: string | null;
  offeringId?: string | null;
  durationMin?: number;
  active: boolean;
};

/** A day the business was shut. Suppresses false "quiet day" findings. */
export type Closure = {
  id: string;
  /** Local midnight of the closed day. */
  date: number;
  label: string;
  /** Set when the owner said it repeats every year, e.g. a festival. */
  annual?: boolean;
};

export type WaitlistEntry = {
  id: string;
  partyId: string;
  offeringId?: string | null;
  templateId?: string | null;
  addedAt: number;
  promotedAt?: number | null;
};

/** A cost that recurs whether or not anyone walks in. Feeds break-even. */
export type FixedCost = {
  id: string;
  label: string;
  amount: number;
  category: ExpenseCategory;
  /** Day of month it falls due. */
  dayOfMonth?: number;
};

export type ObligationKind = 'followUp' | 'renewal' | 'collection' | 'serviceDue' | 'custom';

export type Obligation = {
  id: string;
  kind: ObligationKind;
  partyId?: string | null;
  dueAt: number;
  label: string;
  done: boolean;
  /** Set when the obligation came from an insight, so outcomes can be traced. */
  fromInsight?: string;
  doneAt?: number | null;
  /** Recurring obligations regenerate on completion — rent, licences, tax. */
  repeatDays?: number | null;
  /** How long before the due date it should start being mentioned. */
  leadDays?: number;
  amount?: number;
};

/* --------------------------------------------------------------- the meta --
 *
 * Everything below is about the business rather than of it. It is kept in the
 * same store because it is equally the owner's property — the value of the
 * product is that these accumulate, and an owner who cannot export them is
 * renting their own history back.
 */

/**
 * Something the system knows and can defend.
 *
 * `declared` is what the owner said. `observed` is what the records show.
 * Keeping both is the whole point: the gap between them is one of the most
 * useful things the product can show anybody.
 */
export type MemoryFact = {
  id: string;
  /** Stable slug, e.g. `party-count`, `busiest-day`, `typical-fee`. */
  key: string;
  origin: 'declared' | 'observed' | 'corrected';
  /** Rendered value, kept as text so a fact can be about anything. */
  value: string;
  numeric?: number | null;
  at: number;
  /** 0..1, decayed by age so stale assumptions stop being asserted. */
  confidence: number;
  /** Free text the owner supplied when correcting. */
  note?: string;
};

/** A dated thing that happened, used to annotate charts and explain movements. */
export type EventNote = {
  id: string;
  at: number;
  label: string;
  origin: 'owner' | 'detected';
  /** Detected events carry the metric they were inferred from. */
  basis?: string;
};

export type ActionKind = 'contact' | 'collect' | 'review' | 'record' | 'automation';
export type ActionOutcome = 'pending' | 'done' | 'skipped' | 'failed';

/**
 * One thing the system asked for and what became of it.
 *
 * This is the trust ledger. Without it the app is guessing forever; with it,
 * every suggestion carries a track record and the automation ladder has
 * something to graduate on.
 */
export type ActionRecord = {
  id: string;
  kind: ActionKind;
  label: string;
  partyIds: string[];
  /** The insight that raised it, when it was not raised by hand. */
  insightId?: string | null;
  ruleId?: string | null;
  createdAt: number;
  outcome: ActionOutcome;
  completedAt?: number | null;
  /** Why it was skipped. Feeds family muting and rule health. */
  reason?: string;
  /**
   * Measured afterwards: did it work? Filled in by the outcome sweep, not at the
   * time of acting, because the answer is not knowable yet.
   */
  worked?: boolean | null;
  reviewedAt?: number | null;
  snoozedUntil?: number | null;
};

export type RuleTrust = 'off' | 'watch' | 'suggest' | 'draft' | 'auto';

/** An automation, phrased so it can be read in one sentence. */
export type Rule = {
  id: string;
  /** "When someone has not been in for 21 days, suggest a check-in." */
  sentence: string;
  trigger: string;
  trust: RuleTrust;
  createdAt: number;
  firedCount: number;
  undoneCount: number;
  lastFiredAt?: number | null;
  enabled: boolean;
};

/** A prediction the app made, kept so it can be scored against reality. */
export type Forecast = {
  id: string;
  metric: string;
  /** Local midnight of the day being predicted. */
  forDay: number;
  predicted: number;
  actual?: number | null;
  madeAt: number;
};

/** Everything the business has recorded. One shape for every trade. */
export type BusinessData = {
  parties: Party[];
  commitments: Commitment[];
  engagements: Engagement[];
  money: MoneyEntry[];
  offerings: Offering[];
  staff: Staff[];
  resources: Resource[];
  obligations: Obligation[];

  templates: Template[];
  closures: Closure[];
  waitlist: WaitlistEntry[];
  fixedCosts: FixedCost[];

  facts: MemoryFact[];
  events: EventNote[];
  actions: ActionRecord[];
  rules: Rule[];
  forecasts: Forecast[];
};

export const EMPTY_DATA: BusinessData = {
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

/**
 * Fills in collections a stored payload predates.
 *
 * Data written before a field existed is missing it, and `data.actions.map` on
 * `undefined` is a white screen on launch with no way back. Every read goes
 * through here so adding a collection can never strand an existing install.
 */
export function hydrateData(raw: Partial<BusinessData> | null | undefined): BusinessData {
  if (!raw) return EMPTY_DATA;
  const out = { ...EMPTY_DATA };
  for (const key of Object.keys(EMPTY_DATA) as (keyof BusinessData)[]) {
    const value = raw[key];
    if (Array.isArray(value)) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}
