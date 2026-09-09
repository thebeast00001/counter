import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Merge, Plus, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Segmented } from '@/components/Segmented';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { Toggle } from '@/components/Toggle';
import { findDuplicates } from '@/domain/intel';
import { money } from '@/domain/metrics';
import type { ExpenseCategory } from '@/domain/model';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatDayMonth } from '@/lib/time';
import { useBarInset } from '@/state/dock';
import { useBusiness } from '@/state/business';
import { useUndo } from '@/state/undo';

/**
 * Team and timetable have moved to screens of their own.
 *
 * Both outgrew a segmented tab: a staff row now carries retention, assigned
 * people and what they run, and a schedule needs a calendar beside it. Leaving
 * them here would have meant shrinking each to fit the smallest of the four.
 */
type Tab = 'offerings' | 'costs';

/**
 * The records the business is built from, as opposed to the records it produces.
 *
 * Kept behind Settings on purpose. These are set up once and then rarely touched,
 * and putting them on a tab would give permanent prominence to the least-used
 * part of the app.
 */
export default function ManageScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const params = useLocalSearchParams<{ tab?: Tab }>();

  const {
    profile,
    data,
    addOffering,
    updateOffering,
    addFixedCost,
    removeFixedCost,
    merge,
    snapshot,
    replaceAll,
  } = useBusiness();
  const { offerUndo } = useUndo();

  const [tab, setTab] = useState<Tab>(params.tab ?? 'offerings');
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');

  const duplicates = useMemo(() => findDuplicates(data), [data]);

  if (!profile) return null;

  const title: Record<Tab, string> = {
    offerings: 'What you sell',
    costs: 'Fixed costs',
  };

  const save = () => {
    const value = Number(amount.replace(/[^0-9.]/g, ''));
    if (name.trim().length < 2) return;

    if (tab === 'offerings') {
      addOffering({ name: name.trim(), price: value, durationDays: null, active: true });
    } else {
      if (value <= 0) return;
      addFixedCost({ label: name.trim(), amount: value, category: 'other' as ExpenseCategory });
    }
    setName('');
    setAmount('');
    setSheet(false);
  };

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
        <AppText variant="title3" style={styles.barTitle} numberOfLines={1}>
          {title[tab]}
        </AppText>
        <Press
          haptic="medium"
          scaleTo={0.9}
          onPress={() => setSheet(true)}
          accessibilityLabel={`Add to ${title[tab].toLowerCase()}`}
          style={[styles.iconButton, { backgroundColor: colors.accent }]}>
          <Plus size={18} color={colors.accentText} strokeWidth={2.6} />
        </Press>
      </View>

      <View style={styles.gutter}>
        <Segmented<Tab>
          options={[
            { value: 'offerings', label: 'What you sell' },
            { value: 'costs', label: 'Fixed costs' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        <Animated.View key={tab} entering={enter(0)} style={styles.list}>
          {/* ------------------------------------------------------ offerings */}
          {tab === 'offerings'
            ? data.offerings.map((offering) => (
                <View key={offering.id} style={[styles.row, { backgroundColor: colors.surface }]}>
                  <View style={styles.rowBody}>
                    <AppText variant="callout">{offering.name}</AppText>
                    <AppText variant="caption" color="textFaint">
                      {money(offering.price)}
                      {offering.durationDays ? ` · ${offering.durationDays} days` : ' · one-off'}
                    </AppText>
                  </View>
                  <Toggle
                    value={offering.active !== false}
                    onChange={(next) => updateOffering(offering.id, { active: next })}
                  />
                </View>
              ))
            : null}

          {/* ---------------------------------------------------------- costs */}
          {tab === 'costs' ? (
            <>
              {data.fixedCosts.length === 0 ? (
                <Empty text="Nothing set. Rent, wages and bills go here — they are what the break-even line is worked out from." />
              ) : (
                data.fixedCosts.map((cost) => (
                  <View key={cost.id} style={[styles.row, { backgroundColor: colors.surface }]}>
                    <View style={styles.rowBody}>
                      <AppText variant="callout">{cost.label}</AppText>
                      <AppText variant="caption" color="textFaint">
                        {money(cost.amount)} a month
                        {cost.dayOfMonth ? ` · due on the ${cost.dayOfMonth}` : ''}
                      </AppText>
                    </View>
                    <Press
                      haptic="light"
                      scaleTo={0.9}
                      onPress={() => {
                        removeFixedCost(cost.id);
                        offerUndo(`${cost.label} removed`, () =>
                          addFixedCost({
                            label: cost.label,
                            amount: cost.amount,
                            category: cost.category,
                            dayOfMonth: cost.dayOfMonth,
                          }),
                        );
                      }}
                      accessibilityLabel={`Remove ${cost.label}`}
                      style={styles.remove}>
                      <Trash2 size={16} color={colors.textFaint} strokeWidth={2} />
                    </Press>
                  </View>
                ))
              )}
              {data.fixedCosts.length > 0 ? (
                <AppText variant="caption" color="textFaint" style={styles.total}>
                  {money(data.fixedCosts.reduce((s, f) => s + f.amount, 0))} a month before you serve
                  anybody.
                </AppText>
              ) : null}
            </>
          ) : null}

        </Animated.View>

        {/* ---------------------------------------------------- duplicates -- */}
        {duplicates.length > 0 ? (
          <Animated.View entering={enter(1)} style={[styles.gutter, styles.block]}>
            <AppText variant="caption" color="textFaint" style={styles.label}>
              POSSIBLE DUPLICATES
            </AppText>
            <View style={styles.rows}>
              {duplicates.slice(0, 6).map((pair) => (
                <View
                  key={`${pair.a.id}|${pair.b.id}`}
                  style={[styles.card, { backgroundColor: colors.surface }]}>
                  <AppText variant="callout">
                    {pair.a.name} and {pair.b.name}
                  </AppText>
                  <AppText variant="caption" color="textFaint">
                    {pair.reason} · joined {formatDayMonth(pair.a.joinedAt)} and{' '}
                    {formatDayMonth(pair.b.joinedAt)}
                  </AppText>
                  <Press
                    haptic="medium"
                    scaleTo={0.96}
                    onPress={() => {
                      // The older record wins: the relationship started when it started.
                      const keeper = pair.a.joinedAt <= pair.b.joinedAt ? pair.a : pair.b;
                      const loser = keeper.id === pair.a.id ? pair.b : pair.a;
                      // A merge folds two histories together and cannot be
                      // unpicked field by field, so undo restores the whole
                      // record set as it stood a moment ago.
                      const before = snapshot();
                      merge(keeper.id, loser.id);
                      offerUndo(`Merged into ${keeper.name}`, () => replaceAll(before));
                    }}
                    style={[styles.mergeCta, { backgroundColor: colors.accentSoft }]}>
                    <Merge size={14} color={colors.accent} strokeWidth={2.2} />
                    <AppText variant="caption" tint={colors.accent}>
                      Merge into the older record
                    </AppText>
                  </Press>
                </View>
              ))}
            </View>
            <AppText variant="caption" color="textFaint" style={styles.total}>
              Merging keeps every visit and payment from both sides. Two siblings with the same
              surname are not a duplicate — check before merging.
            </AppText>
          </Animated.View>
        ) : null}
      </ScrollView>

      <Sheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title={`Add to ${title[tab].toLowerCase()}`}
        footer={
          <Press
            haptic="medium"
            scaleTo={0.97}
            disabled={name.trim().length < 2}
            onPress={save}
            style={[styles.cta, { backgroundColor: colors.accent }]}>
            <AppText variant="callout" tint={colors.accentText}>
              Add
            </AppText>
          </Press>
        }>
        <View style={styles.form}>
          <TextField
            placeholder={tab === 'costs' ? 'Rent, wages, bills' : 'What it is called'}
            value={name}
            onChangeText={setName}
            autoFocus
          />
          <TextField
            placeholder={tab === 'costs' ? 'How much a month' : 'Price'}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
          />
        </View>
      </Sheet>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <AppText variant="footnote" color="textFaint" style={styles.emptyText}>
        {text}
      </AppText>
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

  scroll: { paddingTop: space.base },
  gutter: { paddingHorizontal: space.gutter },
  block: { marginTop: space.xl },
  label: { letterSpacing: 0.9, marginBottom: space.sm },

  list: { paddingHorizontal: space.gutter, gap: space.sm },
  rows: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowBody: { flex: 1, gap: 2 },
  card: { padding: space.base, borderRadius: radius.lg, gap: space.md },
  emptyText: { lineHeight: 18 },
  remove: { padding: space.xs },
  total: { marginTop: space.md, lineHeight: 17 },

  accessNote: { lineHeight: 16 },

  weekdays: { flexDirection: 'row', gap: space.xs },
  weekday: {
    flex: 1,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  mergeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    height: 32,
    borderRadius: radius.pill,
  },

  form: { gap: space.md },
  cta: { height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
