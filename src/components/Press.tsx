import * as Haptics from 'expo-haptics';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { spring } from '@/design/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type HapticStyle = 'light' | 'medium' | 'selection' | 'none';

export type PressProps = Omit<PressableProps, 'style'> & {
  /** Target scale while held. Smaller targets need less travel to read as pressed. */
  scaleTo?: number;
  haptic?: HapticStyle;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

function fireHaptic(kind: HapticStyle) {
  if (kind === 'none') return;
  // Fire-and-forget: a failed haptic must never interrupt the interaction.
  if (kind === 'selection') {
    Haptics.selectionAsync().catch(() => {});
    return;
  }
  const style =
    kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light;
  Haptics.impactAsync(style).catch(() => {});
}

/**
 * Every tappable surface in the app. Springs down on press-in and fires a haptic
 * at the same instant — the simultaneity is what makes it feel native rather
 * than animated.
 *
 * The pressable *is* the animated element rather than wrapping one. An earlier
 * version put the style on an inner view, which meant the outer Pressable had no
 * width of its own: any child relying on `flex: 1` collapsed to zero and
 * silently vanished. One element keeps layout and animation on the same box.
 */
export function Press({
  scaleTo = 0.965,
  haptic = 'light',
  onPressIn,
  onPressOut,
  style,
  children,
  disabled,
  ...rest
}: PressProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      // Default to a button so nothing tappable reaches a screen reader
      // unlabelled by role. Call sites that are really a checkbox, radio, or
      // switch pass their own role and it wins.
      accessibilityRole="button"
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, spring.press);
        fireHaptic(haptic);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, spring.press);
        onPressOut?.(e);
      }}
      style={[style, animated, disabled ? { opacity: 0.45 } : null]}
      {...rest}>
      {children}
    </AnimatedPressable>
  );
}
