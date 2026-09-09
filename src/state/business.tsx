import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { buildIndex } from '@/domain/analytics';
import { hydrateProfile } from '@/domain/compile';
import { defaultRules } from '@/domain/automation';
import { makeForecast, mergeParties, scoreForecasts } from '@/domain/intel';
import { detectEvents, refreshObserved } from '@/domain/memory';
import type {
  ActionRecord,
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
  PrimitiveKey,
  RuleTrust,
  Staff,
  Template,
} from '@/domain/model';
import { EMPTY_DATA, hydrateData } from '@/domain/model';
import { money } from '@/domain/metrics';
import { formatDateShort } from '@/lib/time';
import { notifyActivity } from '@/state/liveActivity';
import { KEYS, loadJSON, removeKeys, saveJSON } from '@/state/persist';

/**
 * The business store.
 *
 * One store for every trade, because there is one model for every trade. Nothing
 * here branches on archetype — screens ask the profile for a word and the shape
 * for a weight, and that is the only way trade-specific behaviour ever enters.
 *
 * Every mutation is a pure function of the previous state to the next, applied
 * through `commit`. Announcements, haptics and anything else observable happen
 * after the commit, never inside an updater: React is free to run an updater
 * twice, and a payment announced twice is a support call.
 */
type BusinessValue = {
  profile: BusinessProfile | null;
  data: BusinessData;
  hydrated: boolean;

  /** Completes onboarding. Replaces any previous business. */
  install: (profile: BusinessProfile, data: BusinessData) => void;
  updateProfile: (patch: Partial<BusinessProfile>) => void;

  /* records */
  addParty: (party: Omit<Party, 'id' | 'joinedAt'> & { joinedAt?: number }) => Party;
  updateParty: (id: string, patch: Partial<Party>) => void;
  archiveParty: (id: string) => void;
  merge: (keeperId: string, loserId: string) => void;

  /**
   * Creating mutations return what they created.
   *
   * Not a convenience — it is what makes undo possible. Four call sites shipped
   * with `offerUndo(msg, () => {})` because the caller had recorded something and
   * had no id to take it back with, so the bar appeared, the button did nothing,
   * and the record stayed. An undo that silently fails is worse than no undo.
   */
  addEngagement: (engagement: Omit<Engagement, 'id'>) => Engagement;
  addEngagements: (engagements: Omit<Engagement, 'id'>[]) => Engagement[];
  removeEngagement: (id: string) => void;
  removeEngagements: (ids: string[]) => void;

  addMoney: (entry: Omit<MoneyEntry, 'id'>) => MoneyEntry;
  /**
   * Deletes outright, which almost nothing in this app does.
   *
   * Reserved for undoing a batch that was never meant to exist — an import the
   * owner immediately took back. A payment that genuinely happened and was later
   * reversed is a refund, which `refund` records as its own entry, because the
   * history of a business should not be editable into a shape it never had.
   */
  removeMoney: (ids: string[]) => void;
  settleMoney: (id: string, method?: MoneyEntry['method']) => void;
  unsettleMoney: (id: string) => void;
  addExpense: (input: { amount: number; label: string; category: ExpenseCategory; at?: number }) => MoneyEntry;
  refund: (id: string, amount?: number) => void;
  splitIntoInstalments: (id: string, parts: number, everyDays: number) => void;

  addCommitment: (commitment: Omit<Commitment, 'id'>) => Commitment;
  renewCommitment: (id: string) => void;
  cancelCommitment: (id: string, reason?: string) => void;

  /**
   * Everything as it stands, and a way back to it.
   *
   * For operations too tangled to reverse field by field — a merge folds two
   * histories together and cannot be unpicked afterwards. Snapshot before,
   * restore on undo.
   */
  snapshot: () => BusinessData;

  addOffering: (offering: Omit<Offering, 'id'>) => void;
  updateOffering: (id: string, patch: Partial<Offering>) => void;

  addStaff: (staff: Omit<Staff, 'id'>) => void;
  updateStaff: (id: string, patch: Partial<Staff>) => void;

  addObligation: (obligation: Omit<Obligation, 'id' | 'done'>) => Obligation;
  completeObligation: (id: string) => void;
  /** Reverses a completion, including any recurrence it spawned. */
  reopenObligation: (id: string) => void;

  addTemplate: (template: Omit<Template, 'id'>) => Template;
  updateTemplate: (id: string, patch: Partial<Template>) => void;
  removeTemplate: (id: string) => void;
  runTemplate: (id: string, presentPartyIds: string[], at?: number) => Engagement[];
  removeStaff: (id: string) => void;

  addClosure: (closure: Omit<Closure, 'id'>) => void;
  removeClosure: (id: string) => void;

  addFixedCost: (cost: Omit<FixedCost, 'id'>) => void;
  removeFixedCost: (id: string) => void;

  /* the action layer */
  raiseAction: (input: Omit<ActionRecord, 'id' | 'createdAt' | 'outcome'>) => ActionRecord;
  completeAction: (id: string, note?: string) => void;
  skipAction: (id: string, reason: string) => void;
  snoozeAction: (id: string, untilDays: number) => void;
  logContact: (partyIds: string[], label: string, actionId?: string) => void;

  /* automation */
  setRuleTrust: (id: string, trust: RuleTrust) => void;
  toggleRule: (id: string, enabled: boolean) => void;

  /* memory */
  correctFact: (key: string, value: string, numeric: number | null, note?: string) => void;
  addEvent: (event: Omit<EventNote, 'id' | 'origin'>) => void;
  removeEvent: (id: string) => void;

  /** The business's own word for a primitive. */
  term: (key: PrimitiveKey, plural?: boolean) => string;
  /** Replaces everything. Used by import and by undo of a destructive change. */
  replaceAll: (data: BusinessData) => void;
  reset: () => void;
};

const BusinessContext = createContext<BusinessValue | null>(null);

const DAY = 24 * 60 * 60 * 1000;

let counter = 0;
const id = (prefix: string) => {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
};

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [data, setData] = useState<BusinessData>(EMPTY_DATA);
  const [hydrated, setHydrated] = useState(false);

  // Kept in a ref so callbacks can read the current records without every one of
  // them re-creating on each keystroke, which would re-render the whole tree.
  const latest = useRef<BusinessData>(EMPTY_DATA);
  latest.current = data;

  useEffect(() => {
    let alive = true;
    Promise.all([
      loadJSON<BusinessProfile | null>(KEYS.businessProfile, null),
      loadJSON<Partial<BusinessData> | null>(KEYS.businessData, null),
    ])
      .then(([p, d]) => {
        if (!alive) return;
        // Written back only when it actually changed, so a healthy profile
        // costs no startup write.
        const fixed = hydrateProfile(p);
        if (fixed !== p) saveJSON(KEYS.businessProfile, fixed);
        setProfile(fixed);
        setData(hydrateData(d));
        setHydrated(true);
      })
      .catch(() => {
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Every mutation goes through here, so nothing can change without persisting. */
  const commit = useCallback((next: BusinessData) => {
    latest.current = next;
    setData(next);
    saveJSON(KEYS.businessData, next);
  }, []);

  /** Applies a pure transform to the current records. */
  const mutate = useCallback(
    (fn: (prev: BusinessData) => BusinessData) => {
      commit(fn(latest.current));
    },
    [commit],
  );

  /* ----------------------------------------------------------- the sweep -- */

  /**
   * Housekeeping that would be a cron job in a server product.
   *
   * Runs once after hydration. Everything in it is idempotent, because on a
   * phone the only guarantee about when this runs is "sometime after the app was
   * opened", which might be twice in a minute or once in a fortnight.
   */
  useEffect(() => {
    if (!hydrated || !profile) return;
    const now = Date.now();
    const prev = latest.current;

    let next = prev;

    // 1. Recompute what the records say about the business.
    next = { ...next, facts: refreshObserved(profile, next, now) };

    // 2. Score yesterday's prediction, then make today's.
    const scored = scoreForecasts(next, now);
    const fresh = makeForecast({ ...next, forecasts: scored }, now);
    next = { ...next, forecasts: fresh ? [...scored, fresh] : scored };

    // 3. Fold in any detected step-changes not already logged.
    const detected = detectEvents(next, now).filter(
      (e) => !next.events.some((x) => Math.abs(x.at - e.at) < 20 * DAY && x.origin === 'detected'),
    );
    if (detected.length) next = { ...next, events: [...next.events, ...detected] };

    // 4. Give a business with no automation its starting rule set.
    if (next.rules.length === 0) next = { ...next, rules: defaultRules(profile, now) };

    // 5. Roll over recurring obligations that have been completed.
    next = {
      ...next,
      obligations: next.obligations.flatMap((o) => {
        if (!o.done || !o.repeatDays) return [o];
        const already = next.obligations.some(
          (x) => x.label === o.label && !x.done && x.dueAt > o.dueAt,
        );
        if (already) return [o];
        return [o, { ...o, id: id('ob'), done: false, doneAt: null, dueAt: o.dueAt + o.repeatDays * DAY }];
      }),
    };

    if (next !== prev) commit(next);
    // Deliberately keyed on hydration alone: this is a once-per-launch sweep, and
    // depending on `data` would make it a loop that rewrites storage forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, profile]);

  /* ------------------------------------------------------------ lifecycle -- */

  const install = useCallback<BusinessValue['install']>(
    (nextProfile, nextData) => {
      const withRules = nextData.rules.length
        ? nextData
        : { ...nextData, rules: defaultRules(nextProfile) };
      setProfile(nextProfile);
      latest.current = withRules;
      setData(withRules);
      saveJSON(KEYS.businessProfile, nextProfile);
      saveJSON(KEYS.businessData, withRules);
    },
    [],
  );

  const updateProfile = useCallback<BusinessValue['updateProfile']>((patch) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      saveJSON(KEYS.businessProfile, next);
      return next;
    });
  }, []);

  const replaceAll = useCallback<BusinessValue['replaceAll']>((next) => commit(next), [commit]);

  const reset = useCallback(() => {
    setProfile(null);
    latest.current = EMPTY_DATA;
    setData(EMPTY_DATA);
    removeKeys([KEYS.businessProfile, KEYS.businessData]);
  }, []);

  /* -------------------------------------------------------------- parties -- */

  const addParty = useCallback<BusinessValue['addParty']>(
    (input) => {
      const party: Party = {
        contactable: true,
        ...input,
        id: id('p'),
        joinedAt: input.joinedAt ?? Date.now(),
      };
      mutate((prev) => ({ ...prev, parties: [party, ...prev.parties] }));
      return party;
    },
    [mutate],
  );

  const updateParty = useCallback<BusinessValue['updateParty']>(
    (partyId, patch) => {
      mutate((prev) => ({
        ...prev,
        parties: prev.parties.map((p) => (p.id === partyId ? { ...p, ...patch } : p)),
      }));
    },
    [mutate],
  );

  // Archive rather than delete: the history stays valid, cohort maths keeps
  // working, and an accidental removal is one tap to undo instead of unrecoverable.
  const archiveParty = useCallback<BusinessValue['archiveParty']>(
    (partyId) => updateParty(partyId, { archivedAt: Date.now() }),
    [updateParty],
  );

  const merge = useCallback<BusinessValue['merge']>(
    (keeperId, loserId) => {
      mutate((prev) => mergeParties(prev, keeperId, loserId));
    },
    [mutate],
  );

  /* ---------------------------------------------------------- engagements -- */

  const addEngagement = useCallback<BusinessValue['addEngagement']>(
    (input) => {
      const made: Engagement = { source: 'manual', ...input, id: id('e') };
      mutate((prev) => ({ ...prev, engagements: [made, ...prev.engagements] }));
      return made;
    },
    [mutate],
  );

  const addEngagements = useCallback<BusinessValue['addEngagements']>(
    (inputs) => {
      if (inputs.length === 0) return [];
      const made = inputs.map((input) => ({ source: 'manual' as const, ...input, id: id('e') }));
      mutate((prev) => ({ ...prev, engagements: [...made, ...prev.engagements] }));
      return made;
    },
    [mutate],
  );

  const removeEngagement = useCallback<BusinessValue['removeEngagement']>(
    (engagementId) => {
      mutate((prev) => ({
        ...prev,
        engagements: prev.engagements.filter((e) => e.id !== engagementId),
      }));
    },
    [mutate],
  );

  const removeEngagements = useCallback<BusinessValue['removeEngagements']>(
    (ids) => {
      if (ids.length === 0) return;
      const kill = new Set(ids);
      mutate((prev) => ({
        ...prev,
        engagements: prev.engagements.filter((e) => !kill.has(e.id)),
      }));
    },
    [mutate],
  );

  const snapshot = useCallback<BusinessValue['snapshot']>(() => latest.current, []);

  /* ---------------------------------------------------------------- money -- */

  const addMoney = useCallback<BusinessValue['addMoney']>(
    (input) => {
      const entry: MoneyEntry = { ...input, id: id('m') };
      mutate((prev) => ({ ...prev, money: [entry, ...prev.money] }));
      return entry;
    },
    [mutate],
  );

  const removeMoney = useCallback<BusinessValue['removeMoney']>(
    (ids) => {
      if (ids.length === 0) return;
      const kill = new Set(ids);
      mutate((prev) => ({ ...prev, money: prev.money.filter((m) => !kill.has(m.id)) }));
    },
    [mutate],
  );

  const settleMoney = useCallback<BusinessValue['settleMoney']>(
    (entryId, method) => {
      const prev = latest.current;
      const entry = prev.money.find((m) => m.id === entryId);
      if (!entry || entry.status === 'settled') return;

      const now = Date.now();
      const next: BusinessData = {
        ...prev,
        money: prev.money.map((m) =>
          m.id === entryId
            ? { ...m, status: 'settled' as const, settledAt: now, at: now, method: method ?? m.method }
            : m,
        ),
      };
      commit(next);

      // Raised outside the updater: a state updater must stay pure, and React is
      // free to run it twice — which would announce the same payment twice.
      const remaining = next.money.filter((m) => m.direction === 'in' && m.status === 'due').length;
      notifyActivity({
        icon: 'check',
        title: `${money(entry.amount)} received`,
        subtitle: remaining === 0 ? 'Nothing outstanding' : `${remaining} still unpaid`,
        tone: 'success',
      });
    },
    [commit],
  );

  const unsettleMoney = useCallback<BusinessValue['unsettleMoney']>(
    (entryId) => {
      mutate((prev) => ({
        ...prev,
        money: prev.money.map((m) =>
          m.id === entryId
            ? { ...m, status: 'due' as const, settledAt: null, at: m.dueAt ?? m.at }
            : m,
        ),
      }));
    },
    [mutate],
  );

  const addExpense = useCallback<BusinessValue['addExpense']>(
    ({ amount, label, category, at }) => {
      const now = at ?? Date.now();
      const entry: MoneyEntry = {
        id: id('m'),
        amount,
        direction: 'out',
        at: now,
        settledAt: now,
        status: 'settled',
        label,
        category,
      };
      mutate((prev) => ({ ...prev, money: [entry, ...prev.money] }));
      return entry;
    },
    [mutate],
  );

  // A refund is a negative entry pointing at the original, never an edit of it.
  // Editing history is how a ledger stops being one.
  const refund = useCallback<BusinessValue['refund']>(
    (entryId, amount) => {
      const prev = latest.current;
      const entry = prev.money.find((m) => m.id === entryId);
      if (!entry) return;
      const value = amount ?? entry.amount;

      commit({
        ...prev,
        money: [
          {
            id: id('m'),
            partyId: entry.partyId,
            amount: value,
            direction: 'out',
            at: Date.now(),
            settledAt: Date.now(),
            status: 'settled',
            label: `Refund · ${entry.label}`,
            refundOf: entryId,
          },
          ...prev.money,
        ],
      });
    },
    [commit],
  );

  const splitIntoInstalments = useCallback<BusinessValue['splitIntoInstalments']>(
    (entryId, parts, everyDays) => {
      const prev = latest.current;
      const entry = prev.money.find((m) => m.id === entryId);
      if (!entry || parts < 2) return;

      const base = Math.floor(entry.amount / parts);
      const start = entry.dueAt ?? entry.at;
      const slices: MoneyEntry[] = Array.from({ length: parts }, (_, i) => ({
        ...entry,
        id: id('m'),
        // The last slice carries the rounding, so the parts always sum exactly.
        amount: i === parts - 1 ? entry.amount - base * (parts - 1) : base,
        at: start + i * everyDays * DAY,
        dueAt: start + i * everyDays * DAY,
        settledAt: null,
        status: 'due',
        label: `${entry.label} · ${i + 1} of ${parts}`,
        partOf: entryId,
      }));

      commit({
        ...prev,
        money: [...slices, ...prev.money.filter((m) => m.id !== entryId)],
      });
    },
    [commit],
  );

  /* ---------------------------------------------------------- commitments -- */

  const addCommitment = useCallback<BusinessValue['addCommitment']>(
    (input) => {
      const made: Commitment = { ...input, id: id('c') };
      mutate((prev) => ({ ...prev, commitments: [made, ...prev.commitments] }));
      return made;
    },
    [mutate],
  );

  const renewCommitment = useCallback<BusinessValue['renewCommitment']>(
    (commitmentId) => {
      const prev = latest.current;
      const old = prev.commitments.find((c) => c.id === commitmentId);
      if (!old) return;

      const offering = prev.offerings.find((o) => o.id === old.offeringId);
      const days = offering?.durationDays ?? Math.round((old.endAt - old.startAt) / DAY) ?? 30;
      // Renewals run from the old end date, not from today — otherwise anyone who
      // renews a day early quietly loses a day, every single time.
      const startAt = Math.max(old.endAt, Date.now());

      commit({
        ...prev,
        commitments: [
          {
            id: id('c'),
            partyId: old.partyId,
            offeringId: old.offeringId,
            startAt,
            endAt: startAt + days * DAY,
            price: offering?.price ?? old.price,
            status: 'active',
            renewedFrom: old.id,
          },
          ...prev.commitments.map((c) =>
            c.id === commitmentId ? { ...c, status: 'expired' as const } : c,
          ),
        ],
        money: [
          {
            id: id('m'),
            partyId: old.partyId,
            amount: offering?.price ?? old.price,
            direction: 'in' as const,
            at: Date.now(),
            dueAt: Date.now(),
            settledAt: null,
            status: 'due' as const,
            label: offering?.name ?? 'Renewal',
            offeringId: old.offeringId,
          },
          ...prev.money,
        ],
      });

      notifyActivity({
        icon: 'check',
        title: 'Renewed',
        subtitle: `Runs to ${formatDateShort(startAt + days * DAY)}`,
        tone: 'success',
      });
    },
    [commit],
  );

  const cancelCommitment = useCallback<BusinessValue['cancelCommitment']>(
    (commitmentId, reason) => {
      mutate((prev) => ({
        ...prev,
        commitments: prev.commitments.map((c) =>
          c.id === commitmentId
            ? { ...c, status: 'cancelled' as const, cancelledAt: Date.now(), cancelReason: reason }
            : c,
        ),
      }));
    },
    [mutate],
  );

  /* ------------------------------------------------------ offerings/staff -- */

  const addOffering = useCallback<BusinessValue['addOffering']>(
    (input) => mutate((prev) => ({ ...prev, offerings: [...prev.offerings, { ...input, id: id('o') }] })),
    [mutate],
  );

  const updateOffering = useCallback<BusinessValue['updateOffering']>(
    (offeringId, patch) =>
      mutate((prev) => ({
        ...prev,
        offerings: prev.offerings.map((o) => (o.id === offeringId ? { ...o, ...patch } : o)),
      })),
    [mutate],
  );

  const addStaff = useCallback<BusinessValue['addStaff']>(
    (input) =>
      mutate((prev) => ({
        ...prev,
        staff: [...prev.staff, { active: true, access: 'staff', ...input, id: id('s') }],
      })),
    [mutate],
  );

  const updateStaff = useCallback<BusinessValue['updateStaff']>(
    (staffId, patch) =>
      mutate((prev) => ({
        ...prev,
        staff: prev.staff.map((s) => (s.id === staffId ? { ...s, ...patch } : s)),
      })),
    [mutate],
  );

  /* ---------------------------------------------------------- obligations -- */

  const addObligation = useCallback<BusinessValue['addObligation']>(
    (input) => {
      const made: Obligation = { ...input, id: id('ob'), done: false };
      mutate((prev) => ({ ...prev, obligations: [made, ...prev.obligations] }));
      return made;
    },
    [mutate],
  );

  const completeObligation = useCallback<BusinessValue['completeObligation']>(
    (obligationId) => {
      const prev = latest.current;
      const done = prev.obligations.find((o) => o.id === obligationId);
      if (!done || done.done) return;

      const rolled: Obligation[] = done.repeatDays
        ? [
            {
              ...done,
              id: id('ob'),
              done: false,
              doneAt: null,
              dueAt: done.dueAt + done.repeatDays * DAY,
              // Recorded so reopening can find and remove exactly this instance
              // rather than guessing by label, which would delete the wrong one
              // for anybody with two obligations named "Rent".
              fromInsight: `rollover:${obligationId}`,
            },
          ]
        : [];

      commit({
        ...prev,
        obligations: [
          ...rolled,
          ...prev.obligations.map((o) =>
            o.id === obligationId ? { ...o, done: true, doneAt: Date.now() } : o,
          ),
        ],
      });
    },
    [commit],
  );

  const reopenObligation = useCallback<BusinessValue['reopenObligation']>(
    (obligationId) => {
      mutate((prev) => ({
        ...prev,
        obligations: prev.obligations
          // Drop the recurrence this completion created, or ticking and undoing
          // twice would leave a stack of duplicate future obligations behind.
          .filter((o) => o.fromInsight !== `rollover:${obligationId}`)
          .map((o) => (o.id === obligationId ? { ...o, done: false, doneAt: null } : o)),
      }));
    },
    [mutate],
  );

  /* ------------------------------------------------------------ templates -- */

  const addTemplate = useCallback<BusinessValue['addTemplate']>(
    (input) => {
      const made: Template = { ...input, id: id('t') };
      mutate((prev) => ({ ...prev, templates: [...prev.templates, made] }));
      return made;
    },
    [mutate],
  );

  const updateTemplate = useCallback<BusinessValue['updateTemplate']>(
    (templateId, patch) =>
      mutate((prev) => ({
        ...prev,
        templates: prev.templates.map((t) => (t.id === templateId ? { ...t, ...patch } : t)),
      })),
    [mutate],
  );

  /**
   * Removes the schedule but keeps everything it produced.
   *
   * The engagements it generated stay, `templateId` and all — they record
   * sessions that genuinely happened, and deleting a timetable must not rewrite
   * attendance. The occurrences simply stop being generated from tomorrow.
   */
  const removeTemplate = useCallback<BusinessValue['removeTemplate']>(
    (templateId) =>
      mutate((prev) => ({
        ...prev,
        templates: prev.templates.filter((t) => t.id !== templateId),
      })),
    [mutate],
  );

  /**
   * Takes someone off the team without unpicking their history.
   *
   * Their name stays on every session they ran and every person they looked
   * after; only future assignment stops. Deleting the record outright would make
   * months of attributed work vanish from the books.
   */
  const removeStaff = useCallback<BusinessValue['removeStaff']>(
    (staffId) =>
      mutate((prev) => ({
        ...prev,
        staff: prev.staff.map((s) => (s.id === staffId ? { ...s, active: false } : s)),
        templates: prev.templates.map((t) => (t.staffId === staffId ? { ...t, staffId: null } : t)),
      })),
    [mutate],
  );

  /**
   * Records a whole session at once.
   *
   * Everyone on the template who is not in `presentPartyIds` is written as a
   * no-show rather than simply omitted. An absence that leaves no record is
   * indistinguishable from a session that never happened, and the difference is
   * the entire basis of lapse detection.
   */
  const runTemplate = useCallback<BusinessValue['runTemplate']>(
    (templateId, presentPartyIds, at) => {
      const prev = latest.current;
      const template = prev.templates.find((t) => t.id === templateId);
      if (!template) return [];

      const when = at ?? Date.now();
      const present = new Set(presentPartyIds);
      const made: Engagement[] = template.partyIds.map((partyId) => ({
        id: id('e'),
        partyId,
        at: when,
        staffId: template.staffId ?? null,
        offeringId: template.offeringId ?? null,
        resourceId: template.resourceId ?? null,
        noShow: present.has(partyId) ? undefined : true,
        templateId,
        source: 'template',
      }));

      commit({ ...prev, engagements: [...made, ...prev.engagements] });

      notifyActivity({
        icon: 'check',
        title: `${presentPartyIds.length} recorded`,
        subtitle: `${template.name}${template.partyIds.length - presentPartyIds.length > 0 ? ` · ${template.partyIds.length - presentPartyIds.length} missing` : ''}`,
        tone: 'success',
      });

      return made;
    },
    [commit],
  );

  /* ------------------------------------------------------ closures, costs -- */

  const addClosure = useCallback<BusinessValue['addClosure']>(
    (input) => mutate((prev) => ({ ...prev, closures: [...prev.closures, { ...input, id: id('cl') }] })),
    [mutate],
  );

  const removeClosure = useCallback<BusinessValue['removeClosure']>(
    (closureId) => mutate((prev) => ({ ...prev, closures: prev.closures.filter((c) => c.id !== closureId) })),
    [mutate],
  );

  const addFixedCost = useCallback<BusinessValue['addFixedCost']>(
    (input) => mutate((prev) => ({ ...prev, fixedCosts: [...prev.fixedCosts, { ...input, id: id('f') }] })),
    [mutate],
  );

  const removeFixedCost = useCallback<BusinessValue['removeFixedCost']>(
    (costId) => mutate((prev) => ({ ...prev, fixedCosts: prev.fixedCosts.filter((f) => f.id !== costId) })),
    [mutate],
  );

  /* ----------------------------------------------------------- the action -- */

  const raiseAction = useCallback<BusinessValue['raiseAction']>(
    (input) => {
      const prev = latest.current;
      // Never raise the same suggestion twice while the first is still open.
      const open = prev.actions.find(
        (a) => a.outcome === 'pending' && a.insightId && a.insightId === input.insightId,
      );
      if (open) return open;

      const action: ActionRecord = {
        ...input,
        id: id('a'),
        createdAt: Date.now(),
        outcome: 'pending',
      };
      commit({ ...prev, actions: [action, ...prev.actions] });
      return action;
    },
    [commit],
  );

  const completeAction = useCallback<BusinessValue['completeAction']>(
    (actionId, note) => {
      const prev = latest.current;
      const action = prev.actions.find((a) => a.id === actionId);
      if (!action) return;

      commit({
        ...prev,
        actions: prev.actions.map((a) =>
          a.id === actionId
            ? { ...a, outcome: 'done' as const, completedAt: Date.now(), reason: note }
            : a,
        ),
        rules: prev.rules.map((r) =>
          r.id === action.ruleId
            ? { ...r, firedCount: r.firedCount + 1, lastFiredAt: Date.now() }
            : r,
        ),
      });

      notifyActivity({
        icon: 'check',
        title: 'Done',
        subtitle: action.label,
        tone: 'success',
      });
    },
    [commit],
  );

  const skipAction = useCallback<BusinessValue['skipAction']>(
    (actionId, reason) => {
      const prev = latest.current;
      const action = prev.actions.find((a) => a.id === actionId);
      commit({
        ...prev,
        actions: prev.actions.map((a) =>
          a.id === actionId ? { ...a, outcome: 'skipped' as const, completedAt: Date.now(), reason } : a,
        ),
        // A skip is the signal that grades the rule that raised it. Without this
        // the ladder has nothing to demote on.
        rules: prev.rules.map((r) =>
          r.id === action?.ruleId
            ? { ...r, firedCount: r.firedCount + 1, undoneCount: r.undoneCount + 1 }
            : r,
        ),
      });
    },
    [commit],
  );

  const snoozeAction = useCallback<BusinessValue['snoozeAction']>(
    (actionId, untilDays) => {
      mutate((prev) => ({
        ...prev,
        actions: prev.actions.map((a) =>
          a.id === actionId ? { ...a, snoozedUntil: Date.now() + untilDays * DAY } : a,
        ),
      }));
    },
    [mutate],
  );

  /**
   * Records that people were contacted.
   *
   * Writes an engagement of its own so a check-in shows on the person's timeline.
   * Without it the owner calls eight people, nothing changes on screen, and the
   * app appears not to have noticed — which is how a feature stops being used.
   */
  const logContact = useCallback<BusinessValue['logContact']>(
    (partyIds, label, actionId) => {
      const now = Date.now();
      const prev = latest.current;

      commit({
        ...prev,
        obligations: [
          ...partyIds.map((partyId) => ({
            id: id('ob'),
            kind: 'followUp' as const,
            partyId,
            dueAt: now,
            label,
            done: true,
            doneAt: now,
            fromInsight: actionId,
          })),
          ...prev.obligations,
        ],
      });
    },
    [commit],
  );

  /* ----------------------------------------------------------- automation -- */

  const setRuleTrust = useCallback<BusinessValue['setRuleTrust']>(
    (ruleId, trust) =>
      mutate((prev) => ({
        ...prev,
        rules: prev.rules.map((r) => (r.id === ruleId ? { ...r, trust } : r)),
      })),
    [mutate],
  );

  const toggleRule = useCallback<BusinessValue['toggleRule']>(
    (ruleId, enabled) =>
      mutate((prev) => ({
        ...prev,
        rules: prev.rules.map((r) => (r.id === ruleId ? { ...r, enabled } : r)),
      })),
    [mutate],
  );

  /* --------------------------------------------------------------- memory -- */

  /**
   * The owner's correction, which outranks both what they said at setup and what
   * the records imply. Stored as a new fact rather than an edit, so the history
   * of what was believed when stays intact.
   */
  const correctFact = useCallback<BusinessValue['correctFact']>(
    (key, value, numeric, note) => {
      const fact: MemoryFact = {
        id: id('fact'),
        key,
        origin: 'corrected',
        value,
        numeric,
        at: Date.now(),
        confidence: 1,
        note,
      };
      mutate((prev) => ({ ...prev, facts: [...prev.facts, fact] }));
    },
    [mutate],
  );

  const addEvent = useCallback<BusinessValue['addEvent']>(
    (input) =>
      mutate((prev) => ({
        ...prev,
        events: [...prev.events, { ...input, id: id('ev'), origin: 'owner' as const }],
      })),
    [mutate],
  );

  const removeEvent = useCallback<BusinessValue['removeEvent']>(
    (eventId) => mutate((prev) => ({ ...prev, events: prev.events.filter((e) => e.id !== eventId) })),
    [mutate],
  );

  /* ------------------------------------------------------------------ misc */

  const term = useCallback<BusinessValue['term']>(
    (key, plural = false) => {
      const entry = profile?.vocabulary[key];
      if (!entry) return plural ? 'Records' : 'Record';
      return plural ? entry.many : entry.one;
    },
    [profile],
  );

  const value = useMemo<BusinessValue>(
    () => ({
      profile,
      data,
      hydrated,
      install,
      updateProfile,
      addParty,
      updateParty,
      archiveParty,
      merge,
      addEngagement,
      addEngagements,
      removeEngagement,
      removeEngagements,
      snapshot,
      addMoney,
      removeMoney,
      settleMoney,
      unsettleMoney,
      addExpense,
      refund,
      splitIntoInstalments,
      addCommitment,
      renewCommitment,
      cancelCommitment,
      addOffering,
      updateOffering,
      addStaff,
      updateStaff,
      addObligation,
      completeObligation,
      reopenObligation,
      addTemplate,
      updateTemplate,
      removeTemplate,
      runTemplate,
      removeStaff,
      addClosure,
      removeClosure,
      addFixedCost,
      removeFixedCost,
      raiseAction,
      completeAction,
      skipAction,
      snoozeAction,
      logContact,
      setRuleTrust,
      toggleRule,
      correctFact,
      addEvent,
      removeEvent,
      term,
      replaceAll,
      reset,
    }),
    [
      profile, data, hydrated, install, updateProfile, addParty, updateParty, archiveParty, merge,
      addEngagement, addEngagements, removeEngagement, removeEngagements, snapshot, addMoney,
      removeMoney,
      settleMoney, unsettleMoney, addExpense, refund, splitIntoInstalments, addCommitment,
      renewCommitment, cancelCommitment, addOffering, updateOffering, addStaff, updateStaff,
      addObligation, completeObligation, reopenObligation, addTemplate, updateTemplate,
      removeTemplate, runTemplate, removeStaff,
      addClosure, removeClosure, addFixedCost, removeFixedCost, raiseAction, completeAction,
      skipAction, snoozeAction, logContact, setRuleTrust, toggleRule, correctFact, addEvent,
      removeEvent, term, replaceAll, reset,
    ],
  );

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness(): BusinessValue {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusiness must be used inside <BusinessProvider>');
  return ctx;
}

/** The shared record index, rebuilt only when the records actually change. */
export function useIndex() {
  const { data } = useBusiness();
  return useMemo(() => buildIndex(data), [data]);
}
