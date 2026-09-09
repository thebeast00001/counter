import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  CloudUpload,
  Lock,
  Settings2,
  Sparkles,
  Users,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Press } from '@/components/Press';
import { SectionHeader } from '@/components/Section';
import { getKey } from '@/ai/keys';
import { pickAvatar } from '@/lib/avatar';
import { buildIndex } from '@/domain/analytics';
import { money } from '@/domain/metrics';
import { wrappableMonths } from '@/domain/wrapped';
import { useMotion } from '@/design/motion';
import { useColors, useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatMonthYear } from '@/lib/time';
import { useBusiness, useIndex } from '@/state/business';
import { useBarInset } from '@/state/dock';
import { isSealed } from '@/state/vault';

const DAY = 24 * 60 * 60 * 1000;

/**
 * The account, as a place rather than a menu.
 *
 * This was a sheet with five rows. A sheet is the right shape for a decision and
 * the wrong one for a destination: it cannot hold anything but a list, it cannot
 * be linked to, and it disappears the moment you look away. Everything an owner
 * might want to check about *their side* of the app — who they are, how long they
 * have been running it, what is protecting the records, what the month looked
 * like — now has somewhere to live.
 */
export default function AccountScreen() {
  const colors = useColors();
  const { isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { profile, data, updateProfile } = useBusiness();
  const index = useIndex();

  const [sealed, setSealed] = useState(false);

  const setPhoto = async () => {
    const uri = await pickAvatar();
    if (uri) updateProfile({ avatarUri: uri });
  };
  const [assistantOn, setAssistantOn] = useState(false);

  useEffect(() => {
    let alive = true;
    isSealed()
      .then((ok) => alive && setSealed(ok))
      .catch(() => {});
    getKey()
      .then((k) => alive && setAssistantOn(Boolean(k)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => {
    if (!profile) return null;
    const now = Date.now();
    const idx = index ?? buildIndex(data);
    const live = data.parties.filter((p) => !p.archivedAt);
    const first = Math.min(profile.createdAt, ...data.parties.map((p) => p.joinedAt), now);
    const days = Math.max(1, Math.round((now - first) / DAY));

    const collected = data.money
      .filter((m) => m.direction === 'in' && m.status === 'settled')
      .reduce((sum, m) => sum + m.amount, 0);

    const seen90 = live.filter((p) => {
      const last = idx.lastSeen.get(p.id);
      return last != null && last >= now - 90 * DAY;
    }).length;

    return {
      records: data.parties.length + data.money.length + data.engagements.length,
      live: live.length,
      seen90,
      collected,
      days,
    };
  }, [profile, data, index]);

  const months = useMemo(() => wrappableMonths(data, Date.now()), [data]);

  if (!profile || !stats) return null;

  const initials = (profile.ownerName ?? profile.name)
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  /**
   * Three, and none of them duplicated from Settings.
   *
   * This list had eight rows — team, what you sell, memory, automations, coming
   * up — and Settings' own "Go to" section listed every one of them. Two menus
   * with the same contents is worse than either alone: it makes the app feel
   * bigger than it is and teaches that neither list is the real one.
   *
   * Account answers "who am I and what is protecting my data". Settings answers
   * "how does the app behave". Everything else belongs behind Settings.
   */
  const rows = [
    {
      icon: <Settings2 size={16} color={colors.accent} strokeWidth={2} />,
      label: 'Settings',
      sub: 'Appearance, privacy, language, and everywhere else',
      href: '/you',
    },
    {
      icon: <Sparkles size={16} color={colors.accent} strokeWidth={2} />,
      label: 'Assistant',
      sub: assistantOn ? 'Connected' : 'Optional. Nothing identifying leaves this phone',
      href: '/assistant',
    },
    {
      icon: <Users size={16} color={colors.accent} strokeWidth={2} />,
      label: 'Add from contacts',
      sub: `Bring ${profile.vocabulary.party.many.toLowerCase()} in from this phone, any time`,
      href: '/contacts',
    },
    {
      icon: <CloudUpload size={16} color={colors.accent} strokeWidth={2} />,
      label: 'Backup',
      sub: 'Optional. Off by default',
      href: '/cloud',
    },
  ];


  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press
          haptic="light"
          scaleTo={0.9}
          onPress={() => router.back()}
          accessibilityLabel="Back"
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <ArrowLeft size={19} color={colors.text} strokeWidth={2.2} />
        </Press>
        <AppText variant="title3">Account</AppText>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        {/* ------------------------------------------------------ identity -- */}
        <Animated.View entering={enter(0)} style={styles.gutter}>
          <View style={styles.identity}>
            {/* Tap to set a photo. The only place in the app that opens the
                photo library, and it asks for nothing until you do. */}
            <Press
              haptic="light"
              scaleTo={0.94}
              onPress={setPhoto}
              accessibilityRole="button"
              accessibilityLabel={profile.avatarUri ? 'Change your photo' : 'Add a photo'}
              style={[styles.avatarWrap, { backgroundColor: isDark ? '#17171C' : '#FFFFFF' }]}>
              {profile.avatarUri ? (
                <Image source={{ uri: profile.avatarUri }} style={styles.avatarImage} contentFit="cover" />
              ) : (
                <AppText variant="title2" color="textDim">
                  {initials || '?'}
                </AppText>
              )}
              <View style={[styles.avatarBadge, { backgroundColor: colors.accent }]}>
                <Camera size={12} color={colors.accentText} strokeWidth={2.4} />
              </View>
            </Press>
            <View style={styles.identityBody}>
              <AppText variant="title2" numberOfLines={1}>
                {profile.ownerName ?? profile.name}
              </AppText>
              <AppText variant="footnote" color="textDim" numberOfLines={1}>
                {profile.name} · running {stats.days} day{stats.days === 1 ? '' : 's'}
              </AppText>
            </View>
          </View>
        </Animated.View>

        {/* --------------------------------------------------------- stats -- */}
        <Animated.View entering={enter(1)} style={styles.gutter}>
          <View style={styles.stats}>
            {[
              { label: profile.vocabulary.party.many, value: String(stats.live) },
              { label: 'Seen in 90 days', value: String(stats.seen90) },
              { label: 'Taken, all time', value: money(stats.collected) },
              { label: 'Records held', value: stats.records.toLocaleString() },
            ].map((stat) => (
              <View key={stat.label} style={[styles.stat, { backgroundColor: colors.surface }]}>
                <AppText variant="title3" tabular>
                  {stat.value}
                </AppText>
                <AppText variant="caption" color="textFaint" numberOfLines={1}>
                  {stat.label}
                </AppText>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* ----------------------------------------------------- the month -- */}
        {months.length > 0 ? (
          <Animated.View entering={enter(2)} style={styles.gutter}>
            <Press
              haptic="medium"
              scaleTo={0.98}
              onPress={() => router.push(`/wrapped?month=${months[0]}` as never)}
              style={styles.wrapCard}>
              <LinearGradient
                colors={['#2A1B4D', '#4B2E7A', '#7C5CFF']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.wrapBody}>
                <AppText variant="caption" tint="#D8CCFF" style={styles.wrapEyebrow}>
                  YOUR MONTH
                </AppText>
                <AppText variant="title2" tint="#FFFFFF">
                  {formatMonthYear(months[0])}
                </AppText>
                <AppText variant="footnote" tint="#D8CCFF">
                  The month as a story, in about a minute
                </AppText>
              </View>
              <ChevronRight size={20} color="#FFFFFF" strokeWidth={2.2} />
            </Press>
          </Animated.View>
        ) : null}

        {/* --------------------------------------------------------- links -- */}
        <Animated.View entering={enter(3)}>
          <SectionHeader title="Manage" />
          <View style={styles.gutter}>
            <Card tone="surface" padded={false}>
              {rows.map((row, i) => (
                <Press
                  key={row.href}
                  haptic="light"
                  scaleTo={0.99}
                  onPress={() => router.push(row.href as never)}
                  style={[
                    styles.listRow,
                    i > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.hairline,
                    },
                  ]}>
                  <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>{row.icon}</View>
                  <View style={styles.rowBody}>
                    <AppText variant="callout">{row.label}</AppText>
                    <AppText variant="caption" color="textFaint" numberOfLines={1}>
                      {row.sub}
                    </AppText>
                  </View>
                  <ChevronRight size={16} color={colors.textFaint} strokeWidth={2} />
                </Press>
              ))}
            </Card>
          </View>
        </Animated.View>

        {/* --------------------------------------------------------- trust -- */}
        <Animated.View entering={enter(4)} style={styles.gutter}>
          <View style={[styles.trust, { backgroundColor: colors.surface }]}>
            <View style={[styles.icon, { backgroundColor: colors.successSoft }]}>
              <Lock size={15} color={colors.success} strokeWidth={2} />
            </View>
            <AppText variant="footnote" color="textDim" style={styles.trustText}>
              {sealed
                ? `${stats.records.toLocaleString()} records, encrypted with a key held in this phone's secure hardware. No account, no upload, no server.`
                : `${stats.records.toLocaleString()} records, stored on this phone. This device cannot encrypt at rest — turn on the app lock in Settings.`}
            </AppText>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    paddingVertical: space.md,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingTop: space.sm, gap: space.base },
  gutter: { paddingHorizontal: space.gutter },

  identity: { flexDirection: 'row', alignItems: 'center', gap: space.base },
  avatarWrap: {
    width: 66,
    height: 66,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: '100%', height: '100%', borderRadius: radius.pill },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityBody: { flex: 1, gap: 2 },

  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: {
    flexGrow: 1,
    flexBasis: '46%',
    gap: 2,
    padding: space.base,
    borderRadius: radius.md,
  },

  wrapCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  wrapBody: { flex: 1, gap: 2 },
  wrapEyebrow: { letterSpacing: 1 },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 2 },

  trust: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  trustText: { flex: 1, lineHeight: 19 },
});
