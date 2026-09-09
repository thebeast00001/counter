import { useRouter } from 'expo-router';
import { ArrowLeft, Check, Plus, RefreshCw } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { money } from '@/domain/metrics';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatDayMonth, useTick } from '@/lib/time';
import { useBarInset } from '@/state/dock';
import { useBusiness } from '@/state/business';
import { useUndo } from '@/state/undo';

const DAY = 24 * 60 * 60 * 1000;

const REPEATS = [
  { label: 'Once', days: null },
  { label: 'Monthly', days: 30 },
  { label: 'Quarterly', days: 91 },
  { label: 'Yearly', days: 365 },
];

/**
 * The things that cost money for being late rather than for being wrong.
 *
 * Rent, licences, tax, insurance. They are separated from ordinary tasks because
 * they behave differently: they recur on a schedule, they carry a penalty, and
 * they need to be raised *before* the date rather than shown as overdue after
 * it — which is what almost every reminder app gets backwards.
 */
export default function ObligationsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { offerUndo } = useUndo();
  const { profile, data, addObligation, completeObligation, reopenObligation } = useBusiness();
  const now = useTick(60_000);

  const [sheet, setSheet] = useState(false);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [inDays, setInDays] = useState('30');
  const [repeat, setRepeat] = useState<number | null>(30);

  const { pending, done } = useMemo(() => {
    const sorted = [...data.obligations].sort((a, b) => a.dueAt - b.dueAt);
    return {
      pending: sorted.filter((o) => !o.done),
      done: sorted.filter((o) => o.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, 10),
    };
  }, [data.obligations]);

  if (!profile) return null;

  const valid = label.trim().length >= 2 && Number(inDays) > 0;

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
        <View style={styles.barBody}>
          <AppText variant="title3">Coming up</AppText>
          <AppText variant="caption" color="textFaint">
            {pending.length} outstanding
          </AppText>
        </View>
        <Press
          haptic="medium"
          scaleTo={0.9}
          onPress={() => setSheet(true)}
          accessibilityLabel="Add something"
          style={[styles.iconButton, { backgroundColor: colors.accent }]}>
          <Plus size={18} color={colors.accentText} strokeWidth={2.6} />
        </Press>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        <View style={styles.list}>
          {pending.length === 0 ? (
            <View style={[styles.row, { backgroundColor: colors.surface }]}>
              <AppText variant="footnote" color="textFaint">
                Nothing due. Rent, licences and tax go here so they arrive before the date rather
                than after it.
              </AppText>
            </View>
          ) : (
            pending.map((item, i) => {
              const days = Math.ceil((item.dueAt - now) / DAY);
              const late = days < 0;
              const soon = days >= 0 && days <= (item.leadDays ?? 3);

              return (
                <Animated.View key={item.id} entering={enter(i)}>
                  <View
                    style={[
                      styles.row,
                      {
                        backgroundColor: colors.surface,
                        borderColor: late ? colors.warn : 'transparent',
                        borderWidth: late ? 1 : 0,
                      },
                    ]}>
                    <View style={styles.rowBody}>
                      <AppText variant="callout">{item.label}</AppText>
                      <AppText
                        variant="caption"
                        tint={late || soon ? colors.warn : colors.textFaint}>
                        {late
                          ? `${Math.abs(days)} days overdue`
                          : days === 0
                            ? 'Due today'
                            : `Due in ${days} days · ${formatDayMonth(item.dueAt)}`}
                        {item.repeatDays ? ' · repeats' : ''}
                      </AppText>
                    </View>

                    {item.amount ? (
                      <AppText variant="callout" tabular color="textDim">
                        {money(item.amount)}
                      </AppText>
                    ) : null}

                    <Press
                      haptic="medium"
                      scaleTo={0.88}
                      onPress={() => {
                        completeObligation(item.id);
                        offerUndo(`${item.label} done`, () => reopenObligation(item.id));
                      }}
                      accessibilityLabel={`Mark ${item.label} done`}
                      style={[styles.tick, { backgroundColor: colors.successSoft }]}>
                      <Check size={16} color={colors.success} strokeWidth={2.6} />
                    </Press>
                  </View>
                </Animated.View>
              );
            })
          )}
        </View>

        {done.length > 0 ? (
          <Animated.View entering={enter(2)} style={[styles.gutter, styles.block]}>
            <AppText variant="caption" color="textFaint" style={styles.label}>
              RECENTLY DONE
            </AppText>
            <View style={styles.rows}>
              {done.map((item) => (
                <View key={item.id} style={styles.doneRow}>
                  {item.repeatDays ? (
                    <RefreshCw size={13} color={colors.textFaint} strokeWidth={2} />
                  ) : (
                    <Check size={13} color={colors.textFaint} strokeWidth={2.4} />
                  )}
                  <AppText variant="caption" color="textFaint" style={styles.doneLabel}>
                    {item.label}
                  </AppText>
                  <AppText variant="caption" color="textFaint">
                    {item.doneAt ? formatDayMonth(item.doneAt) : ''}
                  </AppText>
                </View>
              ))}
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>

      <Sheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title="What is coming up?"
        footer={
          <Press
            haptic="medium"
            scaleTo={0.97}
            disabled={!valid}
            onPress={() => {
              const value = Number(amount.replace(/[^0-9.]/g, ''));
              addObligation({
                kind: 'custom',
                label: label.trim(),
                dueAt: Date.now() + Number(inDays) * DAY,
                repeatDays: repeat,
                leadDays: repeat === 365 ? 30 : 5,
                amount: value > 0 ? value : undefined,
              });
              setLabel('');
              setAmount('');
              setSheet(false);
            }}
            style={[styles.cta, { backgroundColor: colors.accent }]}>
            <AppText variant="callout" tint={colors.accentText}>
              Add it
            </AppText>
          </Press>
        }>
        <View style={styles.form}>
          <TextField
            placeholder="Rent · trade licence · insurance"
            value={label}
            onChangeText={setLabel}
            autoFocus
          />
          <TextField
            placeholder="Amount (optional)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
          />
          <TextField
            label="Due in how many days"
            value={inDays}
            onChangeText={setInDays}
            keyboardType="numeric"
          />

          <AppText variant="caption" color="textFaint">
            HOW OFTEN
          </AppText>
          <View style={styles.chips}>
            {REPEATS.map((option) => {
              const selected = repeat === option.days;
              return (
                <Press
                  key={option.label}
                  haptic="selection"
                  scaleTo={0.95}
                  onPress={() => setRepeat(option.days)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.chip,
                    { backgroundColor: selected ? colors.accent : colors.surfaceHigh },
                  ]}>
                  <AppText variant="footnote" tint={selected ? colors.accentText : colors.text}>
                    {option.label}
                  </AppText>
                </Press>
              );
            })}
          </View>

          <AppText variant="caption" color="textFaint" style={styles.note}>
            Recurring ones create the next instance as soon as you tick this one off, so the chain
            never breaks.
          </AppText>
        </View>
      </Sheet>
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
  barBody: { flex: 1, gap: 1 },
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
  rowBody: { flex: 1, gap: 2 },
  tick: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  doneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  doneLabel: { flex: 1 },

  form: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.base,
    height: 36,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  note: { lineHeight: 16 },

  cta: { height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
