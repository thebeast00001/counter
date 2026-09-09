import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Aurora } from '@/components/Aurora';
import { gradientAt, poolsFor } from '@/design/gradients';
import { useTheme } from '@/design/theme';

/**
 * A full-bleed mesh gradient.
 *
 * Two parts: a vertical ramp that sets the overall value, and three drifting
 * pools of light over it. The ramp alone would be a gradient; the pools are what
 * make it look like light rather than paint.
 *
 * `index` picks the theme, so a caller can simply hand it a card number and get
 * a different one each time without knowing the palette exists.
 */
export function MeshBackground({ index }: { index: number }) {
  const { isDark } = useTheme();
  const theme = gradientAt(index);
  const set = isDark ? theme.dark : theme.light;

  return (
    <Animated.View
      // Keyed on the theme so moving between cards cross-fades the whole
      // treatment rather than swapping colours inside a live one, which reads as
      // a glitch.
      key={theme.key}
      entering={FadeIn.duration(420)}
      style={StyleSheet.absoluteFill}
      pointerEvents="none">
      <LinearGradient colors={set.base} locations={[0, 0.52, 1]} style={StyleSheet.absoluteFill} />
      <Aurora blobs={poolsFor(theme, isDark, index)} />

      {/*
        A vertical scrim over the lower half. The pools are bright enough to eat
        a headline where they overlap, and a story screen whose text is only
        sometimes legible is worse than one with a duller background.
      */}
      <LinearGradient
        colors={
          isDark
            ? ['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.62)']
            : ['transparent', 'rgba(255,255,255,0.32)', 'rgba(255,255,255,0.7)']
        }
        locations={[0.3, 0.66, 1]}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}
