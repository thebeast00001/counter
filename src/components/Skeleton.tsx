import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';

/**
 * Placeholder block shown while stored data is being read.
 *
 * It pulses opacity rather than sweeping a gradient across the surface: a
 * travelling shimmer is exactly the kind of looping motion reduce-motion is
 * meant to suppress, and a soft pulse degrades to a flat block without needing
 * a second implementation.
 */
export function Skeleton({
  width,
  height = 16,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: ViewStyle;
}) {
  const colors = useColors();
  const { ambient } = useMotion();
  const pulse = useSharedValue(0.55);

  useEffect(() => {
    if (ambient === 0) {
      cancelAnimation(pulse);
      pulse.value = 0.55;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.9, { duration: ambient * 0.4, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.55, { duration: ambient * 0.4, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [ambient, pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width: width ?? '100%', height, borderRadius: radius.xs, backgroundColor: colors.surfaceHigh },
        animated,
        style,
      ]}
    />
  );
}

/** A card-shaped group of skeleton lines, matching the widget grid's rhythm. */
export function SkeletonCard({ height = 168 }: { height?: number }) {
  const colors = useColors();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.card, { height, backgroundColor: colors.surface }]}>
      <Skeleton width="40%" height={12} />
      <Skeleton width="62%" height={26} style={styles.gap} />
      <View style={styles.grow} />
      <Skeleton height={8} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: space.base,
  },
  gap: { marginTop: space.md },
  grow: { flex: 1 },
});
