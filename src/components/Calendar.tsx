import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { monthGrid, type CalendarCell } from '@/domain/schedule';
import type { BusinessData } from '@/domain/model';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { monthName } from '@/lib/time';

const HEAD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * A month of scheduled sessions.
 *
 * Density is shown as dots rather than numbers. A count in every cell turns the
 * grid into a spreadsheet you have to read cell by cell; dots are legible as a
 * shape, and the shape is the useful part — you can see at a glance that the
 * middle of the month is heavy and the last week is empty without reading
 * anything at all.
 *
 * The exact count is one tap away, which is the right place for it.
 */
export function Calendar({
  data,
  monthOf,
  selected,
  now,
  onSelect,
  onMonth,
}: {
  data: BusinessData;
  /** Any timestamp within the month being shown. */
  monthOf: number;
  selected: number;
  now: number;
  onSelect: (date: number) => void;
  onMonth: (delta: -1 | 1) => void;
}) {
  const colors = useColors();
  const cells = useMemo(() => monthGrid(data, monthOf, now), [data, monthOf, now]);
  const anchor = new Date(monthOf);

  // Rows rather than a flat wrap: a 7-column flex wrap re-flows unpredictably
  // when a cell's content changes width, and a calendar that shifts is useless.
  const rows = useMemo(() => {
    const out: CalendarCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [cells]);

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <View style={styles.head}>
        <Press
          haptic="light"
          scaleTo={0.9}
          onPress={() => onMonth(-1)}
          accessibilityLabel="Previous month"
          style={styles.arrow}>
          <ChevronLeft size={18} color={colors.textDim} strokeWidth={2.2} />
        </Press>

        <AppText variant="title3">
          {monthName(anchor.getMonth())} {anchor.getFullYear()}
        </AppText>

        <Press
          haptic="light"
          scaleTo={0.9}
          onPress={() => onMonth(1)}
          accessibilityLabel="Next month"
          style={styles.arrow}>
          <ChevronRight size={18} color={colors.textDim} strokeWidth={2.2} />
        </Press>
      </View>

      <View style={styles.week}>
        {HEAD.map((letter, i) => (
          <View key={i} style={styles.cell}>
            <AppText variant="caption" color="textFaint">
              {letter}
            </AppText>
          </View>
        ))}
      </View>

      {rows.map((row, r) => (
        <View key={r} style={styles.week}>
          {row.map((cell) => {
            const isSelected = cell.date === selected;
            const day = new Date(cell.date).getDate();

            return (
              <Press
                key={cell.date}
                haptic="selection"
                scaleTo={0.88}
                onPress={() => onSelect(cell.date)}
                accessibilityLabel={`${day} ${monthName(new Date(cell.date).getMonth())}, ${
                  cell.closed ? `closed for ${cell.closed}` : `${cell.count} scheduled`
                }`}
                accessibilityState={{ selected: isSelected }}
                style={styles.cell}>
                <View
                  style={[
                    styles.day,
                    isSelected && { backgroundColor: colors.accent },
                    !isSelected && cell.isToday && { borderColor: colors.accent, borderWidth: 1.5 },
                  ]}>
                  <AppText
                    variant="footnote"
                    tabular
                    tint={
                      isSelected
                        ? colors.accentText
                        : cell.inMonth
                          ? cell.closed
                            ? colors.textFaint
                            : colors.text
                          : colors.textFaint
                    }
                    style={!cell.inMonth && styles.outside}>
                    {day}
                  </AppText>
                </View>

                {/* Up to three dots, then a plus. Beyond three the exact number
                    stops being readable at this size anyway. */}
                <View style={styles.dots}>
                  {cell.closed ? (
                    <View style={[styles.bar, { backgroundColor: colors.textFaint }]} />
                  ) : (
                    Array.from({ length: Math.min(cell.count, 3) }, (_, i) => (
                      <View
                        key={i}
                        style={[
                          styles.dot,
                          {
                            backgroundColor: isSelected ? colors.accent : colors.textDim,
                            opacity: cell.inMonth ? 1 : 0.35,
                          },
                        ]}
                      />
                    ))
                  )}
                </View>
              </Press>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderRadius: radius.lg, padding: space.base },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  arrow: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  week: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3, gap: 3 },
  day: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outside: { opacity: 0.45 },
  // Fixed height so a day with no sessions occupies the same space as one with
  // three, and rows never shift as the month changes.
  dots: { flexDirection: 'row', gap: 2, height: 5, alignItems: 'center' },
  dot: { width: 4, height: 4, borderRadius: radius.pill },
  bar: { width: 12, height: 2, borderRadius: radius.pill },
});
