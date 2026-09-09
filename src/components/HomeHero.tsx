import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { CountUp, moneyFrame } from '@/components/CountUp';
import { Deep } from '@/components/Deep';
import { Press } from '@/components/Press';
import { heroGradientFor, inkOn } from '@/design/gradients';
import { useColors, useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

/** `#RRGGBB` plus an alpha 0..1, as `#RRGGBBAA`. */
function withAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/**
 * The wash at rest and once collapsed, both excluding the status bar.
 *
 * Exported because the screen has to reserve exactly this much room at the top
 * of its list: the header is painted over the list rather than laid out in it,
 * so nothing else knows how tall it is.
 */
export const HERO_HEIGHT = 232;
export const HERO_COLLAPSED = 76;

/**
 * How far you scroll before it has finished shrinking.
 *
 * Deliberately equal to the height it gives up, and that equality is what makes
 * the whole arrangement work. Over the first stretch the wash loses a point of
 * height for every point you scroll, so its bottom edge tracks the top of the
 * list exactly: the cards neither slide underneath it nor pull away from it.
 * Any other value and one or the other happens.
 */
const COLLAPSE = HERO_HEIGHT - HERO_COLLAPSED;

/**
 * The top of the home screen.
 *
 * The wash is a container rather than a backdrop: the greeting and the day's
 * figure both live *inside* it. An earlier version had the card straddling the
 * lower edge, which stitched the two areas together but also meant the coloured
 * area was decoration with content parked on its boundary. Putting the card
 * inside makes the wash the widget — one object holding the day.
 *
 * ## Two things it does that a static header does not
 *
 * **It changes colour daily.** Sixteen washes, keyed on the calendar day rather
 * than picked at random per render — random would re-roll on every re-render,
 * flickering as the screen updates, and an impure read during render is a bug
 * with the React Compiler on rather than a quirk.
 *
 * **It contracts as you scroll.** The wash gives up most of its height over the
 * first 150 points, the figure fades, and the greeting stays. This is not
 * decoration: it is what stops a tall coloured header from wasting a third of
 * the screen the moment you start reading the list underneath it.
 */
export function HomeHero({
  scrollY,
  greeting,
  subtitle,
  headline,
  value,
  valueLabel,
  now,
  onLongPressTitle,
  right,
}: {
  /** Live scroll offset, so the wash can give up its height as the list rises. */
  scrollY: SharedValue<number>;
  greeting: string;
  subtitle: string;
  /** One sentence about the day, under the figure. */
  headline: string;
  value: number;
  valueLabel: string;
  /** Picks which of the sixteen washes today gets. */
  now: number;
  onLongPressTitle?: () => void;
  right?: React.ReactNode;
}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const theme = heroGradientFor(now);
  const field = theme[isDark ? 'dark' : 'light'];
  /* Measured off the wash rather than picked from the scheme. See `inkOn`. */
  const ink = inkOn(field.top);

  const fullH = insets.top + HERO_HEIGHT;
  const shortH = insets.top + HERO_COLLAPSED;

  /*
    It shrinks first, and only then does it leave.

    Two phases, and they do not overlap. For the first `COLLAPSE` points of
    scroll the wash stays where it is and gives up its height; after that it is
    done shrinking and rides up with the list like anything else. Animating both
    at once — which is what happens when the header is simply the first child of
    the scroll view — reads as one muddled movement rather than two clear ones,
    and it takes the header off the screen before it has finished collapsing.

    The header is painted *over* the list rather than laid out inside it, which
    is what allows the two phases to be separated at all. It also keeps the
    height change out of the list's layout: as a flexing sibling, every frame of
    the collapse resized the scroll viewport and recomputed which rows were
    visible, which is what made this screen crawl.
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

  /* The figure goes before the greeting does — it is the taller thing, and the
     one that would otherwise still be legible when the header is half gone. */
  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, COLLAPSE * 0.55], [1, 0], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(scrollY.value, [0, COLLAPSE], [1, 0.94], Extrapolation.CLAMP) },
    ],
  }));

  return (
    /* `box-none` so a drag that starts on the empty colour still scrolls the
       list underneath. Without it the top of the screen is a dead zone, which is
       exactly where people reach to start scrolling. */
    <Animated.View style={[styles.wash, washStyle]} pointerEvents="box-none">
      {/*
        Pinned to the top at full height rather than filling the box, so the
        colour ramp keeps its proportions as the box closes over it. Stretched to
        `absoluteFill` the stops compress as it shrinks and the whole thing goes
        muddy at the end of the collapse.
      */}
      <LinearGradient
        colors={[field.top, field.mid, field.base]}
        locations={[0, 0.58, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[styles.field, { height: fullH }]}
        pointerEvents="none"
      />

      {/*
        The corner glow, as a second linear gradient rather than an SVG radial.

        Measured: with the SVG pool, scrolling home ran 6.5% janky against 0.9%
        on the money screen, which has a list and no header. The pool was the
        whole difference — a full-width radial is expensive to rasterise and it
        was being re-rasterised as the header moved.

        A diagonal linear ramp from a transparent corner does not have a radial's
        falloff, but at this size and opacity nobody can tell, and it is a native
        view the compositor already knows how to move.
      */}
      <LinearGradient
        colors={[withAlpha(field.glow, 0.75), withAlpha(field.glow, 0.18), withAlpha(field.glow, 0)]}
        locations={[0, 0.45, 1]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.1, y: 0.95 }}
        style={[styles.field, { height: fullH }]}
        pointerEvents="none"
      />

      <View
        style={[styles.head, { paddingTop: insets.top + space.sm }]}
        pointerEvents="box-none">
        <Press
          haptic="light"
          scaleTo={0.99}
          onLongPress={onLongPressTitle}
          delayLongPress={400}
          accessibilityRole="header"
          accessibilityLabel={`${greeting}. ${subtitle}`}
          accessibilityHint={onLongPressTitle ? 'Long press to change your name' : undefined}
          style={styles.headText}>
          <AppText variant="title2" tint={ink} numberOfLines={1}>
            {greeting}
          </AppText>
          <AppText variant="footnote" tint={`${ink}B8`} numberOfLines={1}>
            {subtitle}
          </AppText>
        </Press>
        {right}
      </View>

      <Animated.View style={[styles.body, cardStyle]} pointerEvents="box-none">
        <Deep
          target={{ kind: 'metric', metricKey: 'revenue' }}
          haptic="light"
          scaleTo={0.985}
          accessibilityRole="summary"
          accessible
          accessibilityLabel={`${valueLabel}. ${headline}`}
          accessibilityHint="Long press for the full breakdown"
          style={[styles.card, { backgroundColor: colors.surface }]}>
          <AppText variant="caption" color="textFaint">
            {valueLabel}
          </AppText>
          <CountUp value={value} format={moneyFrame} variant="metric" />
          <AppText variant="footnote" color="textDim" numberOfLines={2} style={styles.headline}>
            {headline}
          </AppText>
        </Deep>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /*
    An ordinary child of the scroll view whose height is animated.

    Four arrangements were tried. Inside the list with no animation it never
    shrank. Absolutely positioned it collapsed properly but the rows ran
    underneath it. As a fixed-height child compressed by a transform it neither
    shrank nor got out of the way, and translating it down pushed the cards up
    over the colour.

    Animating the height inside the list is the only one that does all three:
    it visibly shrinks, the deck below is never on top of it, and it scrolls off
    the top like everything else. The layout pass per frame is affordable now
    that the fill is native gradients rather than an SVG radial — that was
    always the expensive part, and the measurement is in the note above.
  */
  field: { position: 'absolute', left: 0, right: 0, top: 0 },
  wash: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    overflow: 'hidden',
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  /* Anchored to the bottom edge rather than laid out under the greeting. As the
     box closes, what gets clipped is the top of the card — which is already
     fading — instead of a horizontal slice through the middle of the figure. */
  body: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  head: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
  },
  headText: { flex: 1, gap: 2 },
  card: {
    marginHorizontal: space.gutter,
    marginBottom: space.base,
    padding: space.base,
    borderRadius: radius.lg,
    gap: 2,
  },
  headline: { lineHeight: 19 },
});
