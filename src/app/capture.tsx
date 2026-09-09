import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Banknote,
  Check,
  CircleMinus,
  Clock,
  TriangleAlert,
  UserPlus,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Press } from '@/components/Press';
import { Segmented } from '@/components/Segmented';
import { TextField } from '@/components/TextField';
import { startOfDay } from '@/domain/analytics';
import { amountHint, parseAmount, sanitiseAmountInput } from '@/domain/amount';
import { billsAfterwards } from '@/domain/words';
import { money } from '@/domain/metrics';
import type { Engagement, ExpenseCategory, PaymentMethod } from '@/domain/model';
import { usesSchedule } from '@/domain/schedule';
import { describeBatch } from '@/domain/sessions';
import { useMotion } from '@/design/motion';
import { cellWidth, useBreakpoint } from '@/design/responsive';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatTime, relativeDays, useTick } from '@/lib/time';
import { useBarInset } from '@/state/dock';
import { useBusiness, useIndex } from '@/state/business';
import { tapCompleted } from '@/lib/haptics';
import { useUndo } from '@/state/undo';

/**
 * Getting things in.
 *
 * The whole product rests on the records being roughly true, and every extra tap
 * between the owner and a record is a reason for that to stop happening. So:
 * attendance is a grid of names you tap, not a form; a payment is an amount and
 * one button; a new person is a name and nothing else compulsory.
 *
 * Attendance leads because it is the one that happens several times a day. The
 * order of these tabs is not cosmetic — it is the difference between the app
 * being used at 5:31pm and being caught up on at the weekend, badly.
 */

type Mode = 'attendance' | 'payment' | 'person' | 'expense';

const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'stock', label: 'Stock' },
  { value: 'rent', label: 'Rent' },
  { value: 'wages', label: 'Wages' },
  { value: 'utilities', label: 'Bills' },
  { value: 'equipment', label: 'Kit' },
  { value: 'marketing', label: 'Ads' },
  { value: 'tax', label: 'Tax' },
  { value: 'other', label: 'Other' },
];

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'transfer', label: 'Transfer' },
];

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function CaptureScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { offerUndo } = useUndo();
  const params = useLocalSearchParams<{ mode?: Mode; party?: string }>();

  const { profile, data, removeEngagements } = useBusiness();
  const now = useTick(60_000);

  const [mode, setMode] = useState<Mode>(params.mode ?? 'attendance');

  if (!profile) return null;

  const partyTerm = profile.vocabulary.party;
  const visitTerm = profile.vocabulary.engagement;
  // Passed the records too: an owner who has built a timetable gets the roster
  // even if their trade would not normally have one.
  const scheduled = usesSchedule(profile, data);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press
          haptic="light"
          scaleTo={0.9}
          onPress={() => router.back()}
          accessibilityLabel="Back"
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <ArrowLeft size={19} color={colors.text} strokeWidth={2.2} />
        </Press>
        <AppText variant="title3" style={styles.barTitle}>
          Add
        </AppText>
      </View>

      <View style={styles.gutter}>
        <Segmented<Mode>
          options={[
            { value: 'attendance', label: visitTerm.one },
            { value: 'payment', label: 'Payment' },
            { value: 'person', label: partyTerm.one },
            { value: 'expense', label: 'Expense' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        <Animated.View key={mode} entering={enter(0)}>
          {/*
            Two completely different shapes behind one tab.

            A tuition centre records fourteen people at once and money never
            enters into it — the fees live on a plan. A garage records one
            customer, one job, one amount, and the single most important question
            is whether they actually paid. Offering the attendance grid to a
            garage was asking it to tick off a class that does not exist.
          */}
          {mode === 'attendance' && !scheduled ? (
            <Job now={now} onDone={() => router.back()} />
          ) : null}

          {mode === 'attendance' && scheduled ? (
            <Attendance
              now={now}
              onDone={(made) => {
                // The ids of everything just written, so undo removes exactly
                // those records — including the no-shows a template run creates.
                tapCompleted();
                // Names both halves. "14 recorded" reads as fourteen classes,
                // which is the one thing it never means. See `describeBatch`.
                offerUndo(describeBatch(profile, made), () =>
                  removeEngagements(made.map((e) => e.id)),
                );
                router.back();
              }}
            />
          ) : null}
          {mode === 'payment' ? <TakePayment onDone={() => router.back()} /> : null}
          {mode === 'person' ? <AddPerson onDone={() => router.back()} /> : null}
          {mode === 'expense' ? <AddExpense onDone={() => router.back()} /> : null}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ job -- */

/**
 * One customer, one piece of work, one question: did they pay?
 *
 * This is the whole shape of a garage, a salon, a repair shop — trades where
 * people arrive one at a time and the money is settled at the counter, or
 * isn't. That last case is the one every other tool gets wrong: the work is
 * recorded, the payment is assumed, and the shortfall only surfaces weeks later
 * when somebody tries to reconcile the till.
 *
 * Here, "not yet" is a first-class answer. Choosing it writes a real debt
 * against a real person, dated, which is what makes the collection list, the
 * reliability score and the cash forecast possible at all.
 */
function Job({ now, onDone }: { now: number; onDone: () => void }) {
  const colors = useColors();
  const { profile, data, addEngagement, addMoney, addParty } = useBusiness();
  const index = useIndex();
  const { offerUndo } = useUndo();

  const [partyId, setPartyId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [query, setQuery] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [offeringId, setOfferingId] = useState<string | null>(null);
  const [paid, setPaid] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>('cash');

  const live = useMemo(() => data.parties.filter((p) => !p.archivedAt), [data.parties]);

  /**
   * Whoever was in most recently, until you start typing.
   *
   * A repeat customer is usually a recent one, and offering the last handful
   * saves the search entirely for most jobs.
   */
  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle) {
      return live.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 8);
    }
    return [...live]
      .sort((a, b) => (index.lastSeen.get(b.id) ?? 0) - (index.lastSeen.get(a.id) ?? 0))
      .slice(0, 6);
  }, [live, query, index]);

  const services = useMemo(
    () => data.offerings.filter((o) => !o.durationDays && o.active !== false).slice(0, 6),
    [data.offerings],
  );

  const common = useMemo(() => {
    const counts = new Map<number, number>();
    for (const m of data.money) {
      if (m.direction !== 'in' || m.amount <= 0) continue;
      counts.set(m.amount, (counts.get(m.amount) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v]) => v);
  }, [data.money]);

  if (!profile) return null;

  const partyTerm = profile.vocabulary.party;
  const visitTerm = profile.vocabulary.engagement;

  /*
    Shorthand is understood, not truncated. `60k` used to keep the digits and
    drop the `k`, recording sixty rupees for a sixty-thousand-rupee job — the
    owner's own abbreviation causing a thousandfold under-reading that no screen
    afterwards could reveal. See `domain/amount.ts`.
  */
  const parsedAmount = parseAmount(amount);
  const value = parsedAmount.ok ? parsedAmount.value : 0;
  const hasAmount = parsedAmount.ok;
  // A job with no customer is not a record of anything, but a job with no
  // amount is perfectly ordinary — a warranty return, a favour, a look-over.
  const named = Boolean(partyId) || newName.trim().length >= 2;

  const owed = live.find((p) => p.id === partyId)
    ? (index.moneyByParty.get(partyId as string) ?? [])
        .filter((m) => m.direction === 'in' && m.status === 'due')
        .reduce((s, m) => s + m.amount, 0)
    : 0;

  const save = () => {
    if (!named) return;

    const person = partyId
      ? live.find((p) => p.id === partyId)
      : addParty({ name: newName.trim() });
    if (!person) return;

    const offering = services.find((o) => o.id === offeringId);
    const label = note.trim() || offering?.name || visitTerm.one;

    addEngagement({
      partyId: person.id,
      at: now,
      offeringId: offering?.id ?? null,
      value: hasAmount ? value : undefined,
      note: note.trim() || undefined,
      source: 'manual',
    });

    if (hasAmount) {
      addMoney({
        partyId: person.id,
        amount: value,
        direction: 'in',
        at: now,
        dueAt: now,
        settledAt: paid ? now : null,
        status: paid ? 'settled' : 'due',
        label,
        method: paid ? method : undefined,
        offeringId: offering?.id ?? null,
      });
    }

    offerUndo(
      hasAmount
        ? `${money(value)} ${paid ? 'taken' : 'owed'} · ${person.name}`
        : `${visitTerm.one} recorded`,
      () => {},
    );
    onDone();
  };

  return (
    <View style={[styles.section, styles.gutter]}>
      {/* ------------------------------------------------------------- who */}
      <AppText variant="caption" color="textFaint" style={styles.label}>
        WHO WAS IT FOR
      </AppText>

      <TextField
        placeholder={`Search, or type a new ${partyTerm.one.toLowerCase()}`}
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setPartyId(null);
          setNewName(text);
        }}
      />

      <View style={styles.chips}>
        {candidates.map((p) => {
          const on = p.id === partyId;
          return (
            <Press
              key={p.id}
              haptic="selection"
              scaleTo={0.95}
              onPress={() => {
                setPartyId(on ? null : p.id);
                setNewName('');
                if (!on) setQuery(p.name);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.chip, { backgroundColor: on ? colors.accent : colors.surfaceHigh }]}>
              <AppText variant="footnote" tint={on ? colors.accentText : colors.text}>
                {p.name}
              </AppText>
            </Press>
          );
        })}
      </View>

      {/* A new name typed into a search box is easy to do by accident, so it is
          confirmed explicitly rather than created silently on save. */}
      {!partyId && newName.trim().length >= 2 ? (
        <View style={[styles.newPerson, { backgroundColor: colors.accentSoft }]}>
          <UserPlus size={15} color={colors.accent} strokeWidth={2.2} />
          <AppText variant="footnote" tint={colors.accent} style={styles.grow}>
            Add “{newName.trim()}” as a new {partyTerm.one.toLowerCase()}
          </AppText>
        </View>
      ) : null}

      {/* This is the number that changes the conversation at the counter. */}
      {owed > 0 ? (
        <View style={[styles.owedNotice, { backgroundColor: colors.surfaceHigh }]}>
          <TriangleAlert size={15} color={colors.warn} strokeWidth={2} />
          <AppText variant="caption" color="textDim" style={styles.grow}>
            Already owes {money(owed)} from before.
          </AppText>
        </View>
      ) : null}

      {/* ------------------------------------------------------------ what */}
      {services.length > 0 ? (
        <>
          <AppText variant="caption" color="textFaint" style={styles.label}>
            WHAT WAS DONE
          </AppText>
          <View style={styles.chips}>
            {services.map((o) => {
              const on = o.id === offeringId;
              return (
                <Press
                  key={o.id}
                  haptic="selection"
                  scaleTo={0.95}
                  onPress={() => {
                    setOfferingId(on ? null : o.id);
                    // Prefilling the price is the point of having a price list.
                    if (!on && o.price > 0) setAmount(String(o.price));
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[styles.chip, { backgroundColor: on ? colors.accent : colors.surfaceHigh }]}>
                  <AppText variant="footnote" tint={on ? colors.accentText : colors.text}>
                    {o.name}
                  </AppText>
                </Press>
              );
            })}
          </View>
        </>
      ) : null}

      <TextField
        placeholder="Anything worth noting (optional)"
        value={note}
        onChangeText={setNote}
      />

      {/* --------------------------------------------------------- how much */}
      <AppText variant="caption" color="textFaint" style={styles.label}>
        HOW MUCH
      </AppText>
      <TextField
        placeholder="Leave blank if nothing was charged"
        value={amount}
        // Filtered at the keystroke, so the field can never show a value that
        // would be silently discarded on save.
        onChangeText={(text) => setAmount(sanitiseAmountInput(text))}
        keyboardType="numeric"
        footnote={amountHint(amount, money) ?? undefined}
      />

      {common.length > 0 ? (
        <View style={styles.chips}>
          {common.map((preset) => (
            <Press
              key={preset}
              haptic="selection"
              scaleTo={0.95}
              onPress={() => setAmount(String(preset))}
              accessibilityLabel={`Set amount to ${money(preset)}`}
              style={[styles.chip, { backgroundColor: colors.surfaceHigh }]}>
              <AppText variant="footnote" tabular>
                {money(preset)}
              </AppText>
            </Press>
          ))}
        </View>
      ) : null}

      {/* ------------------------------------------------------- did they pay */}
      {hasAmount ? (
        <>
          <AppText variant="caption" color="textFaint" style={styles.label}>
            DID THEY PAY?
          </AppText>

          <View style={styles.payRow}>
            <Press
              haptic="selection"
              scaleTo={0.96}
              onPress={() => setPaid(true)}
              accessibilityRole="radio"
              accessibilityState={{ selected: paid }}
              style={[
                styles.payOption,
                {
                  backgroundColor: paid ? colors.successSoft : colors.surface,
                  borderColor: paid ? colors.success : 'transparent',
                },
              ]}>
              <Check size={16} color={paid ? colors.success : colors.textFaint} strokeWidth={2.6} />
              <AppText variant="callout" tint={paid ? colors.success : colors.textDim}>
                Paid now
              </AppText>
            </Press>

            <Press
              haptic="selection"
              scaleTo={0.96}
              onPress={() => setPaid(false)}
              accessibilityRole="radio"
              accessibilityState={{ selected: !paid }}
              style={[
                styles.payOption,
                {
                  backgroundColor: !paid ? `${colors.warn}22` : colors.surface,
                  borderColor: !paid ? colors.warn : 'transparent',
                },
              ]}>
              <Clock size={16} color={!paid ? colors.warn : colors.textFaint} strokeWidth={2.2} />
              <AppText variant="callout" tint={!paid ? colors.warn : colors.textDim}>
                Not yet
              </AppText>
            </Press>
          </View>

          {paid ? (
            <View style={styles.chips}>
              {METHODS.map((m) => {
                const on = m.value === method;
                return (
                  <Press
                    key={m.value}
                    haptic="selection"
                    scaleTo={0.95}
                    onPress={() => setMethod(m.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[
                      styles.chip,
                      { backgroundColor: on ? colors.accent : colors.surfaceHigh },
                    ]}>
                    <AppText variant="footnote" tint={on ? colors.accentText : colors.text}>
                      {m.label}
                    </AppText>
                  </Press>
                );
              })}
            </View>
          ) : (
            <AppText variant="caption" color="textFaint" style={styles.hint}>
              This goes onto their account as {money(value)} owed from today. It appears in the
              collection list, counts against your cash forecast, and builds their payment record —
              which is what tells you later whether this is someone who always settles or someone
              who never does.
            </AppText>
          )}
        </>
      ) : null}

      <Press
        haptic="medium"
        scaleTo={0.97}
        disabled={!named}
        onPress={save}
        style={[
          styles.cta,
          styles.ctaSpaced,
          { backgroundColor: hasAmount && !paid ? colors.warn : colors.accent },
        ]}>
        <Check size={17} color={colors.accentText} strokeWidth={2.6} />
        <AppText variant="callout" tint={colors.accentText}>
          {!named
            ? `Pick a ${partyTerm.one.toLowerCase()}`
            : !hasAmount
              ? `Record the ${visitTerm.one.toLowerCase()}`
              : paid
                ? `Record ${money(value)} taken`
                : `Record ${money(value)} owed`}
        </AppText>
      </Press>
    </View>
  );
}

/* ------------------------------------------------------------ attendance -- */

/**
 * Who turned up.
 *
 * A grid of names with a tap target each. Everyone on a template is written
 * either present or as a no-show, because an absence with no record is
 * indistinguishable from a session that never ran, and that difference is what
 * lapse detection reads.
 */
function Attendance({
  now,
  onDone,
}: {
  now: number;
  /* The whole records, not just their ids: the confirmation has to distinguish
     who was present from who was marked absent. */
  onDone: (made: Engagement[]) => void;
}) {
  const colors = useColors();
  const { columns } = useBreakpoint();
  const { profile, data, addEngagements, runTemplate } = useBusiness();
  const index = useIndex();

  const dayStart = startOfDay(now);
  const weekday = new Date(now).getDay();

  const todaysTemplates = useMemo(
    () => data.templates.filter((t) => t.active && t.weekdays.includes(weekday)),
    [data.templates, weekday],
  );

  const [templateId, setTemplateId] = useState<string | null>(todaysTemplates[0]?.id ?? null);
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const template = todaysTemplates.find((t) => t.id === templateId) ?? null;

  const roster = useMemo(() => {
    const source = template
      ? template.partyIds.map((id) => index.partyById.get(id)).filter(Boolean)
      : data.parties.filter((p) => !p.archivedAt);

    const list = source as NonNullable<ReturnType<typeof index.partyById.get>>[];
    const filtered = query
      ? list.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
      : list;

    // Longest-absent first when there is no template: the people most worth
    // noticing are the ones you have not seen, and a straight alphabetical list
    // buries them.
    return template
      ? filtered
      : filtered
          .slice()
          .sort((a, b) => (index.lastSeen.get(a.id) ?? 0) - (index.lastSeen.get(b.id) ?? 0))
          .slice(0, 60);
  }, [template, data.parties, index, query]);

  if (!profile) return null;

  const toggle = (id: string) => {
    setPresent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = () => {
    if (present.size === 0) return;
    const made = template
      ? runTemplate(template.id, [...present], now)
      : addEngagements(
          [...present].map((partyId) => ({
            partyId,
            at: now,
            source: 'manual' as const,
          })),
        );
    onDone(made);
  };

  return (
    <View style={styles.section}>
      {todaysTemplates.length > 0 ? (
        <View style={styles.gutter}>
          <AppText variant="caption" color="textFaint" style={styles.label}>
            WHICH SESSION
          </AppText>
          <View style={styles.chips}>
            {todaysTemplates.map((t) => {
              const at = dayStart + t.minuteOfDay * 60 * 1000;
              const selected = t.id === templateId;
              return (
                <Press
                  key={t.id}
                  haptic="selection"
                  scaleTo={0.95}
                  onPress={() => {
                    setTemplateId(t.id);
                    setPresent(new Set());
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? colors.accent : colors.surface,
                    },
                  ]}>
                  <AppText variant="footnote" tint={selected ? colors.accentText : colors.text}>
                    {t.name} · {formatTime(at)}
                  </AppText>
                </Press>
              );
            })}
            <Press
              haptic="selection"
              scaleTo={0.95}
              onPress={() => {
                setTemplateId(null);
                setPresent(new Set());
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: templateId === null }}
              style={[
                styles.chip,
                { backgroundColor: templateId === null ? colors.accent : colors.surface },
              ]}>
              <AppText
                variant="footnote"
                tint={templateId === null ? colors.accentText : colors.text}>
                Someone else
              </AppText>
            </Press>
          </View>
        </View>
      ) : null}

      {!template ? (
        <View style={[styles.gutter, styles.search]}>
          <TextField placeholder="Search by name" value={query} onChangeText={setQuery} />
        </View>
      ) : null}

      {/* Bulk controls. Marking a full session present one tap at a time is
          fourteen taps for the most common outcome there is. */}
      {roster.length > 2 ? (
        <View style={[styles.gutter, styles.bulk]}>
          <Press
            haptic="light"
            scaleTo={0.95}
            onPress={() => setPresent(new Set(roster.map((p) => p.id)))}
            style={[styles.bulkChip, { backgroundColor: colors.surfaceHigh }]}>
            <AppText variant="caption">Everyone</AppText>
          </Press>
          <Press
            haptic="light"
            scaleTo={0.95}
            onPress={() =>
              setPresent((prev) => new Set(roster.filter((p) => !prev.has(p.id)).map((p) => p.id)))
            }
            style={[styles.bulkChip, { backgroundColor: colors.surfaceHigh }]}>
            <AppText variant="caption">Flip</AppText>
          </Press>
          <Press
            haptic="light"
            scaleTo={0.95}
            onPress={() => setPresent(new Set())}
            style={[styles.bulkChip, { backgroundColor: colors.surfaceHigh }]}>
            <AppText variant="caption">Clear</AppText>
          </Press>

          <View style={styles.bulkSpacer} />

          {present.size > 0 ? (
            <View style={[styles.countPill, { backgroundColor: colors.accentSoft }]}>
              <AppText variant="caption" tabular tint={colors.accent}>
                {present.size} of {roster.length}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.grid}>
        {roster.map((party) => {
          const on = present.has(party.id);
          const seen = index.lastSeen.get(party.id) ?? null;
          return (
            <Press
              key={party.id}
              haptic="selection"
              scaleTo={0.94}
              onPress={() => toggle(party.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${party.name}, ${relativeDays(seen, now, 'never in')}`}
              style={[
                styles.tile,
                {
                  width: cellWidth(columns),
                  backgroundColor: on ? colors.accent : colors.surface,
                  borderColor: on ? colors.accent : 'transparent',
                },
              ]}>
              {/* A face, or the nearest thing to one. Scanning a grid of
                  initials is markedly faster than reading a grid of names. */}
              <View
                style={[
                  styles.tileMark,
                  { backgroundColor: on ? colors.accentText : colors.surfaceHigh },
                ]}>
                {on ? (
                  <Check size={13} color={colors.accent} strokeWidth={3} />
                ) : (
                  <AppText variant="caption" color="textDim">
                    {initials(party.name)}
                  </AppText>
                )}
              </View>

              <View style={styles.tileBody}>
                <AppText
                  variant="callout"
                  numberOfLines={1}
                  tint={on ? colors.accentText : colors.text}>
                  {party.name}
                </AppText>
                <AppText
                  variant="caption"
                  numberOfLines={1}
                  tint={on ? colors.accentText : colors.textFaint}
                  style={on ? styles.tileSubOn : undefined}>
                  {relativeDays(seen, now, 'Never in')}
                </AppText>
              </View>
            </Press>
          );
        })}
      </View>

      <View style={[styles.gutter, styles.saveWrap]}>
        <Press
          haptic="medium"
          scaleTo={0.97}
          disabled={present.size === 0}
          onPress={save}
          style={[styles.cta, { backgroundColor: colors.accent }]}>
          <Check size={17} color={colors.accentText} strokeWidth={2.6} />
          <AppText variant="callout" tint={colors.accentText}>
            {present.size === 0
              ? 'Tap whoever turned up'
              : `Record ${present.size}${template ? ` · ${template.partyIds.length - present.size} missing` : ''}`}
          </AppText>
        </Press>
        {template ? (
          <AppText variant="caption" color="textFaint" style={styles.note}>
            Everyone not tapped is recorded as a no-show rather than left blank. An absence with no
            record looks the same as a session that never happened.
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/* --------------------------------------------------------------- payment -- */

function TakePayment({ onDone }: { onDone: () => void }) {
  const colors = useColors();
  const { profile, data, addMoney, settleMoney } = useBusiness();
  const index = useIndex();

  const [partyId, setPartyId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [query, setQuery] = useState('');

  const owed = useMemo(
    () =>
      data.money
        .filter((m) => m.direction === 'in' && m.status === 'due')
        .sort((a, b) => (a.dueAt ?? a.at) - (b.dueAt ?? b.at)),
    [data.money],
  );

  const candidates = useMemo(() => {
    const live = data.parties.filter((p) => !p.archivedAt);
    if (!query) return live.slice(0, 8);
    return live.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  }, [data.parties, query]);

  /**
   * The handful of amounts this business actually charges.
   *
   * Taken from what has been settled rather than from the price list, because
   * the price list is what the owner meant to charge and this is what they
   * charge. Ranked by how often, not by size.
   */
  const common = useMemo(() => {
    const counts = new Map<number, number>();
    for (const m of data.money) {
      if (m.direction !== 'in' || m.amount <= 0) continue;
      counts.set(m.amount, (counts.get(m.amount) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([value]) => value);
  }, [data.money]);

  if (!profile) return null;

  const raw = amount.replace(/[^0-9.]/g, '');
  const value = Number(raw);
  const valid = raw.length > 0 && Number.isFinite(value) && value > 0;

  const save = () => {
    if (!valid) return;
    const now = Date.now();
    addMoney({
      partyId,
      amount: value,
      direction: 'in',
      at: now,
      dueAt: now,
      settledAt: now,
      status: 'settled',
      label: label.trim() || 'Payment',
      method,
    });
    onDone();
  };

  return (
    <View style={styles.section}>
      {/* Settling something already owed is the common case, so it comes first. */}
      {owed.length > 0 ? (
        <View style={styles.gutter}>
          <AppText variant="caption" color="textFaint" style={styles.label}>
            ALREADY OWED
          </AppText>
          <View style={styles.rows}>
            {owed.slice(0, 5).map((entry) => (
              <Press
                key={entry.id}
                haptic="medium"
                scaleTo={0.98}
                onPress={() => {
                  settleMoney(entry.id, method);
                  onDone();
                }}
                style={[styles.owedRow, { backgroundColor: colors.surface }]}>
                <View style={styles.owedBody}>
                  <AppText variant="callout" numberOfLines={1}>
                    {entry.partyId ? (index.partyById.get(entry.partyId)?.name ?? entry.label) : entry.label}
                  </AppText>
                  <AppText variant="caption" color="textFaint">
                    {entry.label}
                  </AppText>
                </View>
                <AppText variant="callout" tabular tint={colors.warn}>
                  {money(entry.amount)}
                </AppText>
                <View style={[styles.tick, { backgroundColor: colors.successSoft }]}>
                  <Check size={15} color={colors.success} strokeWidth={2.6} />
                </View>
              </Press>
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.gutter, styles.block]}>
        <AppText variant="caption" color="textFaint" style={styles.label}>
          OR RECORD SOMETHING NEW
        </AppText>

        <Card tone="surface" style={styles.form}>
          <TextField
            placeholder="Amount"
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
          />

          {/* Validation as you type, never on submit. Being told what is wrong
              after pressing the button is being told too late. */}
          {amount.trim().length > 0 && !valid ? (
            <AppText variant="caption" tint={colors.warn}>
              That is not an amount I can read — digits only.
            </AppText>
          ) : null}

          {/* The amounts this business actually charges, one tap away. Almost
              every payment is one of three or four numbers. */}
          {common.length > 0 ? (
            <View style={styles.chips}>
              {common.map((preset) => (
                <Press
                  key={preset}
                  haptic="selection"
                  scaleTo={0.95}
                  onPress={() => setAmount(String(preset))}
                  accessibilityLabel={`Set amount to ${money(preset)}`}
                  style={[styles.chip, { backgroundColor: colors.surfaceHigh }]}>
                  <AppText variant="footnote" tabular>
                    {money(preset)}
                  </AppText>
                </Press>
              ))}
            </View>
          ) : null}

          <TextField placeholder="What for (optional)" value={label} onChangeText={setLabel} />

          <AppText variant="caption" color="textFaint">
            PAID BY
          </AppText>
          <View style={styles.chips}>
            {METHODS.map((m) => {
              const selected = m.value === method;
              return (
                <Press
                  key={m.value}
                  haptic="selection"
                  scaleTo={0.95}
                  onPress={() => setMethod(m.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.chip,
                    { backgroundColor: selected ? colors.accent : colors.surfaceHigh },
                  ]}>
                  <AppText variant="footnote" tint={selected ? colors.accentText : colors.text}>
                    {m.label}
                  </AppText>
                </Press>
              );
            })}
          </View>

          <AppText variant="caption" color="textFaint">
            WHO FROM (OPTIONAL)
          </AppText>
          <TextField placeholder="Search" value={query} onChangeText={setQuery} />
          <View style={styles.chips}>
            {candidates.map((p) => {
              const selected = p.id === partyId;
              return (
                <Press
                  key={p.id}
                  haptic="selection"
                  scaleTo={0.95}
                  onPress={() => setPartyId(selected ? null : p.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.chip,
                    { backgroundColor: selected ? colors.accent : colors.surfaceHigh },
                  ]}>
                  <AppText variant="footnote" tint={selected ? colors.accentText : colors.text}>
                    {p.name}
                  </AppText>
                </Press>
              );
            })}
          </View>
        </Card>

        <Press
          haptic="medium"
          scaleTo={0.97}
          disabled={!valid}
          onPress={save}
          style={[styles.cta, styles.ctaSpaced, { backgroundColor: colors.accent }]}>
          <Banknote size={17} color={colors.accentText} strokeWidth={2.2} />
          <AppText variant="callout" tint={colors.accentText}>
            {valid ? `Record ${money(value)}` : 'Enter an amount'}
          </AppText>
        </Press>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- person -- */

function AddPerson({ onDone }: { onDone: () => void }) {
  const colors = useColors();
  const { profile, data, addParty, addCommitment, addMoney } = useBusiness();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [detail, setDetail] = useState('');
  const [offeringId, setOfferingId] = useState<string | null>(null);
  const [referredBy, setReferredBy] = useState<string | null>(null);

  if (!profile) return null;

  const plans = data.offerings.filter((o) => o.durationDays && o.active !== false);
  const valid = name.trim().length >= 2;

  const save = () => {
    if (!valid) return;
    const party = addParty({
      name: name.trim(),
      phone: phone.trim() || undefined,
      detail: detail.trim() || undefined,
      referredBy,
    });

    const offering = plans.find((o) => o.id === offeringId);
    if (offering) {
      const now = Date.now();
      const days = offering.durationDays ?? 30;
      addCommitment({
        partyId: party.id,
        offeringId: offering.id,
        startAt: now,
        endAt: now + days * 24 * 60 * 60 * 1000,
        price: offering.price,
        status: 'active',
      });
      addMoney({
        partyId: party.id,
        amount: offering.price,
        direction: 'in',
        at: now,
        dueAt: now,
        settledAt: billsAfterwards(profile.shape) ? null : now,
        status: billsAfterwards(profile.shape) ? 'due' : 'settled',
        label: offering.name,
        offeringId: offering.id,
      });
    }

    onDone();
  };

  return (
    <View style={[styles.section, styles.gutter]}>
      <Card tone="surface" style={styles.form}>
        <TextField placeholder="Name" value={name} onChangeText={setName} autoFocus />
        <TextField
          placeholder="Phone (optional)"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <TextField
          placeholder={`Anything worth remembering (optional)`}
          value={detail}
          onChangeText={setDetail}
        />

        {plans.length > 0 ? (
          <>
            <AppText variant="caption" color="textFaint">
              START A {profile.vocabulary.commitment.one.toUpperCase()}?
            </AppText>
            <View style={styles.chips}>
              {plans.map((o) => {
                const selected = o.id === offeringId;
                return (
                  <Press
                    key={o.id}
                    haptic="selection"
                    scaleTo={0.95}
                    onPress={() => setOfferingId(selected ? null : o.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={[
                      styles.chip,
                      { backgroundColor: selected ? colors.accent : colors.surfaceHigh },
                    ]}>
                    <AppText variant="footnote" tint={selected ? colors.accentText : colors.text}>
                      {o.name} · {money(o.price)}
                    </AppText>
                  </Press>
                );
              })}
            </View>
          </>
        ) : null}

        {data.parties.length > 0 ? (
          <>
            <AppText variant="caption" color="textFaint">
              WHO SENT THEM? (OPTIONAL)
            </AppText>
            <AppText variant="caption" color="textFaint" style={styles.hint}>
              Recording this is what makes word of mouth measurable instead of assumed.
            </AppText>
            <View style={styles.chips}>
              {data.parties.slice(0, 6).map((p) => {
                const selected = p.id === referredBy;
                return (
                  <Press
                    key={p.id}
                    haptic="selection"
                    scaleTo={0.95}
                    onPress={() => setReferredBy(selected ? null : p.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={[
                      styles.chip,
                      { backgroundColor: selected ? colors.accent : colors.surfaceHigh },
                    ]}>
                    <AppText variant="footnote" tint={selected ? colors.accentText : colors.text}>
                      {p.name}
                    </AppText>
                  </Press>
                );
              })}
            </View>
          </>
        ) : null}
      </Card>

      <Press
        haptic="medium"
        scaleTo={0.97}
        disabled={!valid}
        onPress={save}
        style={[styles.cta, styles.ctaSpaced, { backgroundColor: colors.accent }]}>
        <UserPlus size={17} color={colors.accentText} strokeWidth={2.2} />
        <AppText variant="callout" tint={colors.accentText}>
          {valid ? `Add ${name.trim()}` : `Name your ${profile.vocabulary.party.one.toLowerCase()}`}
        </AppText>
      </Press>
    </View>
  );
}

/* --------------------------------------------------------------- expense -- */

function AddExpense({ onDone }: { onDone: () => void }) {
  const colors = useColors();
  const { addExpense } = useBusiness();

  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('stock');

  const value = Number(amount.replace(/[^0-9.]/g, ''));
  const valid = value > 0;

  return (
    <View style={[styles.section, styles.gutter]}>
      <Card tone="surface" style={styles.form}>
        <TextField
          placeholder="Amount"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          autoFocus
        />
        <TextField placeholder="What was it for" value={label} onChangeText={setLabel} />

        <AppText variant="caption" color="textFaint">
          CATEGORY
        </AppText>
        <View style={styles.chips}>
          {EXPENSE_CATEGORIES.map((c) => {
            const selected = c.value === category;
            return (
              <Press
                key={c.value}
                haptic="selection"
                scaleTo={0.95}
                onPress={() => setCategory(c.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[
                  styles.chip,
                  { backgroundColor: selected ? colors.accent : colors.surfaceHigh },
                ]}>
                <AppText variant="footnote" tint={selected ? colors.accentText : colors.text}>
                  {c.label}
                </AppText>
              </Press>
            );
          })}
        </View>
      </Card>

      <AppText variant="caption" color="textFaint" style={styles.note}>
        Rent, wages and bills are treated as fixed costs, which is what the break-even line is worked
        out from. Everything else is variable.
      </AppText>

      <Press
        haptic="medium"
        scaleTo={0.97}
        disabled={!valid}
        onPress={() => {
          addExpense({ amount: value, label: label.trim() || 'Expense', category });
          onDone();
        }}
        style={[styles.cta, styles.ctaSpaced, { backgroundColor: colors.accent }]}>
        <CircleMinus size={17} color={colors.accentText} strokeWidth={2.2} />
        <AppText variant="callout" tint={colors.accentText}>
          {valid ? `Record ${money(value)} out` : 'Enter an amount'}
        </AppText>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    paddingVertical: space.md,
  },
  barTitle: { flex: 1 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  gutter: { paddingHorizontal: space.gutter },
  scroll: { paddingTop: space.base },
  section: { gap: space.base },
  block: { marginTop: space.lg },
  label: { letterSpacing: 0.9, marginBottom: space.sm },
  hint: { lineHeight: 16 },
  note: { lineHeight: 16, marginTop: space.md },
  search: { marginTop: space.sm },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: space.base, height: 36, borderRadius: radius.pill, justifyContent: 'center' },

  bulk: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  bulkChip: {
    paddingHorizontal: space.md,
    height: 30,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  bulkSpacer: { flex: 1 },
  countPill: {
    paddingHorizontal: space.md,
    height: 30,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },

  grid: {
    paddingHorizontal: space.gutter,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  tile: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderWidth: 1,
  },
  tileMark: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBody: { flex: 1, gap: 1 },
  tileSubOn: { opacity: 0.75 },

  rows: { gap: space.sm },
  owedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  owedBody: { flex: 1, gap: 2 },
  tick: { width: 30, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },

  form: { gap: space.md },

  saveWrap: { marginTop: space.base, gap: space.sm },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 52,
    borderRadius: radius.pill,
  },
  ctaSpaced: { marginTop: space.base },

  newPerson: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
  owedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
  grow: { flex: 1 },
  payRow: { flexDirection: 'row', gap: space.sm },
  payOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
});
