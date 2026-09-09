import * as Haptics from 'expo-haptics';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useColors } from '@/design/theme';
import { radius, spring } from '@/design/tokens';

const THUMB = 30;
const TRACK_H = 8;

export type SliderProps = {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Marks drawn on the track, in value units. */
  ticks?: number[];
  /** Spoken name of the control. */
  label?: string;
  /** Turns the raw number into something worth hearing, e.g. "45 minutes". */
  valueText?: (value: number) => string;
};

/**
 * Continuous slider with detent haptics.
 *
 * A tick fires on every step crossing rather than only on release, which is what
 * makes a drag feel like it has physical notches. The pulse is intentionally the
 * lightest one available — at ~70 steps across the range, anything stronger
 * turns a single drag into a buzz.
 */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 5,
  ticks = [],
  label,
  valueText,
}: SliderProps) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const lastStep = useRef(value);

  const travel = Math.max(width - THUMB, 1);
  const ratio = (value - min) / (max - min);

  const dragging = useSharedValue(0);

  const commit = useCallback(
    (nextRatio: number) => {
      const raw = min + nextRatio * (max - min);
      const snapped = Math.min(max, Math.max(min, Math.round(raw / step) * step));
      if (snapped !== lastStep.current) {
        lastStep.current = snapped;
        Haptics.selectionAsync().catch(() => {});
        onChange(snapped);
      }
    },
    [min, max, step, onChange],
  );

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      dragging.value = withSpring(1, spring.press);
      runOnJS(commit)(Math.min(Math.max((e.x - THUMB / 2) / travel, 0), 1));
    })
    .onUpdate((e) => {
      runOnJS(commit)(Math.min(Math.max((e.x - THUMB / 2) / travel, 0), 1));
    })
    .onFinalize(() => {
      dragging.value = withSpring(0, spring.standard);
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + dragging.value * 0.15 }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.hit}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        // An "adjustable" element is how a screen reader offers swipe-up and
        // swipe-down to change a value; without the actions those gestures do
        // nothing and the control is unusable without sight.
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label ?? 'Value'}
        accessibilityValue={{ min, max, now: value, text: valueText?.(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const delta = e.nativeEvent.actionName === 'increment' ? step : -step;
          const next = Math.min(max, Math.max(min, value + delta));
          if (next !== value) {
            lastStep.current = next;
            onChange(next);
          }
        }}>
        <View style={[styles.track, { backgroundColor: colors.surfaceHigh }]}>
          <View
            style={[styles.fill, { width: ratio * travel + THUMB / 2, backgroundColor: colors.accent }]}
          />
        </View>

        {ticks.map((t) => {
          const r = (t - min) / (max - min);
          const passed = t <= value;
          return (
            <View
              key={t}
              pointerEvents="none"
              style={[
                styles.tick,
                {
                  left: THUMB / 2 + r * travel - 1,
                  backgroundColor: passed ? colors.accentText : colors.textFaint,
                  opacity: passed ? 0.5 : 0.35,
                },
              ]}
            />
          );
        })}

        <Animated.View
          style={[
            styles.thumb,
            thumbStyle,
            { left: ratio * travel, backgroundColor: colors.accent, borderColor: colors.bg },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hit: { height: 44, justifyContent: 'center' },
  track: {
    height: TRACK_H,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginHorizontal: 0,
  },
  fill: { height: '100%', borderRadius: radius.pill },
  tick: { position: 'absolute', width: 2, height: 2, borderRadius: 1 },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: radius.pill,
    borderWidth: 3,
  },
});
