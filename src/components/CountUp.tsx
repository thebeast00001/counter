import { useEffect } from 'react';
import { TextInput, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { type as typeScale, type Palette } from '@/design/tokens';

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

/**
 * A number that arrives rather than appears.
 *
 * A figure that is simply there reads as a database read. The same figure
 * counting up reads as something earned, which is why every product whose whole
 * job is showing you money does this and none of them have stopped.
 *
 * The implementation is the standard one and worth explaining, because it looks
 * wrong at first glance: it animates a `TextInput`, not a `Text`. React Native
 * cannot drive text content from the UI thread — `Text` has no animatable prop
 * that accepts a string — so a per-frame update through `Text` would round-trip
 * to JS sixty times a second and stutter under any load. `TextInput` exposes
 * `text` as a native prop, so Reanimated writes each frame directly on the UI
 * thread and the count never drops a frame no matter what JS is doing.
 *
 * It is made non-interactive and styled to be indistinguishable from `AppText`.
 */
export function CountUp({
  value,
  format,
  variant = 'metric',
  color = 'text',
  tint,
  style,
  duration: ms = 700,
  accessibilityLabel,
}: {
  value: number;
  /** Applied per frame, so it must be cheap — no Intl, no allocation-heavy work. */
  format: (n: number) => string;
  variant?: keyof typeof typeScale;
  color?: keyof Pick<Palette, 'text' | 'textDim' | 'textFaint' | 'accent' | 'success' | 'warn'>;
  tint?: string;
  style?: TextStyle;
  duration?: number;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const { reduced } = useMotion();
  const shown = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      shown.value = value;
      return;
    }
    // Ease-out: fast at the start where the digits are meaningless, slow into
    // the final value where they are the whole point.
    shown.value = withTiming(value, { duration: ms, easing: Easing.out(Easing.cubic) });
  }, [value, ms, reduced, shown]);

  const animatedProps = useAnimatedProps(() => {
    // Runs on the UI thread; `format` must be a worklet-safe pure function.
    return { text: format(shown.value) } as never;
  });

  return (
    <AnimatedInput
      editable={false}
      // Announced as its final value, not whatever frame the reader lands on.
      accessible
      accessibilityLabel={accessibilityLabel ?? format(value)}
      underlineColorAndroid="transparent"
      value={format(value)}
      animatedProps={animatedProps}
      style={[
        typeScale[variant] as TextStyle,
        {
          color: tint ?? colors[color],
          // TextInput carries platform padding that Text does not; without this
          // a counting number sits a few points lower than a static one beside it.
          padding: 0,
          margin: 0,
          includeFontPadding: false,
          fontVariant: ['tabular-nums'],
          letterSpacing: -0.15,
        },
        style,
      ]}
    />
  );
}

/**
 * Rupees, formatted per frame.
 *
 * A worklet, so it can be called from the UI thread. Deliberately allocation
 * light and Intl-free — `toLocaleString` is neither, and calling it sixty times
 * a second is exactly the kind of thing that makes a count-up stutter on a
 * mid-range Android.
 */
export function moneyFrame(n: number): string {
  'worklet';
  const v = Math.round(n);
  // Thresholds compare the magnitude, matching `money()` in domain/metrics.
  // Testing the signed value means a negative never compacts, so a counter
  // passing through a loss would jump from "-₹6.6k" width to "₹-6624" width.
  const sign = v < 0 ? '-' : '';
  const a = v < 0 ? -v : v;
  if (a >= 100000) return `${sign}₹${(a / 100000).toFixed(1)}L`;
  if (a >= 10000) return `${sign}₹${Math.round(a / 1000)}k`;
  if (a >= 1000) return `${sign}₹${(a / 1000).toFixed(1)}k`;
  return `${sign}₹${a}`;
}

export function countFrame(n: number): string {
  'worklet';
  return String(Math.round(n));
}
