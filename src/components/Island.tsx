import { ChevronRight, CircleCheck, Clock3, Flame, Sparkles, Target, Users, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import type { ActivityIcon, LiveActivity } from '@/state/liveActivity';

const ICONS: Record<ActivityIcon, LucideIcon> = {
  check: CircleCheck,
  flame: Flame,
  target: Target,
  users: Users,
  clock: Clock3,
  sparkle: Sparkles,
};

/**
 * The bar's expanded state, in the manner of the Dynamic Island.
 *
 * The activity strip used to be a single 56pt row that slid in above the tabs:
 * an icon, a line of text, and no way to act on it. That is a notification
 * rendered inside a navigation bar — it tells you something happened and then
 * makes you go and find it.
 *
 * The island idea is that the *same object* changes shape to hold what is
 * happening, and hands you the one thing you would want to do about it. So the
 * bar grows rather than something appearing above it, the content gets room to
 * be read, and the action is right there.
 *
 * It stays the same object throughout — the dock's own `GlassSurface` simply
 * becomes taller. Rendering a separate floating panel would break the illusion
 * that made this worth borrowing.
 */
export function Island({
  item,
  count,
  index,
  onDismiss,
  onAct,
}: {
  item: LiveActivity;
  count: number;
  index: number;
  onDismiss: () => void;
  onAct?: () => void;
}) {
  const colors = useColors();
  const { reduced } = useMotion();

  const tint =
    item.tone === 'success'
      ? colors.success
      : item.tone === 'warn'
        ? colors.warn
        : item.tone === 'neutral'
          ? colors.textDim
          : colors.accent;

  const Icon = ICONS[item.icon];

  /**
   * One breath as it arrives, then still.
   *
   * A continuously pulsing element in a bar that is always on screen becomes
   * furniture within a day and a distraction within an hour. A single expansion
   * on arrival does the whole job of drawing the eye.
   */
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withSequence(
      withTiming(1, { duration: 260 }),
      withTiming(0, { duration: 420 }),
    );
  }, [item.id, reduced, pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: pulse.value * 0.5,
    transform: [{ scale: 1 + pulse.value * 0.5 }],
  }));

  return (
    <Animated.View
      key={item.id}
      entering={reduced ? FadeIn.duration(120) : FadeIn.duration(220)}
      exiting={FadeOut.duration(160)}
      style={styles.wrap}
      accessibilityLiveRegion="polite">
      <View style={styles.leading}>
        <Animated.View
          style={[styles.halo, { backgroundColor: tint }, haloStyle]}
          pointerEvents="none"
        />
        <View style={[styles.disc, { backgroundColor: `${tint}22` }]}>
          <Icon size={17} color={tint} strokeWidth={2.2} />
        </View>
      </View>

      <Press
        haptic="light"
        scaleTo={0.99}
        onPress={onDismiss}
        accessibilityLabel={`${item.title}${item.subtitle ? `. ${item.subtitle}` : ''}. Tap to dismiss.`}
        style={styles.body}>
        <AppText variant="callout" numberOfLines={1}>
          {item.title}
        </AppText>
        {item.subtitle ? (
          <AppText variant="caption" color="textDim" numberOfLines={1}>
            {item.subtitle}
          </AppText>
        ) : null}
      </Press>

      {/* The action, when there is one worth offering. An island without a verb
          is just a taller notification. */}
      {onAct ? (
        <Press
          haptic="medium"
          scaleTo={0.94}
          onPress={onAct}
          accessibilityLabel="Open"
          style={[styles.act, { backgroundColor: tint }]}>
          <ChevronRight size={17} color={colors.bg} strokeWidth={2.6} />
        </Press>
      ) : null}

      {count > 1 ? (
        <View style={styles.dots}>
          {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i === index % 4 ? colors.text : colors.hairlineStrong },
              ]}
            />
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

/** How tall the bar becomes while an island is showing. */
export const ISLAND_HEIGHT = 68;

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    height: ISLAND_HEIGHT,
  },
  leading: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 34, height: 34, borderRadius: radius.pill },
  disc: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 1 },
  act: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: radius.pill },
});
