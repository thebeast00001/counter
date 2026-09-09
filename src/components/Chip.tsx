import { StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: React.ReactNode;
};

export function Chip({ label, selected = false, onPress, icon }: ChipProps) {
  const colors = useColors();

  return (
    <Press
      onPress={onPress}
      haptic="selection"
      scaleTo={0.94}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.accentSoft : colors.surfaceHigh,
          borderColor: selected ? colors.accent : 'transparent',
        },
      ]}>
      {icon}
      <AppText variant="callout" tint={selected ? colors.accent : colors.textDim}>
        {label}
      </AppText>
    </Press>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.base,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
