import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';

export type EmptyArt = 'tasks' | 'sessions' | 'calendar' | 'search';

/**
 * Line illustrations drawn from the app's own furniture — a task row, a focus
 * ring, a month grid. A generic mascot would say nothing; showing a faded
 * version of the thing that will appear here tells you what the screen is for.
 */
function Art({ kind, tint, faint }: { kind: EmptyArt; tint: string; faint: string }) {
  const common = { stroke: faint, strokeWidth: 2, fill: 'none' as const };

  if (kind === 'sessions') {
    return (
      <Svg width={96} height={96} viewBox="0 0 96 96">
        <Circle cx={48} cy={48} r={30} {...common} />
        <Path d="M48 28 A20 20 0 0 1 68 48" stroke={tint} strokeWidth={4} strokeLinecap="round" fill="none" />
        <Path d="M48 38 L48 48 L55 52" {...common} strokeLinecap="round" />
      </Svg>
    );
  }

  if (kind === 'calendar') {
    return (
      <Svg width={96} height={96} viewBox="0 0 96 96">
        <Rect x={18} y={24} width={60} height={54} rx={8} {...common} />
        <Path d="M18 40 H78" {...common} />
        <Path d="M33 18 V30 M63 18 V30" {...common} strokeLinecap="round" />
        <Rect x={30} y={50} width={10} height={10} rx={3} fill={tint} />
        <Rect x={48} y={50} width={10} height={10} rx={3} fill={faint} opacity={0.5} />
      </Svg>
    );
  }

  if (kind === 'search') {
    return (
      <Svg width={96} height={96} viewBox="0 0 96 96">
        <Circle cx={43} cy={43} r={20} {...common} />
        <Path d="M58 58 L74 74" stroke={tint} strokeWidth={4} strokeLinecap="round" fill="none" />
      </Svg>
    );
  }

  // tasks
  return (
    <Svg width={96} height={96} viewBox="0 0 96 96">
      <Rect x={16} y={26} width={64} height={14} rx={7} {...common} />
      <Rect x={16} y={48} width={64} height={14} rx={7} {...common} />
      <Rect x={16} y={70} width={40} height={14} rx={7} {...common} opacity={0.5} />
      <Circle cx={70} cy={77} r={11} fill={tint} />
      <Path d="M65 77 L69 81 L76 73" stroke="#FFFFFF" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export type EmptyStateProps = {
  art: EmptyArt;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * The way out, as one object.
   *
   * An empty state without one is a dead end wearing an illustration — it tells
   * you nothing is here and leaves you to work out what to do about it. Every
   * empty state in this app names the next action.
   */
  action?: { label: string; onPress: () => void };
};

export function EmptyState({ art, title, body, actionLabel, onAction, action }: EmptyStateProps) {
  const colors = useColors();
  const label = action?.label ?? actionLabel;
  const press = action?.onPress ?? onAction;

  return (
    <View style={styles.root} accessibilityRole="summary">
      <Art kind={art} tint={colors.accent} faint={colors.textFaint} />

      <AppText variant="title3" center style={styles.title}>
        {title}
      </AppText>
      <AppText variant="footnote" color="textDim" center style={styles.body}>
        {body}
      </AppText>

      {label && press ? (
        <Press
          haptic="medium"
          onPress={press}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={[styles.action, { backgroundColor: colors.accent }]}>
          <AppText variant="callout" tint={colors.accentText}>
            {label}
          </AppText>
        </Press>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    paddingHorizontal: space.xxl,
    paddingTop: space.huge,
    gap: space.sm,
  },
  title: { marginTop: space.lg },
  body: { lineHeight: 20, maxWidth: 320 },
  action: {
    marginTop: space.lg,
    paddingHorizontal: space.xl,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
