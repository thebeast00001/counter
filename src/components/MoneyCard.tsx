import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, BadgeIndianRupee, Plus, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { CountUp, moneyFrame } from '@/components/CountUp';
import { Press } from '@/components/Press';
import { useColors } from '@/design/theme';
import { radius, space, spring } from '@/design/tokens';

export type MoneyFace = {
  key: string;
  /** Top-left, in large type. */
  amount: number;
  /** What the amount is. */
  label: string;
  /** Bottom-right, the way a card shows its last four. */
  trailing: string;
  gradient: [string, string, string];
};

export type MoneyAction = { icon: LucideIcon; label: string; href: string };

/**
 * The money screen's header, as a card rather than a heading.
 *
 * A number with a label above it is a statistic. The same number on a card is a
 * balance — and a balance is the thing every person already knows how to read,
 * because every banking app on their phone opens with one. Borrowing that shape
 * costs nothing and means the screen needs no explaining.
 *
 * The actions sit on the dark plinth under the card rather than on the card
 * itself. On the card they compete with the figure for the same surface; below
 * it they read as what you can do about the number above, which is what they
 * are.
 */
export function MoneyCard({
  faces,
  at,
  onSelect,
  actions,
  onAction,
}: {
  faces: MoneyFace[];
  at: number;
  onSelect: (index: number) => void;
  actions: MoneyAction[];
  onAction: (action: MoneyAction) => void;
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const dx = useSharedValue(0);

  const step = (direction: 1 | -1) => {
    onSelect((at + direction + faces.length) % faces.length);
    dx.value = 0;
  };

  const swipe = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .enabled(faces.length > 1)
    .onUpdate((e) => {
      dx.value = e.translationX;
    })
    .onEnd((e) => {
      // Velocity as well as distance: a quick flick should turn the card even
      // when the finger barely travelled, which is how every wallet behaves.
      if (Math.abs(e.translationX) > 60 || Math.abs(e.velocityX) > 600) {
        const direction = e.translationX < 0 ? 1 : -1;
        dx.value = withTiming(
          e.translationX < 0 ? -width : width,
          { duration: 130 },
          (done) => {
            if (done) runOnJS(step)(direction as 1 | -1);
          },
        );
      } else {
        dx.value = withSpring(0, spring.standard);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx.value },
      // A touch of rotation as it leaves, so the card reads as a physical thing
      // being moved rather than a rectangle whose x changed.
      { rotateZ: `${(dx.value / width) * 4}deg` },
    ],
  }));

  const face = faces[Math.min(at, faces.length - 1)];
  if (!face) return null;

  return (
    <View style={[styles.plinth, { backgroundColor: colors.surface }]}>
      {/*
        Swiped, not tapped.
        Tapping through a stack of cards is a shape nobody uses anywhere else —
        every wallet on the phone is a horizontal swipe, and borrowing the
        gesture means the dots below become a position indicator rather than an
        instruction. Tap is kept as the accessible fallback, because a swipe has
        no keyboard or screen-reader equivalent.
      */}
      <GestureDetector gesture={swipe}>
        <Animated.View style={cardStyle}>
          <Press
            haptic="light"
            scaleTo={0.985}
            onPress={() => onSelect((at + 1) % faces.length)}
            accessibilityLabel={`${face.label}: ${face.trailing}. Card ${at + 1} of ${faces.length}. Swipe or tap for the next.`}
            style={styles.card}>
        <LinearGradient
          colors={face.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* A single highlight, static. The card is small enough that motion here
            would be noise, and large enough that a flat fill looks like paper. */}
        <Svg width={400} height={190} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id={`money-${face.key}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.34} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={60} cy={20} r={150} fill={`url(#money-${face.key})`} />
        </Svg>

        <View style={styles.cardTop}>
          <CountUp
            value={face.amount}
            format={moneyFrame}
            variant="largeTitle"
            tint="#FFFFFF"
            accessibilityLabel={`${face.label}`}
          />
          <View style={styles.mark}>
            <BadgeIndianRupee size={26} color="rgba(255,255,255,0.92)" strokeWidth={2} />
          </View>
        </View>

        {/*
          Stacked, not side by side.
          Two single-line labels sharing a row meant whichever was longer got cut
          — "₹3.3L due in 30 days" lost its tail on every device. The label is
          the quieter of the two, so it goes above as an eyebrow and the reading
          gets the full width.
        */}
        <View style={styles.cardFoot}>
          <AppText variant="caption" tint="rgba(255,255,255,0.72)" numberOfLines={1}>
            {face.label}
          </AppText>
          <AppText variant="callout" tint="rgba(255,255,255,0.95)" numberOfLines={1}>
            {face.trailing}
          </AppText>
            </View>
          </Press>
        </Animated.View>
      </GestureDetector>

      <View style={styles.actions}>
        {actions.map((action) => (
          <Press
            key={action.href}
            haptic="medium"
            scaleTo={0.94}
            onPress={() => onAction(action)}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={styles.action}>
            <View style={[styles.actionDisc, { backgroundColor: colors.surfaceHigh }]}>
              <action.icon size={20} color={colors.text} strokeWidth={2.1} />
            </View>
            <AppText variant="caption" color="textDim" numberOfLines={1}>
              {action.label}
            </AppText>
          </Press>
        ))}
      </View>

      {faces.length > 1 ? (
        <View style={styles.dots} accessibilityLabel={`Card ${at + 1} of ${faces.length}`}>
          {faces.map((f, i) => (
            <View
              key={f.key}
              style={[
                styles.dot,
                {
                  backgroundColor: i === at ? colors.text : colors.hairlineStrong,
                  width: i === at ? 16 : 6,
                },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const MONEY_ACTION_ICONS = { Plus, ArrowRight, BadgeIndianRupee };

const styles = StyleSheet.create({
  plinth: { borderRadius: radius.xl, padding: space.sm, gap: space.base },
  card: {
    height: 190,
    borderRadius: radius.lg,
    overflow: 'hidden',
    padding: space.lg,
    justifyContent: 'space-between',
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  mark: { opacity: 0.95 },
  cardFoot: { gap: 1 },

  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: space.sm },
  action: { alignItems: 'center', gap: space.sm, flex: 1 },
  actionDisc: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  dots: { flexDirection: 'row', gap: 5, alignSelf: 'center', paddingBottom: space.sm },
  dot: { height: 6, borderRadius: radius.pill },
});
