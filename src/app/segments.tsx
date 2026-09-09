import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ChevronRight, MessageCircle } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Deep } from '@/components/Deep';
import { Press } from '@/components/Press';
import { partyValue } from '@/domain/analytics';
import { money } from '@/domain/metrics';
import { segments } from '@/domain/intel';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { relativeDays, useTick } from '@/lib/time';
import { useBarInset } from '@/state/dock';
import { useBusiness, useIndex } from '@/state/business';

/**
 * Groups defined by behaviour rather than by a label somebody typed.
 *
 * A fixed set rather than a query builder. A query builder is a feature for
 * people who enjoy software; the owner of a tuition centre wants "the ones who
 * used to come weekly and stopped", and that should be one tap rather than four
 * dropdowns and an AND.
 */
export default function SegmentsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const params = useLocalSearchParams<{ id?: string }>();

  const { profile, data } = useBusiness();
  const index = useIndex();
  const now = useTick(300_000);

  const groups = useMemo(
    () => (profile ? segments(profile, data, now, index) : []),
    [profile, data, now, index],
  );

  const [openId, setOpenId] = useState<string | null>(params.id ?? null);
  const open = groups.find((g) => g.id === openId) ?? null;

  if (!profile) return null;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press
          haptic="light"
          scaleTo={0.9}
          onPress={() => (open ? setOpenId(null) : router.back())}
          accessibilityLabel="Back"
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <ArrowLeft size={19} color={colors.text} strokeWidth={2.2} />
        </Press>
        <View style={styles.barBody}>
          <AppText variant="title3" numberOfLines={1}>
            {open ? open.label : 'Groups'}
          </AppText>
          <AppText variant="caption" color="textFaint" numberOfLines={1}>
            {open
              ? `${open.partyIds.length} ${open.partyIds.length === 1 ? profile.vocabulary.party.one.toLowerCase() : profile.vocabulary.party.many.toLowerCase()} · ${money(open.value)} all time`
              : 'Worked out from behaviour, not from labels'}
          </AppText>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        {open ? (
          <>
            <View style={styles.gutter}>
              <AppText variant="footnote" color="textDim" style={styles.description}>
                {open.description}
              </AppText>
            </View>

            <View style={styles.list}>
              {open.partyIds.map((id, i) => {
                const party = index.partyById.get(id);
                if (!party) return null;
                const value = partyValue(index, id, now);
                const seen = index.lastSeen.get(id) ?? null;

                return (
                  <Animated.View key={id} entering={enter(i)}>
                    <Deep
                      target={{ kind: 'party', partyId: id }}
                      onPress={() => router.push(`/person/${id}` as never)}
                      haptic="light"
                      scaleTo={0.985}
                      style={[styles.row, { backgroundColor: colors.surface }]}>
                      <View style={styles.rowBody}>
                        <AppText variant="callout" numberOfLines={1}>
                          {party.name}
                        </AppText>
                        <AppText variant="caption" color="textFaint" numberOfLines={1}>
                          {relativeDays(seen, now, 'Never been in')} ·{' '}
                          {money(value.lifetime)} all time
                          {value.outstanding > 0 ? ` · ${money(value.outstanding)} owed` : ''}
                        </AppText>
                      </View>
                      <ChevronRight size={16} color={colors.textFaint} strokeWidth={2.2} />
                    </Deep>
                  </Animated.View>
                );
              })}
            </View>

            <View style={[styles.gutter, styles.block]}>
              <Press
                haptic="medium"
                scaleTo={0.97}
                onPress={() => router.push('/worklist?kind=contact' as never)}
                style={[styles.cta, { backgroundColor: colors.accent }]}>
                <MessageCircle size={16} color={colors.accentText} strokeWidth={2.2} />
                <AppText variant="callout" tint={colors.accentText}>
                  Work through this group
                </AppText>
              </Press>
            </View>
          </>
        ) : (
          <View style={styles.list}>
            {groups.map((group, i) => (
              <Animated.View key={group.id} entering={enter(i)}>
                <Press
                  haptic="light"
                  scaleTo={0.985}
                  onPress={() => setOpenId(group.id)}
                  style={[styles.group, { backgroundColor: colors.surface }]}>
                  <View style={styles.groupHead}>
                    <AppText variant="callout" style={styles.groupTitle}>
                      {group.label}
                    </AppText>
                    <View style={[styles.count, { backgroundColor: colors.surfaceHigh }]}>
                      <AppText variant="footnote" tabular>
                        {group.partyIds.length}
                      </AppText>
                    </View>
                  </View>
                  <AppText variant="caption" color="textDim" style={styles.groupBody}>
                    {group.description}
                  </AppText>
                  {group.value > 0 ? (
                    <AppText variant="caption" color="textFaint" style={styles.groupValue}>
                      {money(group.value)} between them
                    </AppText>
                  ) : null}
                </Press>
              </Animated.View>
            ))}
          </View>
        )}
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
  barBody: { flex: 1, gap: 1 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { paddingTop: space.sm },
  gutter: { paddingHorizontal: space.gutter },
  block: { marginTop: space.lg },
  description: { lineHeight: 19, marginBottom: space.md },

  list: { paddingHorizontal: space.gutter, gap: space.sm, marginTop: space.sm },
  group: { padding: space.base, borderRadius: radius.lg, gap: space.xs },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  groupTitle: { flex: 1 },
  count: { minWidth: 32, height: 26, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  groupBody: { lineHeight: 17 },
  groupValue: { marginTop: 2 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  rowBody: { flex: 1, gap: 2 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 50,
    borderRadius: radius.pill,
  },
});
