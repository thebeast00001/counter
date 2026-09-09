import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Bars, Heatmap } from '@/components/Charts';
import { Press } from '@/components/Press';
import { activeHourRange, capacityGrid, noShows } from '@/domain/analytics';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatTime, useTick } from '@/lib/time';
import { useBarInset } from '@/state/dock';
import { useBusiness } from '@/state/business';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * When you are full and when you are empty.
 *
 * Every hour costs the same rent. This is the screen that makes that visible,
 * and the single most common reaction to it is an owner realising they have been
 * turning people away on Saturday while Tuesday afternoon sits at a fifth full.
 */
export default function CapacityScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { profile, data, term } = useBusiness();
  const now = useTick(3_600_000);

  const cells = useMemo(() => capacityGrid(data, now), [data, now]);
  const range = useMemo(() => activeHourRange(cells), [cells]);
  const missed = useMemo(() => noShows(data, now), [data, now]);

  const [picked, setPicked] = useState<{ day: number; hour: number; value: number } | null>(null);

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = range.from; h <= range.to; h++) out.push(h);
    return out;
  }, [range]);

  const heatCells = useMemo(
    () =>
      cells
        .filter((c) => c.hour >= range.from && c.hour <= range.to)
        .map((c) => ({ row: c.weekday, col: c.hour - range.from, value: c.count })),
    [cells, range],
  );

  const byDay = useMemo(() => {
    const totals = new Array(7).fill(0);
    for (const c of cells) totals[c.weekday] += c.count;
    return totals;
  }, [cells]);

  if (!profile) return null;

  const total = cells.reduce((s, c) => s + c.count, 0);
  const busiest = cells[0];
  const peakDay = Math.max(...byDay, 1);

  const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;

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
          <AppText variant="title3">Your week</AppText>
          <AppText variant="caption" color="textFaint">
            {total} {term('engagement', true).toLowerCase()} over 8 weeks
          </AppText>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        {total < 10 ? (
          <View style={styles.gutter}>
            <AppText variant="body" color="textDim">
              Not enough recorded yet to show a pattern. This fills in after a couple of weeks of
              records.
            </AppText>
          </View>
        ) : (
          <>
            <Animated.View entering={enter(0)} style={styles.gutter}>
              <View style={[styles.card, { backgroundColor: colors.surface }]}>
                <Heatmap
                  cells={heatCells}
                  rows={7}
                  cols={hours.length}
                  rowLabels={DAYS}
                  colLabels={hours.map(hourLabel)}
                  onPressCell={(row, col, value) =>
                    setPicked({ day: row, hour: hours[col], value })
                  }
                />

                <AppText variant="footnote" color="textDim" style={styles.note}>
                  {picked
                    ? picked.value === 0
                      ? `${DAYS[picked.day]} at ${formatTime(new Date().setHours(picked.hour, 0, 0, 0))} has had nothing in eight weeks.`
                      : `${DAYS[picked.day]} at ${formatTime(new Date().setHours(picked.hour, 0, 0, 0))}: ${picked.value} over eight weeks, about ${(picked.value / 8).toFixed(1)} a week.`
                    : `Busiest is ${DAYS[busiest.weekday]} at ${formatTime(new Date().setHours(busiest.hour, 0, 0, 0))}. Tap any square.`}
                </AppText>
              </View>
            </Animated.View>

            <Animated.View entering={enter(1)} style={[styles.gutter, styles.block]}>
              <AppText variant="caption" color="textFaint" style={styles.label}>
                BY DAY
              </AppText>
              <View style={[styles.card, { backgroundColor: colors.surface }]}>
                <Bars
                  bars={byDay.map((count, i) => ({
                    label: DAYS[i].slice(0, 1),
                    value: count,
                    highlight: count === peakDay,
                  }))}
                  height={84}
                />
              </View>
            </Animated.View>

            <Animated.View entering={enter(2)} style={[styles.gutter, styles.block]}>
              <View style={[styles.card, { backgroundColor: colors.surface }]}>
                <AppText variant="footnote" color="textDim" style={styles.explain}>
                  Every hour on this grid costs the same rent. A pale square is not a gap in the
                  data — it is time you are already paying for.
                  {missed.count > 0
                    ? ` On top of that, ${missed.count} booked slots went unused in the same period.`
                    : ''}
                </AppText>
              </View>
            </Animated.View>
          </>
        )}
      </ScrollView>
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
  card: { padding: space.base, borderRadius: radius.lg },
  note: { marginTop: space.base, lineHeight: 18 },
  explain: { lineHeight: 18 },
});
