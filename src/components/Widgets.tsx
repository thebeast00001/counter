import { LinearGradient } from 'expo-linear-gradient';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Deep } from '@/components/Deep';
import type { DeepTarget } from '@/components/Deep';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';

/**
 * The insight widgets.
 *
 * Two rules hold the set together, and both are restrictions rather than
 * features:
 *
 *   1. **Most widgets have no gradient at all.** A wall of gradient cards is a
 *      wallpaper, not a dashboard — nothing stands out because everything is
 *      shouting. The colour is rationed so that the one or two that carry it
 *      read as the important ones.
 *   2. **Where there is colour, it is a *part* of the widget.** A fully
 *      gradient-filled card fights the number printed on it and forces every
 *      label into a compromise. Confining the colour to a band, a bar or a
 *      corner means the figure always sits on a plain surface and the colour
 *      still does its job.
 *
 * Everything here is long-pressable through `Deep`, so the rule that the app
 * never asserts a figure it cannot break open survives the redesign.
 */

/**
 * The insights header at rest and once collapsed, both excluding the status bar.
 *
 * Exported because the screen reserves exactly this much room at the top of its
 * list — the header is painted over the list, so nothing else knows its height.
 */
export const INSIGHTS_HERO_HEIGHT = 286;
export const INSIGHTS_HERO_COLLAPSED = 124;

/**
 * How far you scroll before it has finished shrinking.
 *
 * Equal to the height it gives up, and that equality is the whole trick: over
 * the first stretch the header loses a point of height for every point you
 * scroll, so its bottom edge tracks the top of the deck exactly — the cards
 * neither slide under it nor pull away from it. The home hero works the same
 * way, for the same reason.
 */
const COLLAPSE = INSIGHTS_HERO_HEIGHT - INSIGHTS_HERO_COLLAPSED;

/* ------------------------------------------------------------------ shell -- */

function Shell({
  target,
  children,
  span,
}: {
  target: DeepTarget;
  children: React.ReactNode;
  /** `full` runs edge to edge; `half` pairs with another half. */
  span: 'full' | 'half';
}) {
  const colors = useColors();
  return (
    <Deep
      target={target}
      haptic="light"
      scaleTo={0.985}
      style={[
        styles.shell,
        span === 'half' ? styles.half : styles.full,
        { backgroundColor: colors.surface },
      ]}
    >
      {children}
    </Deep>
  );
}

/* ------------------------------------------------------------------ pieces -- */

/**
 * A number, its label, and a direction.
 *
 * The plainest widget in the set and the one used most. No colour beyond the
 * delta chip, which is the only part that carries a judgement.
 */
export function StatWidget({
  label,
  value,
  sub,
  delta,
  icon: Icon,
  target,
  span = 'half',
}: {
  label: string;
  value: string;
  sub?: string;
  /** Positive is good, negative is bad. Omit where neither applies. */
  delta?: { pct: number; good: boolean };
  icon?: LucideIcon;
  target: DeepTarget;
  span?: 'full' | 'half';
}) {
  const colors = useColors();
  return (
    <Shell target={target} span={span}>
      <View style={styles.head}>
        {Icon ? <Icon size={15} color={colors.textFaint} strokeWidth={2} /> : null}
        <AppText variant="caption" color="textFaint" numberOfLines={1} style={styles.grow}>
          {label}
        </AppText>
      </View>

      <AppText variant="title1" tabular numberOfLines={1}>
        {value}
      </AppText>

      {delta ? (
        <View
          style={[
            styles.chip,
            {
              backgroundColor: delta.good ? colors.successSoft : `${colors.warn}22`,
            },
          ]}
        >
          {delta.good ? (
            <ArrowUpRight size={12} color={colors.success} strokeWidth={2.6} />
          ) : (
            <ArrowDownRight size={12} color={colors.warn} strokeWidth={2.6} />
          )}
          <AppText variant="caption" tint={delta.good ? colors.success : colors.warn} tabular>
            {Math.abs(Math.round(delta.pct))}%
          </AppText>
        </View>
      ) : sub ? (
        <AppText variant="caption" color="textFaint" numberOfLines={1}>
          {sub}
        </AppText>
      ) : null}
    </Shell>
  );
}

/**
 * A dot grid — one dot per day, filled when something was recorded.
 *
 * Borrowed from the streak complications on watch faces, and it earns its place
 * for the same reason: a person can count a gap in a grid without reading a
 * number, and a gap is exactly what this measures.
 */
export function GridWidget({
  label,
  value,
  dots,
  target,
}: {
  label: string;
  value: string;
  /** Oldest first. */
  dots: boolean[];
  target: DeepTarget;
}) {
  const colors = useColors();
  return (
    <Shell target={target} span="full">
      <View style={styles.head}>
        <AppText variant="caption" color="textFaint" style={styles.grow}>
          {label}
        </AppText>
        <AppText variant="caption" color="textFaint" tabular>
          {value}
        </AppText>
      </View>
      <View style={styles.grid}>
        {dots.map((on, i) => (
          <View
            key={i}
            style={[styles.gridDot, { backgroundColor: on ? colors.accent : colors.surfaceHigh }]}
          />
        ))}
      </View>
    </Shell>
  );
}

/**
 * A single horizontal bar with a marker on it.
 *
 * This is the one that carries the gradient, and only across the filled portion
 * — the track and the whole rest of the card stay plain. A bar is the right
 * shape for anything with a target, because the distance still to travel is
 * drawn rather than described.
 */
export function ProgressWidget({
  label,
  value,
  caption,
  progress,
  gradient,
  target,
}: {
  label: string;
  value: string;
  caption: string;
  /** 0..1. */
  progress: number;
  gradient: [string, string];
  target: DeepTarget;
}) {
  const colors = useColors();
  const pct = Math.max(0, Math.min(progress, 1));

  return (
    <Shell target={target} span="full">
      <View style={styles.head}>
        <AppText variant="caption" color="textFaint" style={styles.grow}>
          {label}
        </AppText>
        <AppText variant="caption" color="textFaint" tabular>
          {Math.round(pct * 100)}%
        </AppText>
      </View>

      <AppText variant="title1" tabular>
        {value}
      </AppText>

      <View style={[styles.track, { backgroundColor: colors.surfaceHigh }]}>
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          // A minimum width so a small non-zero value is still visible — but
          // *zero* is drawn as nothing. A nub at 0% reads as "a little", which
          // is the one thing it must not say.
          style={[styles.fill, { width: `${pct === 0 ? 0 : Math.max(pct * 100, 3)}%` }]}
        />
      </View>

      <AppText variant="caption" color="textFaint" numberOfLines={1}>
        {caption}
      </AppText>
    </Shell>
  );
}

/**
 * Bars, in the manner of an audio meter.
 *
 * Reads at a glance as *shape* — where the week is heavy and where it is empty —
 * which is the only thing anyone wants from a seven-bar chart. Exact values are
 * a long press away.
 */
export function BarsWidget({
  label,
  value,
  bars,
  labels,
  highlight,
  target,
}: {
  label: string;
  value: string;
  /** 0..1 each. */
  bars: number[];
  labels?: string[];
  /** Index drawn in the accent. */
  highlight?: number;
  target: DeepTarget;
}) {
  const colors = useColors();
  return (
    <Shell target={target} span="full">
      {/* Both capped to one line. The trailing figure carries the business's own
          word for a visit — "appointments, 8 weeks" is a long one — and without
          a cap it wrapped and shoved the title into the bars below it. */}
      <View style={styles.head}>
        <AppText variant="caption" color="textFaint" numberOfLines={1} style={styles.grow}>
          {label}
        </AppText>
        <AppText variant="caption" color="textFaint" numberOfLines={1} style={styles.headValue}>
          {value}
        </AppText>
      </View>

      <View style={styles.bars}>
        {bars.map((h, i) => (
          <View key={i} style={styles.barCol}>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  {
                    height: `${Math.max(h * 100, 4)}%`,
                    backgroundColor: i === highlight ? colors.accent : colors.surfaceHigh,
                  },
                ]}
              />
            </View>
            {labels?.[i] ? (
              <AppText
                variant="caption"
                color="textFaint"
                numberOfLines={1}
                style={styles.barLabel}
              >
                {labels[i]}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>
    </Shell>
  );
}

/**
 * The insights header.
 *
 * A field of colour holding four things: who you are and what needs you, one
 * line of prose, a strip of months you can pick between, and the figure for
 * whichever is picked.
 *
 * The strip is a control and a chart at once — each month's bar is that month's
 * takings, so choosing one is also comparing it to the others. That is the only
 * reason it earns the space: a row of month buttons would be navigation, and
 * navigation does not belong in a header this large.
 *
 * ## How it moves
 *
 * It shrinks first, and only then does it leave — two phases that do not
 * overlap. For the first `COLLAPSE` points of scroll it holds its position and
 * gives up height; after that it is done shrinking and rides up with the deck.
 *
 * That separation is only possible because the header is painted *over* the
 * list instead of laid out beside it. The version before this was a flexing
 * sibling, which forced a scroll-viewport resize and a recount of visible rows
 * on every frame of the collapse — that is what made this screen crawl. Now the
 * only thing re-laid-out per frame is the header's own small subtree.
 */
export function InsightsHero({
  greeting,
  months,
  at,
  onPick,
  value,
  caption,
  topInset,
  scrollY,
  meta,
  gradient,
  target,
  right,
}: {
  /** One sentence, in the second person. */
  greeting: string;
  /** Short labels and their values, oldest first. */
  months: { label: string; value: number }[];
  at: number;
  onPick: (index: number) => void;
  value: string;
  caption: string;
  topInset: number;
  /** Live scroll offset, so the header can collapse as the deck rises. */
  scrollY: SharedValue<number>;
  /**
   * One line naming the figure, shown only once the header has closed.
   *
   * Passed in rather than derived here: a month still running has to be
   * compared against the same days of the one before it, and only the screen
   * holding the records can work that out.
   */
  meta: string;
  gradient: [string, string, string];
  target: DeepTarget;
  right?: React.ReactNode;
}) {
  const peak = Math.max(...months.map((m) => m.value), 1);

  const fullH = topInset + INSIGHTS_HERO_HEIGHT;
  const shortH = topInset + INSIGHTS_HERO_COLLAPSED;

  /** Two lines of footnote — what `caption` is capped at. */
  const captionH = 36;

  /*
    It shrinks, and then it leaves.

    Sticking it open was tried and reverted: pinned, the closed header sat over
    the top of every screen below it for the whole scroll, and the screen it was
    pinned to is the one made entirely of things to read. A header that shrinks
    and then goes is the shape this screen had, and the shape it wants.

    Two phases that do not overlap. For the first `COLLAPSE` points of scroll it
    holds its position and gives up height; after that it is done shrinking and
    rides up with the deck.
  */
  const washStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, COLLAPSE], [fullH, shortH], Extrapolation.CLAMP),
    transform: [
      {
        translateY: -interpolate(
          scrollY.value,
          [COLLAPSE, COLLAPSE + shortH],
          [0, shortH],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  /*
    Prose and strip go first; the figure is the last thing to leave, because it
    is the one still worth reading when the header is nearly gone.

    The block they live in is anchored to the *bottom* of the box, so what the
    shrinking box clips is the top of the greeting — already at zero opacity by
    then — rather than the middle of the figure, which is what happened when it
    was laid out from the top.

    Anchored with `bottom: 0` rather than `justifyContent: 'flex-end'`, because
    Yoga does not overflow a flex container backwards: with flex-end and content
    taller than the box, everything still starts at the top and the foot falls
    off the bottom edge, which left the collapsed header showing nothing at all.
  */
  const detailStyle = useAnimatedStyle(() => ({
    /* Gone by four tenths of the collapse rather than half, so the greeting
       spends less of the scroll passing visibly behind the avatar. */
    opacity: interpolate(scrollY.value, [0, COLLAPSE * 0.4], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(scrollY.value, [0, COLLAPSE], [0, -26], Extrapolation.CLAMP),
      },
    ],
  }));

  /* The caption gives up its height as well as its opacity. Fading alone leaves
     36 points of nothing under the figure, which is enough to push the figure up
     behind the avatar at the end of the collapse. */
  const captionStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, COLLAPSE * 0.5], [captionH, 0], Extrapolation.CLAMP),
    opacity: interpolate(scrollY.value, [0, COLLAPSE * 0.5], [1, 0], Extrapolation.CLAMP),
  }));

  /*
    What the collapsed header says instead of nothing.

    Everything that named the figure — the greeting, the month strip, the
    caption — is gone by the end of the collapse, which left a bare colour field
    with one number on it and no way to tell which month the number belonged to.
    Both problems have the same answer: as the strip fades out, fade a line in
    where it used to be.

    It takes the height back too, so the expanded header is laid out exactly as
    it was before this existed.
  */
  /*
    Landed well before the collapse finishes, not at the end of it.

    The header only holds its closed shape for a short band of scroll before it
    rides away entirely, so a fade that completed at `COLLAPSE` spent that whole
    band half-drawn and clipped — the one line the collapsed header keeps was
    never actually legible. Full height and full opacity by three quarters of
    the way through, and 18 points so a 16-point line is not trimmed.
  */
  const metaH = 18;
  const metaStyle = useAnimatedStyle(() => ({
    height: interpolate(
      scrollY.value,
      [COLLAPSE * 0.3, COLLAPSE * 0.7],
      [0, metaH],
      Extrapolation.CLAMP,
    ),
    opacity: interpolate(
      scrollY.value,
      [COLLAPSE * 0.45, COLLAPSE * 0.75],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    /* `box-none` so a drag beginning on the empty colour still scrolls the deck
       underneath, rather than making the top of the screen a dead zone. */
    <Animated.View style={[styles.hero, washStyle]} pointerEvents="box-none">
      {/*
        Held at full height rather than filling the box, so the colour ramp keeps
        its proportions while the box closes over it. Stretched to fill, the
        stops compress as it shrinks and the whole thing goes muddy at the end.
      */}
      <LinearGradient
        colors={gradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[styles.heroField, { height: fullH }]}
        pointerEvents="none"
      />

      <View style={styles.heroBody} pointerEvents="box-none">
        <Animated.View style={[styles.heroTop, detailStyle]} pointerEvents="box-none">
          <AppText variant="title3" tint="#FFFFFF" numberOfLines={2} style={styles.heroGreeting}>
            {greeting}
          </AppText>

          <View style={styles.heroStrip}>
            {months.map((month, i) => {
              const on = i === at;
              return (
                <Pressable
                  key={month.label}
                  onPress={() => onPick(i)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={month.label}
                  style={styles.heroMonth}
                >
                  <View style={styles.heroTrack}>
                    <View
                      style={[
                        styles.heroBar,
                        {
                          height: `${Math.max((month.value / peak) * 100, 7)}%`,
                          backgroundColor: on ? '#FFFFFF' : 'rgba(255,255,255,0.6)',
                        },
                      ]}
                    />
                  </View>
                  <AppText
                    variant="caption"
                    /* Barely dimmer than the selected one, deliberately. The
                     obvious design fades unselected months to about 60% white,
                     which measures 3.2:1 on this field and fails AA for 10px
                     text. Selection is carried by the bar instead, which is a
                     graphic and only has to clear 3.0. */
                    tint={on ? '#FFFFFF' : 'rgba(255,255,255,0.86)'}
                    numberOfLines={1}
                    style={styles.heroMonthLabel}
                  >
                    {month.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>

        <Deep
          target={target}
          haptic="light"
          scaleTo={0.985}
          accessibilityRole="summary"
          accessible
          accessibilityLabel={`${value}. ${caption}`}
          accessibilityHint="Long press for the full breakdown"
          style={styles.heroFoot}
        >
          <Animated.View style={[styles.heroMeta, metaStyle]}>
            <AppText variant="caption" tint="rgba(255,255,255,0.88)" numberOfLines={1}>
              {meta}
            </AppText>
          </Animated.View>
          <AppText variant="largeTitle" tint="#FFFFFF" numberOfLines={1}>
            {value}
          </AppText>
          <Animated.View style={captionStyle}>
            <AppText variant="footnote" tint="rgba(255,255,255,0.88)" numberOfLines={2}>
              {caption}
            </AppText>
          </Animated.View>
        </Deep>
      </View>

      {/* Last, so it stays above the greeting as that slides up under it. */}
      <View
        style={[styles.heroHead, { paddingTop: topInset + space.sm }]}
        pointerEvents="box-none">
        {right}
      </View>
    </Animated.View>
  );
}

/**
 * The one widget that leads with colour.
 *
 * A gradient band across the top third with the headline on it, and the detail
 * on plain surface underneath. Reserved for the single most important reading on
 * the screen — if a second one of these appears, neither is important any more.
 */
export function FeatureWidget({
  eyebrow,
  value,
  caption,
  gradient,
  target,
}: {
  eyebrow: string;
  value: string;
  caption: string;
  gradient: [string, string, string];
  target: DeepTarget;
}) {
  const colors = useColors();
  return (
    <Deep
      target={target}
      haptic="light"
      scaleTo={0.985}
      style={[styles.feature, { backgroundColor: colors.surface }]}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.featureBand}
      >
        <AppText variant="caption" tint="rgba(255,255,255,0.78)" style={styles.featureEyebrow}>
          {eyebrow.toUpperCase()}
        </AppText>
        <AppText variant="largeTitle" tint="#FFFFFF" numberOfLines={1}>
          {value}
        </AppText>
      </LinearGradient>

      <View style={styles.featureFoot}>
        <AppText variant="footnote" color="textDim" style={styles.featureCaption}>
          {caption}
        </AppText>
      </View>
    </Deep>
  );
}

/** Two halves side by side. */
export function WidgetRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radius.lg,
    padding: space.base,
    gap: space.sm,
    justifyContent: 'center',
  },
  full: { minHeight: 108 },
  half: { flex: 1, minHeight: 108 },
  row: { flexDirection: 'row', gap: space.sm },

  head: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  grow: { flex: 1 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  gridDot: { width: 11, height: 11, borderRadius: radius.pill },

  track: { height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },

  /* Never squeezed to nothing by a long title, and never wider than half. */
  headValue: { flexShrink: 0, maxWidth: '55%' },

  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 72 },
  barCol: { flex: 1, height: '100%', alignItems: 'center', gap: 4 },
  /*
    The bar gets its own track, and the label sits outside it.

    The bar's height is a percentage, and it used to be a percentage of a column
    that also held the label — so a bar at full height took the entire column and
    printed the weekday straight through itself. Only the tallest bar showed it,
    which is why it read as one weekday being broken rather than as a layout
    fault. Giving the track the leftover space means 100% means 100% *of the
    space for bars*, which is what every caller already assumed.
  */
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: radius.xs, minHeight: 4 },
  barLabel: { fontSize: 10, lineHeight: 13 },

  /* Rounded at the bottom only. The top two corners are against the status bar,
     and rounding them leaves two slivers of page showing through. */
  hero: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    overflow: 'hidden',
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroBody: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  heroField: { position: 'absolute', left: 0, right: 0, top: 0 },
  /* Out of the column so the rest can be bottom-aligned around it. It has to
     stay pinned under the status bar while everything below it slides. */
  heroHead: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.gutter,
  },
  heroTop: { paddingHorizontal: space.gutter, gap: space.md },
  heroGreeting: { lineHeight: 25 },
  heroStrip: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    height: 64,
  },
  heroMonth: { flex: 1, height: '100%', gap: 5 },
  heroTrack: { flex: 1, justifyContent: 'flex-end' },
  heroBar: { width: '100%', borderRadius: radius.xs, minHeight: 4 },
  heroMonthLabel: { fontSize: 10, textAlign: 'center' },
  // Clipped, because the line is laid out at zero height while the header is
  // open and Android does not clip an overflowing child on its own.
  heroMeta: { overflow: 'hidden', justifyContent: 'flex-end' },
  heroFoot: {
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
    paddingBottom: space.base,
    gap: 2,
  },

  feature: { borderRadius: radius.lg, overflow: 'hidden' },
  featureBand: { padding: space.base, gap: 2 },
  featureEyebrow: { letterSpacing: 1 },
  featureFoot: { padding: space.base },
  featureCaption: { lineHeight: 19 },
});
