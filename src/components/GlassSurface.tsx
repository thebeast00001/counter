import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { useTheme } from '@/design/theme';

export type GlassSurfaceProps = ViewProps & {
  children: React.ReactNode;
  radius: number;
  intensity?: number;
};

/**
 * Frosted container for the floating bars.
 *
 * On iOS this is a real system blur. On Android it is a layered opaque fill,
 * and that is a deliberate decision rather than a shortcut:
 *
 * SDK 57's Android blur requires wrapping the content in a `<BlurTargetView>`
 * and handing the BlurView its ref. Wrapping the tab navigator that way crashes
 * the render thread outright — `Fatal signal 11 (SIGSEGV)` in RenderThread on
 * every screen transition, because the blur samples a subtree that contains the
 * blurring view itself and recurses until the native stack overflows.
 *
 * The visible problem blur was solving was that the bars read as *transparent*,
 * so content slid underneath and was legible through them. A high-opacity fill
 * with a top highlight fixes exactly that, costs nothing, and cannot crash. An
 * effect that takes the app down mid-demo is worth less than one that survives.
 */
export function GlassSurface({
  children,
  radius,
  style,
  intensity = 40,
  ...rest
}: GlassSurfaceProps) {
  const { colors, isDark } = useTheme();
  const isIOS = Platform.OS === 'ios';

  return (
    <View style={[{ borderRadius: radius }, styles.clip, style]} {...rest}>
      {isIOS ? (
        <BlurView intensity={intensity} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      ) : null}

      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glass }]} />

      {/* A brighter hairline along the top edge. This is what actually sells the
          material — light catching the lip of a raised surface. */}
      <View
        style={[styles.highlight, { backgroundColor: colors.hairlineStrong }]}
        pointerEvents="none"
      />

      <View
        style={[
          StyleSheet.absoluteFill,
          styles.border,
          { borderRadius: radius, borderColor: colors.hairlineStrong },
        ]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  border: { borderWidth: StyleSheet.hairlineWidth },
  highlight: { position: 'absolute', top: 0, left: 12, right: 12, height: StyleSheet.hairlineWidth },
});
