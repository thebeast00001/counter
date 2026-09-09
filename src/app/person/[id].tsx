import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Banknote,
  Calendar,
  Check,
  IndianRupee,
  MessageCircle,
  Phone,
  RefreshCw,
  Trash2,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Ring, Sparkline } from '@/components/Charts';
import { Deep } from '@/components/Deep';
import { Press } from '@/components/Press';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { explainParty } from '@/domain/explain';
import { money } from '@/domain/metrics';
import { buildUpiIntent, makeRef } from '@/domain/upi';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { message, openCall } from '@/lib/contact';
import { formatDateMedium, formatDayMonth, useTick } from '@/lib/time';
import { useBarInset } from '@/state/dock';
import { useBusiness, useIndex } from '@/state/business';
import { tapSettled } from '@/lib/haptics';
import { useUndo } from '@/state/undo';

/**
 * One person, whole.
 *
 * Ordered by what an owner standing in front of them needs: are they alright,
 * do they owe anything, when were they last in, what have they been worth. The
 * timeline is last because it is reference material, not a headline — but it is
 * complete, because the moment an owner catches the app being wrong about a
 * single visit, they stop believing the aggregates too.
 */
export default function PersonScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { offerUndo } = useUndo();
  const { id } = useLocalSearchParams<{ id: string }>();

  const {
    profile,
    data,
    updateParty,
    archiveParty,
    renewCommitment,
    settleMoney,
    unsettleMoney,
    addEngagement,
    removeEngagement,
    addMoney,
    removeMoney,
    snapshot,
    replaceAll,
  } = useBusiness();
  const index = useIndex();
  const now = useTick(60_000);

  const [noteSheet, setNoteSheet] = useState(false);
  const [note, setNote] = useState('');

  const read = useMemo(
    () => (profile && id ? explainParty(profile, data, id, now, index) : null),
    [profile, data, id, now, index],
  );

  const party = id ? index.partyById.get(id) : null;

  if (!profile || !party || !read) {
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
        </View>
        <View style={styles.gutter}>
          <AppText variant="body" color="textDim">
            That record is no longer here.
          </AppText>
        </View>
      </View>
    );
  }

  const owed = data.money.filter(
    (m) => m.partyId === party.id && m.direction === 'in' && m.status === 'due',
  );
  const owedTotal = owed.reduce((s, m) => s + m.amount, 0);
  const commitment = data.commitments
    .filter((c) => c.partyId === party.id && c.status !== 'cancelled')
    .sort((a, b) => b.endAt - a.endAt)[0];

  const riskTone =
    read.churn.risk > 0.6 ? colors.warn : read.churn.risk > 0.35 ? colors.warn : colors.success;

  const contact = async (how: 'call' | 'message') => {
    if (!party.phone) {
      Alert.alert(
        `No number for ${party.name}`,
        'Add one and both calling and messaging become a single tap from this screen.',
      );
      return;
    }

    const ok =
      how === 'call'
        ? await openCall(party.phone)
        : Boolean(await message(party.phone, `Hi ${party.name.split(' ')[0]}, `));

    if (!ok) {
      Alert.alert(
        how === 'call' ? 'This device cannot make calls' : 'Nothing here can send a message',
        `${party.name}'s number is ${party.phone}. Use it from another phone if you need to.`,
      );
    }
  };

  /**
   * Asks this person for money through their own UPI app.
   *
   * The whole point is what happens afterwards: because the app built the
   * request, it already knows who it was for, what it was for and how much, so
   * the record is written here rather than typed later. The reference travels
   * with the payment, which means the bank message that eventually arrives is
   * recognisable — importing a statement later will not double it up.
   *
   * Nothing is recorded until the owner says it went through, and that is not
   * timidity. Handing a request to another app returns no reliable answer about
   * whether the customer completed it — Expo Go cannot read an activity result —
   * so writing the payment on the assumption that they did would invent a fact,
   * and an invented payment is worse than a missing one: it inflates the day's
   * takings and there is nothing on any screen to indicate which figure is wrong.
   * One tap on the way back is the whole cost of the record being true.
   */
  const collect = async () => {
    if (!profile.vpa) return;

    const amount = owedTotal > 0 ? owedTotal : (commitment?.price ?? 0);
    if (amount <= 0) {
      Alert.alert(
        'Nothing to collect',
        `${party.name} does not owe anything right now. Record a charge first and it will show up here.`,
      );
      return;
    }

    const ref = makeRef(Date.now());
    const note = `${profile.name} · ${party.name.split(' ')[0]}`;
    const url = buildUpiIntent({
      vpa: profile.vpa,
      payeeName: profile.name,
      amount,
      note,
      ref,
    });

    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        'No UPI app found',
        'Install any UPI app — GPay, PhonePe, Paytm — and this opens straight into it with the amount filled in.',
      );
      return;
    }

    Alert.alert(
      `Asked for ${money(amount)}`,
      `${party.name}'s UPI app has the request. Did it go through?`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Yes, paid',
          onPress: () => {
            const entry = addMoney({
              partyId: party.id,
              amount,
              direction: 'in',
              at: Date.now(),
              status: 'settled',
              settledAt: Date.now(),
              label: note,
              method: 'upi',
              ref,
              source: 'upi',
            });
            offerUndo(`${money(amount)} recorded`, () => removeMoney([entry.id]));
          },
        },
      ],
    );
  };

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
        <View style={styles.barBody}>
          <AppText variant="title3" numberOfLines={1}>
            {party.name}
          </AppText>
          <AppText variant="caption" color="textFaint" numberOfLines={1}>
            {profile.vocabulary.party.one} since {formatDayMonth(party.joinedAt)}
          </AppText>
        </View>
        <Press
          haptic="light"
          scaleTo={0.9}
          onPress={() => {
            archiveParty(party.id);
            offerUndo(`${party.name} archived`, () => updateParty(party.id, { archivedAt: null }));
            router.back();
          }}
          accessibilityLabel={`Archive ${party.name}`}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <Trash2 size={17} color={colors.textDim} strokeWidth={2} />
        </Press>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        {/* ------------------------------------------------------- headline */}
        <Animated.View entering={enter(0)} style={styles.gutter}>
          <Card tone="surface">
            <View style={styles.headline}>
              <Ring progress={1 - read.churn.risk} size={68} stroke={7} tint={riskTone}>
                <AppText variant="footnote" tabular tint={riskTone}>
                  {Math.round((1 - read.churn.risk) * 100)}
                </AppText>
              </Ring>
              <View style={styles.headlineBody}>
                <AppText variant="title3">{read.lastSeenLabel}</AppText>
                <AppText variant="caption" color="textDim">
                  {read.typicalGapLabel}
                </AppText>
                {/*
                  A predicted departure date that has already passed is not a
                  prediction any more, and printing "likely gone by 14 June" in
                  August reads as the app having lost track of the calendar. Past
                  the date, the honest thing to say is that the window has closed.
                */}
                {read.churn.expectedLossAt && read.churn.risk > 0.35 ? (
                  <AppText variant="caption" tint={colors.warn} style={styles.expected}>
                    {read.churn.expectedLossAt > now
                      ? `On this pattern, likely gone by ${formatDayMonth(read.churn.expectedLossAt)}`
                      : `Past the point where people usually come back — since ${formatDayMonth(read.churn.expectedLossAt)}`}
                  </AppText>
                ) : null}
              </View>
            </View>

            {read.churn.reasons.length > 0 ? (
              <View style={[styles.reasons, { borderTopColor: colors.hairline }]}>
                {read.churn.reasons.map((reason) => (
                  <AppText key={reason} variant="caption" color="textDim" style={styles.reason}>
                    {reason}
                  </AppText>
                ))}
              </View>
            ) : null}
          </Card>
        </Animated.View>

        {/* -------------------------------------------------------- actions */}
        <Animated.View entering={enter(1)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}>
            <QuickAction
              icon={<Phone size={16} color={colors.text} strokeWidth={2} />}
              label="Call"
              onPress={() => contact('call')}
            />
            <QuickAction
              icon={<MessageCircle size={16} color={colors.text} strokeWidth={2} />}
              label="WhatsApp"
              onPress={() => contact('message')}
            />
            {/* Only when there is a UPI id to be paid into. An action that opens
                an error is worse than an action that is not there. */}
            {profile.vpa ? (
              <QuickAction
                icon={<IndianRupee size={16} color={colors.text} strokeWidth={2} />}
                label="Collect"
                onPress={collect}
              />
            ) : null}
            <QuickAction
              icon={<Calendar size={16} color={colors.text} strokeWidth={2} />}
              label={`Record ${profile.vocabulary.engagement.one.toLowerCase()}`}
              onPress={() => {
                const made = addEngagement({ partyId: party.id, at: Date.now(), source: 'manual' });
                offerUndo(`${profile.vocabulary.engagement.one} recorded`, () =>
                  removeEngagement(made.id),
                );
              }}
            />
            {commitment ? (
              <QuickAction
                icon={<RefreshCw size={16} color={colors.text} strokeWidth={2} />}
                label="Renew"
                onPress={() => {
                  // A renewal writes a commitment, expires the old one, and raises
                  // a charge. Three linked changes, so undo restores all three.
                  const before = snapshot();
                  renewCommitment(commitment.id);
                  offerUndo('Renewed', () => replaceAll(before));
                }}
              />
            ) : null}
            <QuickAction
              icon={<Banknote size={16} color={colors.text} strokeWidth={2} />}
              label="Take payment"
              onPress={() => router.push('/capture?mode=payment' as never)}
            />
          </ScrollView>
        </Animated.View>

        {/* ----------------------------------------------------------- owed */}
        {owed.length > 0 ? (
          <Animated.View entering={enter(2)} style={[styles.gutter, styles.block]}>
            <AppText variant="caption" color="textFaint" style={styles.label}>
              OWES {money(owedTotal).toUpperCase()}
            </AppText>
            <View style={styles.rows}>
              {owed.map((entry) => (
                <Deep
                  key={entry.id}
                  target={{ kind: 'money', moneyId: entry.id }}
                  haptic="light"
                  scaleTo={0.98}
                  style={[styles.owedRow, { backgroundColor: colors.surface }]}>
                  <View style={styles.owedBody}>
                    <AppText variant="callout">{entry.label}</AppText>
                    <AppText variant="caption" color="textFaint">
                      Due {formatDayMonth(entry.dueAt ?? entry.at)}
                    </AppText>
                  </View>
                  <AppText variant="callout" tabular tint={colors.warn}>
                    {money(entry.amount)}
                  </AppText>
                  <Press
                    haptic="medium"
                    scaleTo={0.9}
                    onPress={() => {
                      settleMoney(entry.id);
                      tapSettled();
                      offerUndo(`${money(entry.amount)} marked paid`, () => unsettleMoney(entry.id));
                    }}
                    accessibilityLabel={`Mark ${money(entry.amount)} as paid`}
                    style={[styles.tick, { backgroundColor: colors.successSoft }]}>
                    <Check size={15} color={colors.success} strokeWidth={2.6} />
                  </Press>
                </Deep>
              ))}
            </View>
          </Animated.View>
        ) : null}

        {/* --------------------------------------------------------- money */}
        <Animated.View entering={enter(3)} style={[styles.gutter, styles.block]}>
          <AppText variant="caption" color="textFaint" style={styles.label}>
            WORTH
          </AppText>
          <Card tone="surface" style={styles.stats}>
            <Stat label="Paid all time" value={read.lifetime} />
            <Stat label="Running at" value={read.runRate} />
            <Stat label={`${profile.vocabulary.engagement.many}`} value={String(read.visits)} />
            <Stat label="Payment habit" value={read.reliabilityLabel} wide />
          </Card>
        </Animated.View>

        {/* -------------------------------------------------------- rhythm */}
        {read.series.filter((v) => v > 0).length > 1 ? (
          <Animated.View entering={enter(4)} style={[styles.gutter, styles.block]}>
            <AppText variant="caption" color="textFaint" style={styles.label}>
              LAST 90 DAYS
            </AppText>
            <Card tone="surface">
              <Sparkline values={read.series} height={52} fill={false} />
            </Card>
          </Animated.View>
        ) : null}

        {/* ---------------------------------------------------------- note */}
        <Animated.View entering={enter(5)} style={[styles.gutter, styles.block]}>
          <AppText variant="caption" color="textFaint" style={styles.label}>
            WHAT TO REMEMBER
          </AppText>
          <Press
            haptic="light"
            scaleTo={0.98}
            onPress={() => {
              setNote(party.notes ?? '');
              setNoteSheet(true);
            }}
            style={[styles.noteCard, { backgroundColor: colors.surface }]}>
            <AppText variant="footnote" color={party.notes ? 'text' : 'textFaint'}>
              {party.notes ||
                'Nothing yet. The small things — a preferred time, who to call, what they are working towards — are what turn records into a relationship.'}
            </AppText>
          </Press>
        </Animated.View>

        {/* ------------------------------------------------------ timeline */}
        <Animated.View entering={enter(6)} style={[styles.gutter, styles.block]}>
          <AppText variant="caption" color="textFaint" style={styles.label}>
            EVERYTHING
          </AppText>
          <View style={styles.timeline}>
            {read.timeline.map((item) => (
              <View key={item.id} style={styles.event}>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        item.kind === 'due'
                          ? colors.warn
                          : item.kind === 'payment'
                            ? colors.success
                            : item.kind === 'joined'
                              ? colors.accent
                              : colors.hairlineStrong,
                    },
                  ]}
                />
                <View style={styles.eventBody}>
                  <AppText variant="footnote">{item.label}</AppText>
                  <AppText variant="caption" color="textFaint">
                    {formatDateMedium(item.at)}
                  </AppText>
                </View>
                {item.value ? (
                  <AppText
                    variant="footnote"
                    tabular
                    tint={item.kind === 'due' ? colors.warn : undefined}>
                    {item.value}
                  </AppText>
                ) : null}
              </View>
            ))}
          </View>
        </Animated.View>
      </ScrollView>

      <Sheet
        visible={noteSheet}
        onClose={() => setNoteSheet(false)}
        title="What to remember"
        footer={
          <Press
            haptic="medium"
            scaleTo={0.97}
            onPress={() => {
              updateParty(party.id, { notes: note.trim() || undefined });
              setNoteSheet(false);
            }}
            style={[styles.cta, { backgroundColor: colors.accent }]}>
            <AppText variant="callout" tint={colors.accentText}>
              Save
            </AppText>
          </Press>
        }>
        <TextField
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="Prefers evening · mother calls about fees · working towards a competition"
        />
      </Sheet>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Press
      haptic="medium"
      scaleTo={0.94}
      onPress={onPress}
      accessibilityLabel={label}
      style={[styles.quick, { backgroundColor: colors.surface }]}>
      {icon}
      <AppText variant="footnote" numberOfLines={1}>
        {label}
      </AppText>
    </Press>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <View style={[styles.stat, wide && styles.statWide]}>
      <AppText variant="callout" tabular numberOfLines={1}>
        {value}
      </AppText>
      <AppText variant="caption" color="textFaint" numberOfLines={1}>
        {label}
      </AppText>
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
  block: { marginTop: space.xl },
  label: { letterSpacing: 0.9, marginBottom: space.sm },

  headline: { flexDirection: 'row', alignItems: 'center', gap: space.base },
  headlineBody: { flex: 1, gap: 2 },
  expected: { marginTop: 3 },
  reasons: {
    marginTop: space.base,
    paddingTop: space.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  reason: { lineHeight: 16 },

  strip: { paddingHorizontal: space.gutter, gap: space.sm, marginTop: space.base },
  quick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 42,
    paddingHorizontal: space.base,
    borderRadius: radius.pill,
  },

  rows: { gap: space.sm },
  owedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  owedBody: { flex: 1, gap: 2 },
  tick: { width: 30, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },

  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.base },
  stat: { width: '45%', flexGrow: 1, gap: 2 },
  statWide: { width: '100%' },

  noteCard: { padding: space.base, borderRadius: radius.md },

  timeline: { gap: space.md },
  event: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  eventBody: { flex: 1, gap: 1 },

  cta: { height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
