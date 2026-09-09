import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { useColors, useTheme } from '@/design/theme';
import { radius } from '@/design/tokens';
import { useBusiness } from '@/state/business';

/**
 * The profile circle.
 *
 * Initials rather than an avatar: there is no photo to show unless the owner has
 * added one, and a generic silhouette would be a placeholder pretending to be
 * content. Two letters of the owner's own name is the smallest thing that is
 * actually theirs.
 *
 * It carried a gradient ring and an attention dot once. Both went, for the same
 * reason: this is the one control on a screen that should read as the owner
 * rather than as a status, and a badge on it costs the avatar its identity.
 *
 * Lives here rather than on the home screen because both collapsing headers show
 * it, and the second copy had already started to drift from the first.
 */
export function ProfileButton({
  onPress,
  onColour = false,
}: {
  onPress: () => void;
  /** True when it sits on a coloured header rather than the page background. */
  onColour?: boolean;
}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const { profile } = useBusiness();

  const initials = (profile?.ownerName ?? profile?.name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <Press
      haptic="light"
      scaleTo={0.9}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Your account and settings"
      style={[
        styles.button,
        {
          backgroundColor: onColour ? 'rgba(255,255,255,0.9)' : isDark ? '#17171C' : '#FFFFFF',
        },
      ]}>
      {profile?.avatarUri ? (
        <Image source={{ uri: profile.avatarUri }} style={styles.image} contentFit="cover" />
      ) : (
        <AppText variant="footnote" tint={onColour ? '#0B0B0F' : colors.text}>
          {initials || '?'}
        </AppText>
      )}
    </Press>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
});
