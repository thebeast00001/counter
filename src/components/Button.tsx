import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: React.ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Full-width, bottom-anchored CTA. Pill radius, matching One UI's button shape. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  style,
}: ButtonProps) {
  const colors = useColors();

  const bg =
    variant === 'primary'
      ? colors.accent
      : variant === 'danger'
        ? colors.surfaceHigh
        : colors.surfaceHigh;

  const fg =
    variant === 'primary' ? colors.accentText : variant === 'danger' ? colors.warn : colors.text;

  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      haptic="medium"
      scaleTo={0.975}
      style={[styles.button, { backgroundColor: bg }, style]}>
      {icon}
      <AppText variant="title3" tint={fg}>
        {label}
      </AppText>
    </Press>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 54,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
});
