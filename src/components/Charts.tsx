import { useMemo } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useState } from 'react';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';

/**
 * The chart vocabulary.
 *
 * Deliberately small and deliberately plain. Every one of these renders without
 * a legend, an axis label or a tooltip, because on a phone held in one hand
 * between customers, a chart either reads in one second or does not get read.
 * Detail lives behind a long press, not on the surface.
 */

/* ------------------------------------------------------------- sparkline -- */

export function Sparkline({
  values,
  height = 44,
  tint,
  fill = true,
  /** Called with the index under the finger while scrubbing, null on release. */
  onScrub,
  /** Draws a dotted line at this value — the "normal" the shape is judged against. */
  reference,
}: {
  values: number[];
  height?: number;
  tint?: string;
  fill?: boolean;
  onScrub?: (index: number | null) => void;
  reference?: number;
}) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const stroke = tint ?? colors.accent;

  const { line, area, refY, step } = useMemo(() => {
    if (width <= 0 || values.length < 2) return { line: '', area: '', refY: null, step: 0 };

    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const step = width / (values.length - 1);
    const y = (v: number) => height - ((v - min) / range) * (height - 4) - 2;

    // Smoothed with a midpoint quadratic rather than straight segments: raw
    // daily takings are spiky enough that a polyline reads as noise.
    let d = `M0,${y(values[0]).toFixed(2)}`;
    for (let i = 1; i < values.length; i++) {
      const px = (i - 1) * step;
      const cx = i * step;
      const mx = (px + cx) / 2;
      d += ` Q${mx.toFixed(2)},${y(values[i - 1]).toFixed(2)} ${mx.toFixed(2)},${((y(values[i - 1]) + y(values[i])) / 2).toFixed(2)}`;
      d += ` Q${mx.toFixed(2)},${y(values[i]).toFixed(2)} ${cx.toFixed(2)},${y(values[i]).toFixed(2)}`;
    }

    return {
      line: d,
      area: `${d} L${width},${height} L0,${height} Z`,
      refY: reference === undefined ? null : y(reference),
      step,
    };
  }, [values, width, height, reference]);

  /**
   * Scrubbing reads the finger position directly rather than going through a
   * gesture handler. A pan here would compete with the parent ScrollView for the
   * same vertical drag, and the chart would win — leaving the page unable to
   * scroll wherever a sparkline happened to be.
   */
  const scrubTo = (locationX: number) => {
    if (step <= 0) return;
    const index = Math.max(0, Math.min(values.length - 1, Math.round(locationX / step)));
    setCursor(index);
    onScrub?.(index);
  };

  const release = () => {
    setCursor(null);
    onScrub?.(null);
  };

  return (
    <View
      style={{ height }}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => Boolean(onScrub)}
      onMoveShouldSetResponder={() => Boolean(onScrub)}
      onResponderGrant={(e) => scrubTo(e.nativeEvent.locationX)}
      onResponderMove={(e) => scrubTo(e.nativeEvent.locationX)}
      onResponderRelease={release}
      onResponderTerminate={release}>
      {width > 0 && line ? (
        <Svg width={width} height={height}>
          {fill ? (
            <>
              <Defs>
                <LinearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={stroke} stopOpacity="0.22" />
                  <Stop offset="1" stopColor={stroke} stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Path d={area} fill="url(#spark)" />
            </>
          ) : null}

          {/* What a normal period looks like, so the line has something to be
              above or below rather than just a shape. */}
          {refY !== null ? (
            <Line
              x1={0}
              y1={refY}
              x2={width}
              y2={refY}
              stroke={colors.textFaint}
              strokeWidth={1}
              strokeDasharray="3 4"
            />
          ) : null}

          <Path d={line} stroke={stroke} strokeWidth={2} fill="none" strokeLinecap="round" />

          {cursor !== null ? (
            <>
              <Line
                x1={cursor * step}
                y1={0}
                x2={cursor * step}
                y2={height}
                stroke={colors.textDim}
                strokeWidth={1}
              />
              <Circle cx={cursor * step} cy={height / 2} r={0} fill="none" />
            </>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ bars -- */

export type Bar = {
  label?: string;
  value: number;
  highlight?: boolean;
  /** A dated event that happened in this period — pinned as a marker above the bar. */
  marker?: string;
};

export function Bars({
  bars,
  height = 96,
  onPressBar,
  tint,
  /** Formats the value printed above the tallest bar. Omit to print nothing. */
  formatPeak,
  /** Draws a dotted line across the chart at this value. */
  reference,
  referenceLabel,
}: {
  bars: Bar[];
  height?: number;
  onPressBar?: (index: number) => void;
  tint?: string;
  formatPeak?: (value: number) => string;
  reference?: number;
  referenceLabel?: string;
}) {
  const colors = useColors();
  const peak = Math.max(...bars.map((b) => b.value), 1);
  const peakIndex = bars.findIndex((b) => b.value === peak);
  const accent = tint ?? colors.accent;

  /**
   * The label row is reserved for every bar as soon as any bar has one.
   *
   * Rendering it only where a label exists made that one cell taller, and since
   * the cells bottom-align, its bar floated above the rest of the chart. The
   * label also has to be locked to a single line: at twelve bars a cell is about
   * twenty-six points wide, and "now" wrapped one letter per line, printing
   * itself vertically down the axis.
   */
  const labelled = bars.some((b) => b.label);
  const LABEL_ROW = 21;
  // A value row above the chart, present only when something needs to print in
  // it, so an unlabelled chart is not padded for nothing.
  const PEAK_ROW = formatPeak ? 18 : 0;

  return (
    <View>
      {/* Scale, stated once on the tallest bar. A full axis costs four labels
          and a gridline to say what one number says here. */}
      {/*
        One cell per bar, exactly mirroring the row below — same `flex: 1`, same
        gap — with the figure centred in the tallest bar's own cell.

        It used to be a fixed-width label between two flex spacers sized
        `peakIndex + 0.5` and `bars.length - peakIndex - 1.5`. That cannot line
        up: flex distributes the space *left over after* the text is laid out, so
        the label's left edge lands at a fraction of the remaining width rather
        than its centre landing over the bar. The error grows with the label —
        "₹1.4L" over a twelve-bar chart sat most of a cell to the left of the bar
        it described, which is the sort of thing that makes a reader distrust the
        chart without being able to say why.
      */}
      {formatPeak ? (
        <View style={[styles.peakRow, { height: PEAK_ROW }]}>
          {bars.map((_, i) => (
            <View key={i} style={styles.peakCell}>
              {i === peakIndex ? (
                <AppText variant="caption" color="textFaint" tabular numberOfLines={1}>
                  {formatPeak(peak)}
                </AppText>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.bars, { height: height + (labelled ? LABEL_ROW : 0) }]}>
        {reference !== undefined && reference > 0 ? (
          <View
            pointerEvents="none"
            style={[
              styles.reference,
              {
                bottom: (labelled ? LABEL_ROW : 0) + Math.min((reference / peak) * height, height),
                borderColor: colors.textFaint,
              },
            ]}
          />
        ) : null}

        {bars.map((bar, i) => {
          const body = (
            <>
              <View style={styles.barTrack}>
                {bar.marker ? (
                  <View style={[styles.marker, { backgroundColor: colors.warn }]} />
                ) : null}
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max((bar.value / peak) * height, 3),
                      backgroundColor: bar.highlight ? accent : colors.surfaceHigh,
                    },
                  ]}
                />
              </View>
              {labelled ? (
                <View style={styles.barLabel}>
                  <AppText variant="caption" color="textFaint" numberOfLines={1}>
                    {bar.label ?? ''}
                  </AppText>
                </View>
              ) : null}
            </>
          );

          return onPressBar ? (
            <Press
              key={i}
              haptic="selection"
              scaleTo={0.93}
              onPress={() => onPressBar(i)}
              style={styles.barCell}
              accessibilityLabel={`${bar.label ?? `Period ${i + 1}`}: ${
                formatPeak ? formatPeak(bar.value) : bar.value
              }${bar.marker ? `. ${bar.marker}` : ''}`}>
              {body}
            </Press>
          ) : (
            <View key={i} style={styles.barCell}>
              {body}
            </View>
          );
        })}
      </View>

      {referenceLabel && reference !== undefined && reference > 0 ? (
        <AppText variant="caption" color="textFaint" style={styles.referenceLabel}>
          {referenceLabel}
        </AppText>
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------------- heatmap -- */

export type HeatCell = { row: number; col: number; value: number };

/**
 * Weekday × hour density.
 *
 * Colour carries the whole message, so it runs from the surface colour to the
 * accent rather than through a rainbow — a hue ramp looks scientific and is
 * unreadable at this size.
 */
export function Heatmap({
  cells,
  rows,
  cols,
  rowLabels,
  colLabels,
  onPressCell,
}: {
  cells: HeatCell[];
  rows: number;
  cols: number;
  rowLabels: string[];
  colLabels: string[];
  onPressCell?: (row: number, col: number, value: number) => void;
}) {
  const colors = useColors();
  const lookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of cells) map.set(`${c.row}:${c.col}`, c.value);
    return map;
  }, [cells]);

  const peak = Math.max(...cells.map((c) => c.value), 1);

  return (
    <View style={styles.heat}>
      <View style={styles.heatHeader}>
        <View style={styles.heatRowLabel} />
        {colLabels.map((label, i) => (
          <View key={i} style={styles.heatCellWrap}>
            <AppText variant="caption" color="textFaint" numberOfLines={1}>
              {label}
            </AppText>
          </View>
        ))}
      </View>

      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={styles.heatRow}>
          <View style={styles.heatRowLabel}>
            <AppText variant="caption" color="textFaint">
              {rowLabels[r]}
            </AppText>
          </View>
          {Array.from({ length: cols }, (_, c) => {
            const value = lookup.get(`${r}:${c}`) ?? 0;
            const intensity = value / peak;
            const cell = (
              <View
                style={[
                  styles.heatCell,
                  {
                    backgroundColor:
                      value === 0
                        ? colors.surface
                        : colors.accent,
                    opacity: value === 0 ? 0.5 : 0.25 + intensity * 0.75,
                  },
                ]}
              />
            );
            return onPressCell ? (
              <Press
                key={c}
                haptic="selection"
                scaleTo={0.85}
                onPress={() => onPressCell(r, c, value)}
                style={styles.heatCellWrap}
                accessibilityLabel={`${rowLabels[r]} ${colLabels[c]}: ${value}`}>
                {cell}
              </Press>
            ) : (
              <View key={c} style={styles.heatCellWrap}>
                {cell}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/* ----------------------------------------------------------- cohort grid -- */

export function CohortGrid({
  rows,
}: {
  rows: { label: string; size: number; retention: number[] }[];
}) {
  const colors = useColors();
  const width = Math.max(...rows.map((r) => r.retention.length), 1);

  return (
    <View style={styles.cohort}>
      <View style={styles.cohortRow}>
        <View style={styles.cohortLabel} />
        {Array.from({ length: width }, (_, i) => (
          <View key={i} style={styles.cohortCellWrap}>
            <AppText variant="caption" color="textFaint">
              M{i}
            </AppText>
          </View>
        ))}
      </View>

      {rows.map((row) => (
        <View key={row.label} style={styles.cohortRow}>
          <View style={styles.cohortLabel}>
            <AppText variant="caption" color="textDim" numberOfLines={1}>
              {row.label}
            </AppText>
            <AppText variant="caption" color="textFaint">
              {row.size}
            </AppText>
          </View>
          {Array.from({ length: width }, (_, i) => {
            const value = row.retention[i];
            return (
              <View key={i} style={styles.cohortCellWrap}>
                <View
                  style={[
                    styles.cohortCell,
                    {
                      backgroundColor: value === undefined ? 'transparent' : colors.accent,
                      opacity: value === undefined ? 0 : 0.18 + value * 0.82,
                    },
                  ]}>
                  {value !== undefined ? (
                    <AppText
                      variant="caption"
                      tint={value > 0.55 ? colors.accentText : colors.text}
                      tabular>
                      {Math.round(value * 100)}
                    </AppText>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/* ---------------------------------------------------------------- donut -- */

/** A single proportion, for shares that would be a lie as a bar. */
export function Ring({
  progress,
  size = 56,
  stroke = 6,
  tint,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  tint?: string;
  children?: React.ReactNode;
}) {
  const colors = useColors();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(progress, 1));

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.surfaceHigh}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tint ?? colors.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference * clamped} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children ? <View style={[StyleSheet.absoluteFill, styles.ringCentre]}>{children}</View> : null}
    </View>
  );
}

/* ------------------------------------------------------------ aging bars -- */

/** A stacked proportion bar. Used where the parts matter more than the total. */
export function StackedBar({
  parts,
  height = 10,
}: {
  parts: { value: number; color: string }[];
  height?: number;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <View style={[styles.stack, { height, borderRadius: height / 2 }]}>
      {parts.map((part, i) =>
        part.value > 0 ? (
          <View key={i} style={{ flex: part.value / total, backgroundColor: part.color }} />
        ) : null,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs },
  barCell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barTrack: { width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '64%', borderRadius: radius.xs, minHeight: 3 },
  // Fixed height so every cell reserves the same space whether it is labelled or
  // not, and overflow hidden so a long label cannot push the row taller.
  barLabel: { height: 21, justifyContent: 'flex-end', overflow: 'hidden' },
  peakRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs },
  /* Must match `barCell` exactly, or the figure stops sitting over its bar.
     `overflow: visible` lets a figure wider than one cell spill either side
     rather than being clipped to a few characters. */
  peakCell: { flex: 1, alignItems: 'center', overflow: 'visible' },
  reference: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.55,
  },
  referenceLabel: { marginTop: space.xs },
  marker: { width: 5, height: 5, borderRadius: radius.pill, marginBottom: 3 },

  heat: { gap: 3 },
  heatHeader: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  heatRow: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  heatRowLabel: { width: 30 },
  heatCellWrap: { flex: 1, aspectRatio: 1, minHeight: 14 },
  heatCell: { flex: 1, borderRadius: 4 },

  cohort: { gap: 4 },
  cohortRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  cohortLabel: { width: 54, flexDirection: 'row', justifyContent: 'space-between' },
  cohortCellWrap: { flex: 1, aspectRatio: 1.4 },
  cohortCell: { flex: 1, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },

  ringCentre: { alignItems: 'center', justifyContent: 'center' },

  stack: { flexDirection: 'row', overflow: 'hidden', width: '100%' },
});
