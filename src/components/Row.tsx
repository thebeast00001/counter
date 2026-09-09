import * as Haptics from 'expo-haptics';
import { Phone, MessageCircle } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Deep, type DeepTarget } from '@/components/Deep';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space, spring } from '@/design/tokens';

/**
 * A list row, with the two things a list row in this app always needs.
 *
 * A leading accent bar that appears on press — cheaper to read than a whole-row
 * highlight, and it survives on a dark surface where a background tint of any
 * subtlety is invisible. And swipe actions, because calling and messaging are
 * the two things an owner does from a roster, and making them cost two taps and
 * a screen transition is why people go back to their phone's contact list.
 */

/** How far the panel must be pulled before releasing commits the action. */
const TRIGGER = 96;
/** Past this the panel stops growing, so a long drag does not feel unbounded. */
const MAX_PULL = 150;
/**
 * Width of the icon-and-label block.
 *
 * Also the point at which the block finishes arriving — tying the two together
 * means the label can never be asked to render in less room than it needs, which
 * is what clipped "WhatsApp" to "hatsApp" while the panel was still narrow.
 */
const GLYPH_W = 68;

export type RowSwipeAction = {
  side: 'left' | 'right';
  icon: 'phone' | 'message';
  label: string;
  tint: string;
  onAct: () => void;
};

export type RowProps = {
  target?: DeepTarget;
  onPress?: () => void;
  /** At most one per side. Anything more and the gesture stops being learnable. */
  swipe?: RowSwipeAction[];
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  children: React.ReactNode;
};

/**
 * Rows with no swipe actions never reach the gesture at all.
 *
 * The split is what makes the hooks conditional legally. `Row` used to run its
 * gesture and its animated styles for every row and then early-return before
 * using them — hooks cannot be skipped, so the work happened regardless. Nearly
 * every row outside the people roster has no swipe actions, and they now cost a
 * plain view.
 *
 * This replaced a scheme that mounted the panels lazily on touch-down. That was
 * cheaper still and it crashed the app: flipping React state from inside a
 * gesture callback re-renders mid-gesture, and Reanimated's worklet runtime
 * aborts with a `WorkletsReentrancyCheck` SIGSEGV — a native crash that drops
 * straight back to the Expo Go home screen, with nothing in the Metro log.
 * Never set state from a gesture callback that is still running.
 */
export function Row(props: RowProps) {
  if (!props.swipe?.length) return <PlainRow {...props} />;
  return <SwipeRow {...props} />;
}

function PlainRow({ target, onPress, style, accessibilityLabel, children }: RowProps) {
  const colors = useColors();
  const [pressed, setPressed] = useState(false);

  const content = (
    <View style={[styles.row, { backgroundColor: colors.surface }, style]}>
      <View style={[styles.pressBar, { opacity: pressed ? 1 : 0, backgroundColor: colors.accent }]} />
      {children}
    </View>
  );

  return target ? (
    <Deep
      target={target}
      onPress={onPress}
      haptic="light"
      scaleTo={0.99}
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}>
      {content}
    </Deep>
  ) : (
    content
  );
}

function SwipeRow({ target, onPress, swipe, style, accessibilityLabel, children }: RowProps) {
  const colors = useColors();
  const { reduced } = useMotion();
  const [pressed, setPressed] = useState(false);

  const dx = useSharedValue(0);
  const left = swipe?.find((s) => s.side === 'left');
  const right = swipe?.find((s) => s.side === 'right');

  const fire = (action: RowSwipeAction) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    action.onAct();
  };

  /**
   * The row does not move; a coloured panel wipes across it.
   *
   * The usual pattern translates the card sideways to uncover buttons parked
   * underneath, which means the thing you are trying to read slides out from
   * under your eyes at exactly the moment you are deciding whether to act on it.
   * One UI does the opposite — the row stays where it is and the action sweeps in
   * over it from the edge you pulled from, so the name stays legible until the
   * panel actually reaches it.
   *
   * It also makes the commit threshold visible: the panel *is* the progress bar.
   */
  /**
   * Built once per row rather than once per render.
   *
   * A roster paints forty of these, and every keystroke in the search field
   * re-renders all of them. Without memoisation that is forty gesture objects
   * constructed and handed to the native side on each character typed — the
   * single largest avoidable cost on the busiest screen in the app.
   */
  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Horizontal only, and only after real horizontal travel, so a vertical
        // flick still scrolls the list underneath rather than peeling a row open.
        .activeOffsetX([-14, 14])
        .failOffsetY([-12, 12])
        .enabled(Boolean(swipe?.length) && !reduced)
        .onUpdate((e) => {
          const raw = e.translationX;
          // Nothing to reveal on that side, so the pull is heavily damped rather
          // than opening an empty panel.
          if ((raw > 0 && !left) || (raw < 0 && !right)) dx.value = raw * 0.1;
          else dx.value = Math.max(-MAX_PULL, Math.min(MAX_PULL, raw));
        })
        .onEnd(() => {
          const travelled = dx.value;
          if (travelled > TRIGGER && left) runOnJS(fire)(left);
          else if (travelled < -TRIGGER && right) runOnJS(fire)(right);
          dx.value = withSpring(0, spring.standard);
        }),
    // `fire` closes over `left`/`right`, which are derived from `swipe`; both
    // are covered by the identity of the actions themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [left, right, reduced, dx],
  );


  const barStyle = {
    opacity: pressed ? 1 : 0,
    backgroundColor: colors.accent,
  };

  const content = (
    <View style={[styles.row, { backgroundColor: colors.surface }, style]}>
      <View style={[styles.pressBar, barStyle]} />
      {children}
    </View>
  );

  const inner = target ? (
    <Deep
      target={target}
      onPress={onPress}
      haptic="light"
      scaleTo={0.99}
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}>
      {content}
    </Deep>
  ) : (
    content
  );

  if (!swipe?.length) return inner;

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.swipeWrap}>
        {inner}

        {/* Panels sit above the row and are clipped to their own width, so the
            colour appears to wipe across rather than the row sliding away. */}
        <SwipePanels dx={dx} left={left} right={right} />

      </View>
    </GestureDetector>
  );
}

/**
 * Everything that only matters while a finger is on the row.
 *
 * Split out so its six animated styles are created once per *drag* rather than
 * once per row. Mounting it mid-gesture is safe because the panels start at zero
 * width — the first frame it exists is a frame in which it is invisible anyway.
 */
function SwipePanels({
  dx,
  left,
  right,
}: {
  dx: SharedValue<number>;
  left?: RowSwipeAction;
  right?: RowSwipeAction;
}) {
  // Width of each panel, tracking the finger. Only the pulled side ever opens.
  const leftPanel = useAnimatedStyle(() => ({
    width: Math.max(dx.value, 0),
    opacity: dx.value > 2 ? 1 : 0,
  }));
  const rightPanel = useAnimatedStyle(() => ({
    width: Math.max(-dx.value, 0),
    opacity: dx.value < -2 ? 1 : 0,
  }));

  /**
   * The glyph rides the panel's leading edge until the panel is wide enough to
   * hold it, then parks. Without this it is clipped out of existence for the
   * first forty points of the drag, which is most of the gesture.
   */
  const leftGlyph = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.min(dx.value - GLYPH_W, 0) }],
    opacity: interpolate(dx.value, [24, GLYPH_W], [0, 1], 'clamp'),
  }));
  const rightGlyph = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.max(GLYPH_W + dx.value, 0) }],
    opacity: interpolate(dx.value, [-24, -GLYPH_W], [0, 1], 'clamp'),
  }));

  // Past the threshold the panel saturates, so the commit point is felt as well
  // as measured.
  const leftFill = useAnimatedStyle(() => ({
    opacity: interpolate(dx.value, [0, TRIGGER], [0.55, 1], 'clamp'),
  }));
  const rightFill = useAnimatedStyle(() => ({
    opacity: interpolate(dx.value, [0, -TRIGGER], [0.55, 1], 'clamp'),
  }));

  return (
    <>
      {left ? (
        <Animated.View pointerEvents="none" style={[styles.panel, styles.panelLeft, leftPanel]}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: left.tint }, leftFill]}
          />
          <Animated.View style={[styles.glyph, styles.glyphLeft, leftGlyph]}>
            <ActionGlyph action={left} onTint />
          </Animated.View>
        </Animated.View>
      ) : null}

      {right ? (
        <Animated.View pointerEvents="none" style={[styles.panel, styles.panelRight, rightPanel]}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: right.tint }, rightFill]}
          />
          <Animated.View style={[styles.glyph, styles.glyphRight, rightGlyph]}>
            <ActionGlyph action={right} onTint />
          </Animated.View>
        </Animated.View>
      ) : null}
    </>
  );
}

function ActionGlyph({ action, onTint }: { action: RowSwipeAction; onTint?: boolean }) {
  const Icon = action.icon === 'phone' ? Phone : MessageCircle;
  // White on the filled panel; the action's own colour when it sits on surface.
  const ink = onTint ? '#FFFFFF' : action.tint;
  return (
    <>
      <Icon size={19} color={ink} strokeWidth={2.3} />
      <AppText variant="caption" tint={ink} numberOfLines={1}>
        {action.label}
      </AppText>
    </>
  );
}

/**
 * Highlights the part of a name that matched what was typed.
 *
 * Without it a search result list is a wall of names that all look equally
 * relevant, and the reader has to re-run the match in their head on every row.
 */
export function Highlighted({
  text,
  query,
  variant = 'callout',
}: {
  text: string;
  query: string;
  variant?: 'callout' | 'footnote' | 'body';
}) {
  const colors = useColors();
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return (
      <AppText variant={variant} numberOfLines={1}>
        {text}
      </AppText>
    );
  }

  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) {
    return (
      <AppText variant={variant} numberOfLines={1}>
        {text}
      </AppText>
    );
  }

  return (
    <AppText variant={variant} numberOfLines={1}>
      {text.slice(0, at)}
      <AppText variant={variant} tint={colors.accent}>
        {text.slice(at, at + needle.length)}
      </AppText>
      {text.slice(at + needle.length)}
    </AppText>
  );
}

const styles = StyleSheet.create({
  swipeWrap: { position: 'relative' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  // Sits inside the row's own clip, so it takes the row's corner radius on the
  // leading edge rather than drawing a square tab against a rounded card.
  pressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    /*
      Smaller than the row's own radius on purpose. React Native clamps a corner
      radius to half the shorter side, so the row's 26 turned a narrow panel into
      a circle — it read as a floating bubble rather than a colour wiping across
      the row. Twenty keeps it a rounded rectangle at every width.
    */
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  panelLeft: { left: 0 },
  panelRight: { right: 0 },
  glyph: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: GLYPH_W,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  glyphLeft: { left: 0 },
  glyphRight: { right: 0 },
});
