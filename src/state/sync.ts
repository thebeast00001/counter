import type { BusinessData, BusinessProfile } from '@/domain/model';
import { EMPTY_DATA, hydrateData } from '@/domain/model';
import { clerkSubject } from '@/state/clerkBridge';
import { getClient } from '@/state/supabase';

/**
 * Pushing the local record set up, and pulling a newer one down.
 *
 * The rules this follows, in order of how much trouble breaking them causes:
 *
 *  1. **Local wins on conflict.** The device holds what the owner actually did,
 *     often while standing in front of a customer with no signal. A server that
 *     overwrites that is worse than no server.
 *  2. **Everything is upserted on `(business_id, client_id)`.** The device
 *     generated those ids, so a push that runs twice — a retry, a flaky
 *     connection, a crash mid-upload — cannot duplicate a single row.
 *  3. **Nothing is deleted remotely.** Records are archived, never removed, so
 *     a sync bug can lose a phone's copy but never the business's history.
 *
 * This is a backup and a second device, not a live database. Nothing on any
 * screen waits for it.
 */

/** Local field names to column names, per table. Kept explicit rather than derived. */
type Mapping = {
  table: string;
  /** Which collection on BusinessData this table holds. */
  collection: keyof BusinessData;
  toRow: (item: Record<string, unknown>, businessId: string) => Record<string, unknown>;
  fromRow: (row: Record<string, unknown>) => Record<string, unknown>;
};

const iso = (ms: unknown) => (typeof ms === 'number' ? new Date(ms).toISOString() : null);
const ms = (text: unknown) => (typeof text === 'string' ? Date.parse(text) : undefined);

const MAPPINGS: Mapping[] = [
  {
    table: 'parties',
    collection: 'parties',
    toRow: (p, businessId) => ({
      business_id: businessId,
      client_id: p.id,
      name: p.name,
      phone: p.phone ?? null,
      joined_at: iso(p.joinedAt),
      staff_client_id: p.staffId ?? null,
      detail: p.detail ?? null,
      notes: p.notes ?? null,
      tags: p.tags ?? null,
      referred_by: p.referredBy ?? null,
      group_id: p.groupId ?? null,
      contactable: p.contactable !== false,
      archived_at: iso(p.archivedAt),
    }),
    fromRow: (r) => ({
      id: r.client_id,
      name: r.name,
      phone: r.phone ?? undefined,
      joinedAt: ms(r.joined_at),
      staffId: r.staff_client_id ?? null,
      detail: r.detail ?? undefined,
      notes: r.notes ?? undefined,
      tags: r.tags ?? undefined,
      referredBy: r.referred_by ?? null,
      groupId: r.group_id ?? null,
      contactable: r.contactable,
      archivedAt: r.archived_at ? ms(r.archived_at) : null,
    }),
  },
  {
    table: 'engagements',
    collection: 'engagements',
    toRow: (e, businessId) => ({
      business_id: businessId,
      client_id: e.id,
      party_client_id: e.partyId,
      at: iso(e.at),
      staff_client_id: e.staffId ?? null,
      offering_client_id: e.offeringId ?? null,
      resource_client_id: e.resourceId ?? null,
      template_client_id: e.templateId ?? null,
      value: e.value ?? null,
      no_show: e.noShow === true,
      note: e.note ?? null,
      source: e.source ?? null,
    }),
    fromRow: (r) => ({
      id: r.client_id,
      partyId: r.party_client_id,
      at: ms(r.at),
      staffId: r.staff_client_id ?? null,
      offeringId: r.offering_client_id ?? null,
      resourceId: r.resource_client_id ?? null,
      templateId: r.template_client_id ?? null,
      value: r.value ?? undefined,
      noShow: r.no_show || undefined,
      note: r.note ?? undefined,
      source: r.source ?? undefined,
    }),
  },
  {
    table: 'money',
    collection: 'money',
    toRow: (m, businessId) => ({
      business_id: businessId,
      client_id: m.id,
      party_client_id: m.partyId ?? null,
      offering_client_id: m.offeringId ?? null,
      amount: m.amount,
      direction: m.direction,
      status: m.status,
      at: iso(m.at),
      due_at: iso(m.dueAt),
      settled_at: iso(m.settledAt),
      label: m.label ?? '',
      method: m.method ?? null,
      category: m.category ?? null,
      part_of: m.partOf ?? null,
      refund_of: m.refundOf ?? null,
    }),
    fromRow: (r) => ({
      id: r.client_id,
      partyId: r.party_client_id ?? null,
      offeringId: r.offering_client_id ?? null,
      amount: Number(r.amount),
      direction: r.direction,
      status: r.status,
      at: ms(r.at),
      dueAt: r.due_at ? ms(r.due_at) : null,
      settledAt: r.settled_at ? ms(r.settled_at) : null,
      label: r.label,
      method: r.method ?? undefined,
      category: r.category ?? undefined,
      partOf: r.part_of ?? null,
      refundOf: r.refund_of ?? null,
    }),
  },
  {
    table: 'commitments',
    collection: 'commitments',
    toRow: (c, businessId) => ({
      business_id: businessId,
      client_id: c.id,
      party_client_id: c.partyId,
      offering_client_id: c.offeringId ?? null,
      start_at: iso(c.startAt),
      end_at: iso(c.endAt),
      price: c.price,
      status: c.status,
      renewed_from: c.renewedFrom ?? null,
      auto_renew: c.autoRenew === true,
      cancelled_at: iso(c.cancelledAt),
      cancel_reason: c.cancelReason ?? null,
    }),
    fromRow: (r) => ({
      id: r.client_id,
      partyId: r.party_client_id,
      offeringId: r.offering_client_id ?? '',
      startAt: ms(r.start_at),
      endAt: ms(r.end_at),
      price: Number(r.price),
      status: r.status,
      renewedFrom: r.renewed_from ?? undefined,
      autoRenew: r.auto_renew,
      cancelledAt: r.cancelled_at ? ms(r.cancelled_at) : null,
      cancelReason: r.cancel_reason ?? undefined,
    }),
  },
  {
    table: 'offerings',
    collection: 'offerings',
    toRow: (o, businessId) => ({
      business_id: businessId,
      client_id: o.id,
      name: o.name,
      price: o.price,
      cost: o.cost ?? null,
      duration_days: o.durationDays ?? null,
      capacity: o.capacity ?? null,
      active: o.active !== false,
    }),
    fromRow: (r) => ({
      id: r.client_id,
      name: r.name,
      price: Number(r.price),
      cost: r.cost ?? undefined,
      durationDays: r.duration_days ?? null,
      capacity: r.capacity ?? null,
      active: r.active,
    }),
  },
  {
    table: 'staff',
    collection: 'staff',
    toRow: (s, businessId) => ({
      business_id: businessId,
      client_id: s.id,
      name: s.name,
      role: s.role ?? '',
      access: s.access ?? 'staff',
      phone: s.phone ?? null,
      active: s.active !== false,
    }),
    fromRow: (r) => ({
      id: r.client_id,
      name: r.name,
      role: r.role,
      access: r.access,
      phone: r.phone ?? undefined,
      active: r.active,
    }),
  },
  {
    table: 'templates',
    collection: 'templates',
    toRow: (t, businessId) => ({
      business_id: businessId,
      client_id: t.id,
      name: t.name,
      weekdays: t.weekdays ?? [],
      minute_of_day: t.minuteOfDay ?? 0,
      party_client_ids: t.partyIds ?? [],
      staff_client_id: t.staffId ?? null,
      resource_client_id: t.resourceId ?? null,
      offering_client_id: t.offeringId ?? null,
      duration_min: t.durationMin ?? null,
      active: t.active !== false,
    }),
    fromRow: (r) => ({
      id: r.client_id,
      name: r.name,
      weekdays: r.weekdays ?? [],
      minuteOfDay: r.minute_of_day,
      partyIds: r.party_client_ids ?? [],
      staffId: r.staff_client_id ?? null,
      resourceId: r.resource_client_id ?? null,
      offeringId: r.offering_client_id ?? null,
      durationMin: r.duration_min ?? undefined,
      active: r.active,
    }),
  },
  {
    table: 'obligations',
    collection: 'obligations',
    toRow: (o, businessId) => ({
      business_id: businessId,
      client_id: o.id,
      kind: o.kind ?? 'custom',
      party_client_id: o.partyId ?? null,
      due_at: iso(o.dueAt),
      label: o.label,
      done: o.done === true,
      done_at: iso(o.doneAt),
      repeat_days: o.repeatDays ?? null,
      lead_days: o.leadDays ?? null,
      amount: o.amount ?? null,
      from_insight: o.fromInsight ?? null,
    }),
    fromRow: (r) => ({
      id: r.client_id,
      kind: r.kind,
      partyId: r.party_client_id ?? null,
      dueAt: ms(r.due_at),
      label: r.label,
      done: r.done,
      doneAt: r.done_at ? ms(r.done_at) : null,
      repeatDays: r.repeat_days ?? null,
      leadDays: r.lead_days ?? undefined,
      amount: r.amount ?? undefined,
      fromInsight: r.from_insight ?? undefined,
    }),
  },
  {
    table: 'facts',
    collection: 'facts',
    toRow: (f, businessId) => ({
      business_id: businessId,
      client_id: f.id,
      key: f.key,
      origin: f.origin,
      value: f.value,
      numeric_value: f.numeric ?? null,
      at: iso(f.at),
      confidence: f.confidence ?? 1,
      note: f.note ?? null,
    }),
    fromRow: (r) => ({
      id: r.client_id,
      key: r.key,
      origin: r.origin,
      value: r.value,
      numeric: r.numeric_value ?? null,
      at: ms(r.at),
      confidence: Number(r.confidence),
      note: r.note ?? undefined,
    }),
  },
  {
    table: 'events',
    collection: 'events',
    toRow: (e, businessId) => ({
      business_id: businessId,
      client_id: e.id,
      at: iso(e.at),
      label: e.label,
      origin: e.origin ?? 'owner',
      basis: e.basis ?? null,
    }),
    fromRow: (r) => ({
      id: r.client_id,
      at: ms(r.at),
      label: r.label,
      origin: r.origin,
      basis: r.basis ?? undefined,
    }),
  },
  {
    table: 'actions',
    collection: 'actions',
    toRow: (a, businessId) => ({
      business_id: businessId,
      client_id: a.id,
      kind: a.kind,
      label: a.label,
      party_client_ids: a.partyIds ?? [],
      insight_id: a.insightId ?? null,
      rule_client_id: a.ruleId ?? null,
      created_at: iso(a.createdAt),
      outcome: a.outcome,
      completed_at: iso(a.completedAt),
      reason: a.reason ?? null,
      worked: a.worked ?? null,
      reviewed_at: iso(a.reviewedAt),
      snoozed_until: iso(a.snoozedUntil),
    }),
    fromRow: (r) => ({
      id: r.client_id,
      kind: r.kind,
      label: r.label,
      partyIds: r.party_client_ids ?? [],
      insightId: r.insight_id ?? null,
      ruleId: r.rule_client_id ?? null,
      createdAt: ms(r.created_at),
      outcome: r.outcome,
      completedAt: r.completed_at ? ms(r.completed_at) : null,
      reason: r.reason ?? undefined,
      worked: r.worked ?? null,
      reviewedAt: r.reviewed_at ? ms(r.reviewed_at) : null,
      snoozedUntil: r.snoozed_until ? ms(r.snoozed_until) : null,
    }),
  },
  {
    table: 'rules',
    collection: 'rules',
    toRow: (r, businessId) => ({
      business_id: businessId,
      client_id: r.id,
      trigger: r.trigger,
      sentence: r.sentence ?? '',
      trust: r.trust,
      enabled: r.enabled !== false,
      fired_count: r.firedCount ?? 0,
      undone_count: r.undoneCount ?? 0,
      last_fired_at: iso(r.lastFiredAt),
      created_at: iso(r.createdAt),
    }),
    fromRow: (r) => ({
      id: r.client_id,
      trigger: r.trigger,
      sentence: r.sentence,
      trust: r.trust,
      enabled: r.enabled,
      firedCount: r.fired_count,
      undoneCount: r.undone_count,
      lastFiredAt: r.last_fired_at ? ms(r.last_fired_at) : null,
      createdAt: ms(r.created_at),
    }),
  },
];

export type SyncResult =
  | { ok: true; pushed: number; pulled: number; at: number }
  | { ok: false; message: string };

/** Ensures a `businesses` row exists for this profile and returns its uuid. */
async function ensureBusiness(profile: BusinessProfile): Promise<string | null> {
  const supabase = await getClient();
  if (!supabase) return null;

  /*
    The owner is the Clerk subject, read from the same token the row-level
    policies check. Supabase has no session of its own to ask any more — see the
    note on `getClient`.
  */
  const ownerId = await clerkSubject();
  if (!ownerId) return null;

  const { data: existing } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', ownerId)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from('businesses')
      .update({
        name: profile.name,
        owner_name: profile.ownerName ?? null,
        archetype: profile.archetype,
        vocabulary: profile.vocabulary,
        shape: profile.shape,
        description: profile.description,
      })
      .eq('id', existing.id);
    return existing.id as string;
  }

  const { data: created, error } = await supabase
    .from('businesses')
    .insert({
      owner_id: ownerId,
      name: profile.name,
      owner_name: profile.ownerName ?? null,
      archetype: profile.archetype,
      vocabulary: profile.vocabulary,
      shape: profile.shape,
      description: profile.description,
    })
    .select('id')
    .single();

  if (error) return null;
  return created.id as string;
}

/**
 * Sends everything up.
 *
 * Chunked because a business with a year of history has thousands of
 * engagements, and a single request carrying all of them is the one most likely
 * to time out on a phone with two bars.
 */
const CHUNK = 400;

/**
 * What was last sent, per table, so the next push only carries what changed.
 *
 * Keyed by table rather than kept as one timestamp: a failure part-way through
 * must not mark the tables it never reached as sent, or those rows would be
 * skipped forever and the backup would be quietly incomplete.
 */
type Watermarks = Record<string, number>;

const WATERMARK_KEY = 'os.sync.watermarks';

async function loadWatermarks(): Promise<Watermarks> {
  const store = persist();
  if (!store) return {};
  try {
    return await store.loadJSON<Watermarks>(WATERMARK_KEY, {});
  } catch {
    return {};
  }
}

/**
 * Storage is reached through a lazy require, like everywhere else that has to
 * stay loadable outside the app.
 */
type PersistModule = typeof import('@/state/persist');

function persist(): PersistModule | null {
  try {
    return require('@/state/persist');
  } catch {
    return null;
  }
}

/**
 * The timestamp a record was last touched, for deciding whether to send it.
 *
 * Records carry no `updatedAt` — they are immutable in practice, written once
 * and occasionally settled or archived. So the newest of the fields that do
 * exist stands in for it. Where none exists the record is always sent, which is
 * wasteful and safe; the reverse would silently drop it.
 */
function touchedAt(item: Record<string, unknown>): number {
  const candidates = [
    item.settledAt,
    item.archivedAt,
    item.cancelledAt,
    item.completedAt,
    item.reviewedAt,
    item.doneAt,
    item.at,
    item.createdAt,
    item.joinedAt,
    item.startAt,
  ];
  let newest = 0;
  for (const value of candidates) {
    if (typeof value === 'number' && value > newest) newest = value;
  }
  return newest;
}

/**
 * Sends everything that has changed since the last successful push.
 *
 * Chunked because a business with a year of history has thousands of
 * engagements, and a single request carrying all of them is the one most likely
 * to time out on a phone with two bars.
 *
 * Incremental because it used to send *everything, every time*. That is fine for
 * the first backup and absurd for the four-hundredth: a business with a hundred
 * thousand visits re-uploaded a hundred thousand rows to communicate that one
 * person turned up. It cost the owner's data allowance, took minutes on a weak
 * connection, and grew without limit.
 *
 * `full` forces the whole set — used when the watermarks cannot be trusted, and
 * offered to the owner as "send everything again" after a failure.
 */
export async function push(
  profile: BusinessProfile,
  data: BusinessData,
  options: { full?: boolean } = {},
): Promise<SyncResult> {
  const supabase = await getClient();
  if (!supabase) return { ok: false, message: 'Not connected to a project yet.' };

  try {
    const businessId = await ensureBusiness(profile);
    if (!businessId) return { ok: false, message: 'Sign in first — there is no account to sync to.' };

    const marks = options.full ? {} : await loadWatermarks();
    const next: Watermarks = { ...marks };
    let pushed = 0;

    for (const mapping of MAPPINGS) {
      const all = (data[mapping.collection] ?? []) as Record<string, unknown>[];
      const since = marks[mapping.table] ?? 0;

      /*
        A second of overlap on purpose. Two records written in the same
        millisecond as the watermark would otherwise straddle it, and the upsert
        makes re-sending one free while missing one is permanent.
      */
      const items = since > 0 ? all.filter((item) => touchedAt(item) >= since - 1000) : all;
      if (items.length === 0) continue;

      let highest = since;
      for (let i = 0; i < items.length; i += CHUNK) {
        const slice = items.slice(i, i + CHUNK);
        const rows = slice.map((item) => mapping.toRow(item, businessId));
        const { error } = await supabase
          .from(mapping.table)
          // The device's own id is the conflict target, so a retry is a no-op
          // rather than a duplicate.
          .upsert(rows, { onConflict: 'business_id,client_id' });
        if (error) return { ok: false, message: `${mapping.table}: ${error.message}` };

        pushed += rows.length;
        for (const item of slice) highest = Math.max(highest, touchedAt(item));
      }

      // Advanced only after the table's rows are actually on the server.
      next[mapping.table] = Math.max(highest, since);
    }

    persist()?.saveJSON(WATERMARK_KEY, next);
    return { ok: true, pushed, pulled: 0, at: Date.now() };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Sync failed' };
  }
}

/**
 * Deletes this account's server copy, permanently.
 *
 * Required by Google Play: any app that creates an account must let a person
 * delete it from inside the app, not only by writing to support. It is also the
 * only honest counterpart to a backup — an owner who can put their customers'
 * names and debts on a server must be able to take them off it.
 *
 * The child rows go through `on delete cascade` from `businesses`, so this is
 * one delete rather than thirteen. That matters for more than tidiness: thirteen
 * separate deletes can fail half-way and leave orphaned personal data behind
 * with nothing pointing at it, which is the worst possible outcome for a
 * function whose entire job is erasure.
 *
 * The phone keeps its own records. Deleting the copy is not deleting the
 * business, and conflating the two would make this button unusable for the
 * person who only wants to stop syncing.
 */
export async function deleteRemote(): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = await getClient();
  if (!supabase) return { ok: false, message: 'Not connected to a project.' };

  const ownerId = await clerkSubject();
  if (!ownerId) return { ok: false, message: 'Sign in first.' };

  const { error } = await supabase.from('businesses').delete().eq('owner_id', ownerId);
  if (error) return { ok: false, message: error.message };

  // Nothing is on the server any more, so nothing has been sent.
  resetWatermarks();
  return { ok: true };
}

/** Forgets what was sent, so the next push carries everything again. */
export function resetWatermarks(): void {
  persist()?.saveJSON(WATERMARK_KEY, {});
}

export async function pull(): Promise<{ profile: BusinessProfile | null; data: BusinessData } | null> {
  const supabase = await getClient();
  if (!supabase) return null;

  try {
    const ownerId = await clerkSubject();
    if (!ownerId) return null;

    const { data: business } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', ownerId)
      .limit(1)
      .maybeSingle();

    if (!business) return null;

    const out: Record<string, unknown[]> = {};
    for (const mapping of MAPPINGS) {
      const { data: rows, error } = await supabase
        .from(mapping.table)
        .select('*')
        .eq('business_id', business.id);
      if (error) continue;
      out[mapping.collection] = (rows ?? []).map((row) =>
        mapping.fromRow(row as Record<string, unknown>),
      );
    }

    const profile: BusinessProfile = {
      id: business.id,
      name: business.name,
      ownerName: business.owner_name ?? undefined,
      archetype: business.archetype,
      vocabulary: business.vocabulary,
      shape: business.shape,
      description: business.description ?? '',
      createdAt: Date.parse(business.created_at),
    };

    return {
      profile,
      // Through the same hydrator the local read uses, so a collection the
      // server has never heard of arrives as an empty array rather than
      // undefined.
      data: hydrateData({ ...EMPTY_DATA, ...out } as Partial<BusinessData>),
    };
  } catch {
    return null;
  }
}
