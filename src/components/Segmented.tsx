import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { useColors } from '@/design/theme';
import { radius, spring } from '@/design/tokens';

const PAD = 4;

export type SegmentedOption<T extends string> = { value: T; label: string };

export type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
};

/**
 * Segmented control with a sliding thumb.
 *
 * Same continuity principle as the tab bar: one thumb travels between slots
 * rather than backgrounds cross-fading, so the control reads as a physical
 * switch.
 */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const colors = useColors();
  const [width, setWidth] = useState(0);

  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const slot = width > 0 ? (width - PAD * 2) / options.length : 0;

  const x = useSharedValue(0);
  const positioned = useRef(false);

  /**
   * The thumb is placed during layout, not in an effect afterwards.
   *
   * Effects run after paint, so measuring in one meant the very first frame that
   * had a width drew the thumb at its default of zero — sitting under the *first*
   * option — and only corrected on the frame after. On a screen with three of
   * these mounting at once it read as every control briefly claiming "Owner"
   * before flicking to the right answer, which looked like the app deciding
   * rather than the app knowing.
   *
   * Writing the shared value inside `onLayout` lands it before the re-render that
   * `setWidth` schedules, so the thumb's first appearance is already correct.
   */
  const place = (measured: number) => {
    const nextSlot = (measured - PAD * 2) / options.length;
    if (nextSlot <= 0) return;
    if (!positioned.current) {
      positioned.current = true;
      x.value = PAD + index * nextSlot;
    }
  };

  // Only handles changes after the first placement. The guard matters: without
  // it a re-measure (rotation, font scaling) would spring the thumb across the
  // control from wherever it happened to be.
  useEffect(() => {
    if (slot <= 0 || !positioned.current) return;
    x.value = withSpring(PAD + index * slot, spring.standard);
  }, [index, slot, x]);

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      accessibilityRole="radiogroup"
      style={[styles.track, { backgroundColor: colors.surfaceHigh }]}
      onLayout={(e) => {
        const measured = e.nativeEvent.layout.width;
        place(measured);
        setWidth(measured);
      }}>
      {slot > 0 ? (
        <Animated.View
          style={[styles.thumb, thumbStyle, { width: slot, backgroundColor: colors.surface }]}
          pointerEvents="none"
        />
      ) : null}

      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            style={styles.item}
            onPress={() => {
              if (selected) return;
              Haptics.selectionAsync().catch(() => {});
              onChange(o.value);
            }}>
            {/*
              Held to one line and allowed to shrink.

              The labels come from the business's own vocabulary, so a salon gets
              "Appointment" and a clinic "Patient" in a quarter of the screen
              width. At `callout` those do not fit, and with no cap the text
              wrapped and spilled past the rounded pill it sits in. Shrinking is
              better than an ellipsis here: "Appoint…" names nothing, and these
              four words are the whole navigation of the screen.
            */}
            <AppText
              variant="callout"
              tint={selected ? colors.text : colors.textDim}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={styles.label}
            >
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 44,
    borderRadius: radius.md,
    padding: PAD,
    alignItems: 'center',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    paddingHorizontal: 4,
  },
  label: { textAlign: 'center' },
  thumb: {
    position: 'absolute',
    top: PAD,
    bottom: PAD,
    borderRadius: radius.sm,
  },
});
