import { useRouter } from 'expo-router';
import { ArrowRight, Check, Plus, Receipt, SlidersHorizontal } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Bars, StackedBar } from '@/components/Charts';
import { Deep } from '@/components/Deep';
import { EmptyState } from '@/components/EmptyState';
import { LargeTitleScreen } from '@/components/LargeTitleScreen';
import { MoneyCard, type MoneyAction, type MoneyFace } from '@/components/MoneyCard';
import { Press } from '@/components/Press';
import { Segmented } from '@/components/Segmented';
import { Sheet } from '@/components/Sheet';
import { Slider } from '@/components/Slider';
import {
  agingBuckets,
  breakEven,
  cashForecast,
  startOfMonth,
} from '@/domain/analytics';
import { simulatePriceChange } from '@/domain/intel';
import { money, revenueBetween } from '@/domain/metrics';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatDayMonth, useTick } from '@/lib/time';
import { useBusiness, useIndex } from '@/state/business';
import { tapSettled } from '@/lib/haptics';
import { useDockInset } from '@/state/dock';
import { useUndo } from '@/state/undo';

const DAY = 24 * 60 * 60 * 1000;

type Tab = 'in' | 'owed' | 'out';

/**
 * The money screen.
 *
 * Split three ways because owners think about money three ways and mixing them
 * is how spreadsheets become unreadable: what came in, what is still owed, what
 * went out. The break-even line sits on the first because "am I covering costs"
 * is the actual question behind "how much did I take".
 */
export default function MoneyScreen() {
  const colors = useColors();
  const router = useRouter();
  const { enter } = useMotion();
  const dockInset = useDockInset();
  const { profile, data, settleMoney, unsettleMoney } = useBusiness();
  const { offerUndo } = useUndo();
  const index = useIndex();
  const now = useTick(60_000);

  const [tab, setTab] = useState<Tab>('in');
  const [simSheet, setSimSheet] = useState(false);
  const [changePct, setChangePct] = useState(10);

  const monthStart = startOfMonth(now);

  const collected = useMemo(() => revenueBetween(data, monthStart, now), [data, monthStart, now]);
  const be = useMemo(() => breakEven(data, now), [data, now]);
  const [faceAt, setFaceAt] = useState(0);
  const forecast = useMemo(
    () => (profile ? cashForecast(profile, data, index, now) : null),
    [profile, data, index, now],
  );
  const aging = useMemo(() => agingBuckets(data, now), [data, now]);

  const due = useMemo(
    () =>
      data.money
        .filter((m) => m.direction === 'in' && m.status === 'due')
        .sort((a, b) => (a.dueAt ?? a.at) - (b.dueAt ?? b.at)),
    [data.money],
  );
  const owedTotal = due.reduce((s, m) => s + m.amount, 0);

  const incoming = useMemo(
    () =>
      data.money
        .filter((m) => m.direction === 'in' && m.status === 'settled')
        .sort((a, b) => b.at - a.at)
        .slice(0, 40),
    [data.money],
  );

  const outgoing = useMemo(
    () => data.money.filter((m) => m.direction === 'out').sort((a, b) => b.at - a.at).slice(0, 40),
    [data.money],
  );

  const spendByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of data.money) {
      if (m.direction !== 'out' || m.at < monthStart) continue;
      const key = m.category ?? 'other';
      map.set(key, (map.get(key) ?? 0) + m.amount);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.money, monthStart]);

  const sim = useMemo(
    () => (profile ? simulatePriceChange(profile, data, changePct, now, index) : null),
    [profile, data, changePct, now, index],
  );

  if (!profile) return null;

  /**
   * The three faces of the card.
   *
   * Gradients rather than the accent, and fixed rather than derived: these three
   * are read against each other, so they have to stay distinguishable no matter
   * what accent the owner picked. Warm for money in, amber for money owed, cool
   * for money out.
   */
  /**
   * Three, and no more.
   * The plinth has room for four and the temptation is to fill it; a row of four
   * evenly-weighted buttons has no primary action, which is the state this screen
   * was in before it had a card at all.
   */
  const MONEY_ACTIONS: MoneyAction[] = [
    { icon: Plus, label: 'Payment', href: '/capture?mode=payment' },
    { icon: ArrowRight, label: 'Chase', href: '/worklist?kind=collect' },
    { icon: Receipt, label: 'Expense', href: '/capture?mode=expense' },
  ];

  const monthPayments = data.money.filter(
    (m) => m.direction === 'in' && m.status === 'settled' && (m.settledAt ?? m.at) >= monthStart,
  ).length;
  const monthSpent = spendByCategory.reduce((sum, [, v]) => sum + v, 0);

  /*
    One face until there is money, three after.

    Three cards all reading zero is three swipes to learn the same thing, and
    the dots under them promise something behind the first that is not there.
    A single card saying nothing is recorded yet is the same truth without the
    invitation to go looking for the rest of it.
  */
  const faces: MoneyFace[] = data.money.length === 0
    ? [
        {
          key: 'in',
          amount: 0,
          label: 'Collected this month',
          trailing: 'nothing recorded yet',
          gradient: ['#FF5C5C', '#F0398A', '#C22BC6'],
        },
      ]
    : [
    {
      key: 'in',
      amount: collected,
      label: 'Collected this month',
      trailing: be.monthlyFixed > 0
        ? be.covered
          ? 'costs covered'
          : `${money(be.remaining)} to break even`
        : `${monthPayments} payment${monthPayments === 1 ? '' : 's'}`,
      gradient: ['#FF5C5C', '#F0398A', '#C22BC6'],
    },
    {
      key: 'owed',
      amount: owedTotal,
      label: 'Still owed',
      trailing: `${due.length} ${due.length === 1 ? 'account' : 'accounts'}`,
      gradient: ['#F0902B', '#E9603C', '#D0365F'],
    },
    {
      key: 'out',
      amount: monthSpent,
      label: 'Went out this month',
      trailing: forecast
        ? `${money(forecast.expected)} due in 30 days`
        : `${spendByCategory.length} ${spendByCategory.length === 1 ? 'category' : 'categories'}`,
      gradient: ['#3D6FE0', '#5B4BD6', '#8A3FC9'],
    },
  ];


  const spent = spendByCategory.reduce((s, [, v]) => s + v, 0);

  return (
    <LargeTitleScreen
      title="Money"
      subtitle="This month"
      bottomInset={dockInset}
      right={
        <Press
          haptic="medium"
          scaleTo={0.9}
          onPress={() => router.push('/capture?mode=payment' as never)}
          accessibilityLabel="Record a payment"
          style={[styles.add, { backgroundColor: colors.accent }]}>
          <Plus size={18} color={colors.accentText} strokeWidth={2.6} />
        </Press>
      }>
      {/* --------------------------------------------------------- headline */}
      <Animated.View entering={enter(0)} style={styles.gutter}>
        {/*
          A card, not a statistic.
          The figure used to sit under a caption on a plain surface, which is a
          correct and completely forgettable way to show it. On a card it is a
          balance — the one financial shape everybody already reads fluently,
          because every banking app they have opens with it.

          Three faces rather than one: what came in, what is still owed, what
          went out. They are the same question asked three ways, so they belong
          in the same place rather than as three cards down the page.
        */}
        <MoneyCard
          faces={faces}
          at={faceAt}
          onSelect={setFaceAt}
          actions={MONEY_ACTIONS}
          onAction={(action) => router.push(action.href as never)}
        />

      </Animated.View>

      {/* ------------------------------------------------------------- tabs */}
      <Animated.View entering={enter(1)} style={[styles.gutter, styles.tabs]}>
        <Segmented<Tab>
          options={[
            { value: 'in', label: 'Came in' },
            { value: 'owed', label: `Owed${owedTotal > 0 ? ` · ${money(owedTotal)}` : ''}` },
            { value: 'out', label: 'Went out' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </Animated.View>

      {/* ------------------------------------------------------------- owed */}
      {tab === 'owed' ? (
        due.length === 0 ? (
          <EmptyState
            art="sessions"
            title="Nothing outstanding"
            body="Everything you have raised has been settled."
          />
        ) : (
          <>
            <Animated.View entering={enter(2)} style={[styles.gutter, styles.block]}>
              <View style={[styles.agingCard, { backgroundColor: colors.surface }]}>
                <StackedBar
                  parts={[
                    { value: aging[0].amount, color: colors.surfaceHigh },
                    { value: aging[1].amount, color: colors.accent },
                    { value: aging[2].amount, color: colors.warn },
                    { value: aging[3].amount, color: colors.warn },
                  ]}
                  height={12}
                />
                <View style={styles.agingLegend}>
                  {aging.map((bucket) => (
                    <View key={bucket.label} style={styles.agingItem}>
                      <AppText variant="footnote" tabular>
                        {money(bucket.amount)}
                      </AppText>
                      <AppText variant="caption" color="textFaint" numberOfLines={1}>
                        {bucket.label}
                      </AppText>
                    </View>
                  ))}
                </View>
              </View>
            </Animated.View>

            <View style={styles.list}>
              {due.map((entry, i) => {
                const overdueDays = Math.floor((now - (entry.dueAt ?? entry.at)) / DAY);
                return (
                  <Animated.View key={entry.id} entering={enter(i)}>
                    <Deep
                      target={{ kind: 'money', moneyId: entry.id }}
                      haptic="light"
                      scaleTo={0.985}
                      style={[styles.row, { backgroundColor: colors.surface }]}>
                      <View style={styles.rowBody}>
                        <AppText variant="callout" numberOfLines={1}>
                          {entry.partyId
                            ? (index.partyById.get(entry.partyId)?.name ?? entry.label)
                            : entry.label}
                        </AppText>
                        <AppText variant="caption" color="textFaint" numberOfLines={1}>
                          {entry.label} ·{' '}
                          {overdueDays > 0
                            ? `${overdueDays} days overdue`
                            : `due ${formatDayMonth(entry.dueAt ?? entry.at)}`}
                        </AppText>
                      </View>
                      <AppText variant="callout" tabular tint={overdueDays > 0 ? colors.warn : colors.text}>
                        {money(entry.amount)}
                      </AppText>
                      <Press
                        haptic="medium"
                        scaleTo={0.88}
                        onPress={() => {
                          settleMoney(entry.id);
                          tapSettled();
                          offerUndo(`${money(entry.amount)} marked paid`, () =>
                            unsettleMoney(entry.id),
                          );
                        }}
                        accessibilityLabel={`Mark ${money(entry.amount)} as paid`}
                        style={[styles.tick, { backgroundColor: colors.successSoft }]}>
                        <Check size={16} color={colors.success} strokeWidth={2.6} />
                      </Press>
                    </Deep>
                  </Animated.View>
                );
              })}
            </View>

            <Animated.View entering={enter(3)} style={[styles.gutter, styles.block]}>
              <Press
                haptic="medium"
                scaleTo={0.97}
                onPress={() => router.push('/worklist?kind=collect' as never)}
                style={[styles.cta, { backgroundColor: colors.accent }]}>
                <AppText variant="callout" tint={colors.accentText}>
                  Work through the list
                </AppText>
                <ArrowRight size={16} color={colors.accentText} strokeWidth={2.4} />
              </Press>
            </Animated.View>
          </>
        )
      ) : null}

      {/* --------------------------------------------------------- came in */}
      {tab === 'in' ? (
        incoming.length === 0 ? (
          // The other two tabs had one and this did not, so a new business saw
          // a blank screen where the app is otherwise careful to say why.
          <EmptyState
            art="sessions"
            title="Nothing has come in yet"
            body="Payments appear here the moment you record one. Nothing needs setting up first."
          />
        ) : (
        <View style={styles.list}>
          {incoming.map((entry, i) => (
            <Animated.View key={entry.id} entering={enter(i)}>
              <Deep
                target={{ kind: 'money', moneyId: entry.id }}
                haptic="light"
                scaleTo={0.985}
                style={[styles.row, { backgroundColor: colors.surface }]}>
                <View style={styles.rowBody}>
                  <AppText variant="callout" numberOfLines={1}>
                    {entry.partyId
                      ? (index.partyById.get(entry.partyId)?.name ?? entry.label)
                      : entry.label}
                  </AppText>
                  <AppText variant="caption" color="textFaint" numberOfLines={1}>
                    {formatDayMonth(entry.at)}
                    {entry.method ? ` · ${entry.method}` : ''}
                  </AppText>
                </View>
                <AppText variant="callout" tabular tint={colors.success}>
                  {money(entry.amount)}
                </AppText>
              </Deep>
            </Animated.View>
          ))}
        </View>
        )
      ) : null}

      {/* -------------------------------------------------------- went out */}
      {tab === 'out' ? (
        <>
          {spendByCategory.length > 0 ? (
            <Animated.View entering={enter(2)} style={[styles.gutter, styles.block]}>
              <View style={[styles.agingCard, { backgroundColor: colors.surface }]}>
                <AppText variant="caption" color="textDim">
                  {money(spent)} out this month
                </AppText>
                <View style={styles.spendBars}>
                  <Bars
                    bars={spendByCategory.map(([label, value], i) => ({
                      label: label.slice(0, 4),
                      value,
                      highlight: i === 0,
                    }))}
                    height={70}
                    tint={colors.warn}
                  />
                </View>
              </View>
            </Animated.View>
          ) : null}

          <View style={styles.list}>
            {outgoing.map((entry, i) => (
              <Animated.View key={entry.id} entering={enter(i)}>
                <Deep
                  target={{ kind: 'money', moneyId: entry.id }}
                  haptic="light"
                  scaleTo={0.985}
                  style={[styles.row, { backgroundColor: colors.surface }]}>
                  <View style={styles.rowBody}>
                    <AppText variant="callout" numberOfLines={1}>
                      {entry.label}
                    </AppText>
                    <AppText variant="caption" color="textFaint">
                      {formatDayMonth(entry.at)}
                      {entry.category ? ` · ${entry.category}` : ''}
                    </AppText>
                  </View>
                  <AppText variant="callout" tabular color="textDim">
                    −{money(entry.amount)}
                  </AppText>
                </Deep>
              </Animated.View>
            ))}
          </View>

          <Animated.View entering={enter(3)} style={[styles.gutter, styles.block]}>
            <Press
              haptic="medium"
              scaleTo={0.97}
              onPress={() => router.push('/capture?mode=expense' as never)}
              style={[styles.ctaGhost, { borderColor: colors.hairlineStrong }]}>
              <Plus size={16} color={colors.textDim} strokeWidth={2.2} />
              <AppText variant="callout" color="textDim">
                Record something you paid out
              </AppText>
            </Press>
          </Animated.View>
        </>
      ) : null}

      {/* ------------------------------------------------------- simulator */}
      {/*
        Hidden until there is something to reason from.

        It works out the effect of a price change "per person from how long they
        have been with you and how they pay" — which on day one is nobody, for no
        money. Offering it then advertises an answer the app cannot produce, and
        the first thing a new owner would learn is that a feature is empty.
      */}
      {data.parties.length > 0 && data.money.some((m) => m.direction === 'in') ? (
      <Animated.View entering={enter(5)} style={[styles.gutter, styles.block]}>
        <Press
          haptic="medium"
          scaleTo={0.97}
          onPress={() => setSimSheet(true)}
          style={[styles.simEntry, { backgroundColor: colors.surface }]}>
          <SlidersHorizontal size={17} color={colors.accent} strokeWidth={2} />
          <View style={styles.simBody}>
            <AppText variant="callout">What if you changed your prices?</AppText>
            <AppText variant="caption" color="textFaint">
              Worked out per person from how long they have been with you and how they pay
            </AppText>
          </View>
          <ArrowRight size={16} color={colors.textFaint} strokeWidth={2.2} />
        </Press>
      </Animated.View>
      ) : null}

      <Sheet
        visible={simSheet}
        onClose={() => setSimSheet(false)}
        size="tall"
        eyebrow="Price change"
        title={`${changePct > 0 ? '+' : ''}${changePct}%`}>
        <Slider
          value={changePct}
          onChange={setChangePct}
          min={-20}
          max={40}
          step={1}
          label="Change"
        />

        {sim ? (
          <>
            <View style={styles.simRows}>
              <SimRow label="Now, per year" value={money(sim.currentAnnual)} />
              <SimRow
                label="If nobody left"
                value={money(sim.naive)}
                tint={colors.textFaint}
                note="The figure you have already worked out in your head"
              />
              <SimRow
                label="Likely, after departures"
                value={money(sim.expected)}
                tint={sim.expected >= sim.currentAnnual ? colors.success : colors.warn}
              />
              <SimRow label="Likely to leave" value={`${sim.likelyToLeave} people`} />
            </View>

            <View style={[styles.verdict, { backgroundColor: colors.accentSoft }]}>
              <AppText variant="footnote">{sim.verdict}</AppText>
            </View>

            <AppText variant="caption" color="textFaint" style={styles.simNote}>
              Each person's tolerance is estimated from their own record — how long they have been
              with you, how often they come, and whether they pay on time. Someone here two years who
              comes weekly absorbs a rise; someone who already comes irregularly and pays late does
              not. A price cut is modelled as revenue forgone only: guessing how many new customers a
              discount would attract would be invention.
            </AppText>
          </>
        ) : null}
      </Sheet>
    </LargeTitleScreen>
  );
}

function SimRow({
  label,
  value,
  tint,
  note,
}: {
  label: string;
  value: string;
  tint?: string;
  note?: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.simRow, { borderBottomColor: colors.hairline }]}>
      <View style={styles.simRowBody}>
        <AppText variant="callout">{label}</AppText>
        {note ? (
          <AppText variant="caption" color="textFaint">
            {note}
          </AppText>
        ) : null}
      </View>
      <AppText variant="callout" tabular tint={tint}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  gutter: { paddingHorizontal: space.gutter },
  block: { marginTop: space.lg },
  tabs: { marginTop: space.lg },

  add: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  breakEven: { borderRadius: radius.lg, padding: space.base, gap: space.md, marginTop: space.md },
  hero: { borderRadius: radius.lg, padding: space.lg },
  heroValue: { marginTop: space.xs, marginBottom: space.md },
  heroNote: { marginTop: space.sm, lineHeight: 18 },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },

  forecast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.base,
    paddingTop: space.base,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  forecastBody: { flex: 1, gap: 1 },
  pill: { paddingHorizontal: space.md, height: 28, borderRadius: radius.pill, justifyContent: 'center' },

  agingCard: { borderRadius: radius.lg, padding: space.base, gap: space.md },
  agingLegend: { flexDirection: 'row', gap: space.sm },
  agingItem: { flex: 1, gap: 1 },
  spendBars: { marginTop: space.xs },

  list: { paddingHorizontal: space.gutter, gap: space.sm, marginTop: space.base },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  rowBody: { flex: 1, gap: 2 },
  tick: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 50,
    borderRadius: radius.pill,
  },
  ctaGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },

  simEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.lg,
  },
  simBody: { flex: 1, gap: 2 },
  simRows: { marginTop: space.lg },
  simRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  simRowBody: { flex: 1, gap: 2 },
  verdict: { padding: space.base, borderRadius: radius.md, marginTop: space.base },
  simNote: { marginTop: space.base, lineHeight: 17 },
});
