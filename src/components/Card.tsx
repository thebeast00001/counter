import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';

export type CardProps = ViewProps & {
  /** `alt` sits one step up the elevation ramp; `plain` drops the fill entirely. */
  tone?: 'surface' | 'alt' | 'high' | 'plain';
  padded?: boolean;
  bordered?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Card({
  tone = 'surface',
  padded = true,
  bordered = false,
  style,
  children,
  ...rest
}: CardProps) {
  const colors = useColors();

  const fill =
    tone === 'plain'
      ? 'transparent'
      : tone === 'alt'
        ? colors.surfaceAlt
        : tone === 'high'
          ? colors.surfaceHigh
          : colors.surface;

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: fill },
        padded && styles.padded,
        bordered && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
        style,
      ]}
      {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  padded: {
    padding: space.lg,
  },
});
