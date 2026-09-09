import { Hand } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { KEYS, loadJSON, saveJSON } from '@/state/persist';

/**
 * Shown once, ever, then never again.
 *
 * Long-press is invisible by nature, and this app hides its entire explanation
 * layer behind it — a user who never discovers the gesture never sees why any
 * number is what it is. One quiet pointer the first time the home screen has
 * something to press is the cheapest fix; a recurring tip would be a tax on
 * everyone who already knows.
 *
 * Keyed by name so a second mark can be added elsewhere later without this one
 * re-appearing.
 */
export function CoachMark({ id, text }: { id: string; text: string }) {
  const colors = useColors();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    loadJSON<Record<string, boolean>>(KEYS.coachMarks, {})
      .then((seen) => {
        if (alive && !seen?.[id]) setShow(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);

  const dismiss = () => {
    setShow(false);
    loadJSON<Record<string, boolean>>(KEYS.coachMarks, {})
      .then((seen) => saveJSON(KEYS.coachMarks, { ...seen, [id]: true }))
      .catch(() => {});
  };

  if (!show) return null;

  return (
    <Animated.View entering={FadeIn.duration(400).delay(900)} exiting={FadeOut.duration(160)}>
      <Press
        haptic="light"
        scaleTo={0.98}
        onPress={dismiss}
        accessibilityLabel={`${text}. Tap to dismiss.`}
        style={[styles.root, { backgroundColor: colors.accentSoft }]}>
        <Hand size={15} color={colors.accent} strokeWidth={2} />
        <AppText variant="caption" tint={colors.accent} style={styles.text}>
          {text}
        </AppText>
        <AppText variant="caption" color="textFaint">
          Got it
        </AppText>
      </Press>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderRadius: radius.md,
    marginTop: space.md,
  },
  text: { flex: 1, lineHeight: 16 },
});
