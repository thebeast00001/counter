import { Lock } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { APP_NAME } from '@/config';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { useSecurity } from '@/state/security';

/**
 * Shown whenever the app is locked.
 *
 * It prompts once automatically on mount — making the user tap a button before
 * the OS prompt appears is friction with no security benefit — and leaves a
 * manual retry for the case where they dismissed it.
 */
export function LockScreen() {
  const colors = useColors();
  const { unlock, biometricLabel } = useSecurity();

  useEffect(() => {
    unlock();
  }, [unlock]);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <Animated.View entering={FadeIn.duration(300)} style={styles.inner}>
        <View style={[styles.badge, { backgroundColor: colors.surfaceHigh }]}>
          <Lock size={26} color={colors.textDim} strokeWidth={1.9} />
        </View>

        <AppText variant="title1" center>
          {APP_NAME} is locked
        </AppText>
        <AppText variant="footnote" color="textDim" center style={styles.blurb}>
          Your focus history and tasks stay on this device. Unlock with{' '}
          {biometricLabel.toLowerCase()} to continue.
        </AppText>

        <Button label="Unlock" onPress={unlock} style={styles.cta} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  inner: { alignItems: 'center', gap: space.sm, width: '100%' },
  badge: {
    width: 68,
    height: 68,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  blurb: { lineHeight: 19, marginTop: 2 },
  cta: { marginTop: space.xxl, alignSelf: 'stretch' },
});
