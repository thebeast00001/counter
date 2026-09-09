import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useColors } from '@/design/theme';
import { radius, spring } from '@/design/tokens';

const W = 50;
const H = 30;
const KNOB = 24;

export function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  const on = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    on.value = withSpring(value ? 1 : 0, spring.press);
  }, [value, on]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [colors.surfaceHigh, colors.accent]),
  }));

  // Reads the same spring the track colour uses, so the knob and the fill stay
  // locked together instead of drifting apart mid-transition.
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: on.value * (W - KNOB - 6) }],
  }));

  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onChange(!value);
      }}
      hitSlop={8}>
      <Animated.View style={[styles.track, trackStyle, disabled && styles.disabled]}>
        <Animated.View style={[styles.knob, knobStyle, { backgroundColor: colors.accentText }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: W,
    height: H,
    borderRadius: radius.pill,
    padding: 3,
    justifyContent: 'center',
  },
  knob: { width: KNOB, height: KNOB, borderRadius: radius.pill },
  disabled: { opacity: 0.4 },
});
