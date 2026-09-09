import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  MessageCircle,
  Phone,
  X,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Deep } from '@/components/Deep';
import { EmptyState } from '@/components/EmptyState';
import { Press } from '@/components/Press';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { churnRead, partyValue, reliability } from '@/domain/analytics';
import { generateInsights } from '@/domain/insights';
import { money } from '@/domain/metrics';
import type { ActionRecord } from '@/domain/model';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { message, openCall } from '@/lib/contact';
import { relativeDays, useTick } from '@/lib/time';
import { useBusiness, useIndex } from '@/state/business';
import { tapCompleted } from '@/lib/haptics';
import { useBarInset } from '@/state/dock';
import { useDockPrimary } from '@/state/dockAction';
import { useUndo } from '@/state/undo';

/**
 * The action layer.
 *
 * "Check in with 8" used to be a button that did nothing, and that gap was the
 * difference between an app that notices things and an operating system. This
 * screen turns a finding into eight named people, a drafted message per person,
 * a way to actually send it, and a record of what happened — which is what the
 * outcome reports on the insights screen later read from.
 *
 * Nothing here sends anything by itself. Every send is a hand-off to the phone's
 * own dialler or messaging app, which means no server, no customer data leaving
 * the device, and — most importantly — the owner sees the message before their
 * customer does.
 */

const DAY = 24 * 60 * 60 * 1000;

const SKIP_REASONS = [
  { id: 'handled', label: 'Already handled it' },
  { id: 'wrong', label: 'This is not right' },
  { id: 'not-worth', label: 'Not worth chasing' },
  { id: 'later', label: 'Not now' },
];

export default function WorklistScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const params = useLocalSearchParams<{ insight?: string; kind?: string }>();

  const { profile, data, raiseAction, completeAction, skipAction, snoozeAction, logContact, settleMoney } =
    useBusiness();
  const { offerUndo } = useUndo();
  const index = useIndex();
  const now = useTick(60_000);

  const [done, setDone] = useState<Set<string>>(new Set());
  const [skipSheet, setSkipSheet] = useState(false);
  const [messageFor, setMessageFor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const insight = useMemo(() => {
    if (!profile) return null;
    const all = generateInsights(profile, data, { now, limit: 20, index });
    return all.find((i) => i.id === params.insight) ?? null;
  }, [profile, data, params.insight, now, index]);

  const kind = (params.kind as ActionRecord['kind']) ?? 'contact';

  const targets = useMemo(() => {
    if (!profile) return [];
    const ids = insight?.action?.partyIds ?? [];
    return ids
      .map((id) => index.partyById.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((party) => {
        const value = partyValue(index, party.id, now);
        const read = churnRead(data, index, party.id, now);
        const rel = reliability(index, party.id);
        const owed = data.money.filter(
          (m) => m.partyId === party.id && m.direction === 'in' && m.status === 'due',
        );
        return { party, value, read, rel, owed, seen: index.lastSeen.get(party.id) ?? null };
      });
  }, [insight, index, data, profile, now]);

  if (!profile) return null;

  const remaining = targets.filter((t) => !done.has(t.party.id));
  const isCollect = kind === 'collect';

  /* --------------------------------------------------------------- drafts */

  const draftFor = (partyId: string): string => {
    const target = targets.find((t) => t.party.id === partyId);
    if (!target) return '';
    const first = target.party.name.split(' ')[0];

    if (isCollect) {
      const total = target.owed.reduce((s, m) => s + m.amount, 0);
      return `Hi ${first}, hope you are well. Just a note that ${money(total)} is still outstanding on your account. If there is any trouble with it, tell me and we will work something out.`;
    }

    const away = target.seen ? Math.max(0, Math.floor((now - target.seen) / DAY)) : null;
    // Below a fortnight the sentence stops making sense, and a message that
    // names a wrong number of days is worse than one that names none. This text
    // goes to a real customer — it is the one place in the app where being
    // slightly off is not a cosmetic problem.
    return away === null
      ? `Hi ${first}, we have not managed to get you in yet since you joined — is there a time that would suit better? Happy to work around you.`
      : away < 14
        ? `Hi ${first}, just checking everything is alright — we have not seen you for a bit. No pressure at all, only let me know if you want to pick things back up.`
        : `Hi ${first}, we have not seen you in about ${away} days and wanted to check everything is alright. No pressure at all — just let me know if you want to pick things back up.`;
  };

  const openMessage = (partyId: string) => {
    setMessageFor(partyId);
    setDraft(draftFor(partyId));
  };

  /* -------------------------------------------------------------- actions */

  const markDone = (partyId: string) => {
    setDone((prev) => new Set(prev).add(partyId));
  };

  const send = async (partyId: string) => {
    const target = targets.find((t) => t.party.id === partyId);
    if (!target?.party.phone) {
      // Names the fix and offers to go there. "No phone number" states a fact and
      // leaves the person to work out what to do with it.
      Alert.alert(
        `No number for ${target?.party.name ?? 'them'}`,
        'Add one to their record and messaging becomes a single tap from here.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Add a number',
            onPress: () => router.push(`/person/${partyId}` as never),
          },
        ],
      );
      return;
    }
    const via = await message(target.party.phone, draft);
    if (via) {
      markDone(partyId);
      setMessageFor(null);
      return;
    }

    Alert.alert(
      'Nothing here can send it',
      'Neither WhatsApp nor a messaging app opened. The message is still on screen — hold to select it and paste it wherever you normally reach people.',
    );
  };

  const call = async (partyId: string) => {
    const target = targets.find((t) => t.party.id === partyId);
    if (!target?.party.phone) {
      Alert.alert(
        `No number for ${target?.party.name ?? 'them'}`,
        'Add one to their record and calling becomes a single tap from here.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Add a number', onPress: () => router.push(`/person/${partyId}` as never) },
        ],
      );
      return;
    }
    if (await openCall(target.party.phone)) {
      markDone(partyId);
      return;
    }
    Alert.alert(
      'This device cannot make calls',
      `The number is ${target.party.phone} — dial it from another phone, then tap Done here so the check-in gets recorded.`,
    );
  };

  const finish = () => {
    if (!insight) return router.back();

    const action = raiseAction({
      kind,
      label: insight.action?.label ?? insight.title,
      partyIds: [...done],
      insightId: insight.id,
    });
    completeAction(action.id);
    logContact([...done], insight.action?.label ?? 'Checked in', action.id);

    tapCompleted();
    offerUndo(`${done.size} marked done`, () => skipAction(action.id, 'undone'));
    router.back();
  };

  const skipAll = (reason: string) => {
    if (!insight) return;
    const action = raiseAction({
      kind,
      label: insight.action?.label ?? insight.title,
      partyIds: insight.action?.partyIds ?? [],
      insightId: insight.id,
    });
    skipAction(action.id, reason);
    setSkipSheet(false);
    offerUndo('Skipped', () => completeAction(action.id));
    router.back();
  };

  /* ----------------------------------------------------------------- view */

  /*
    The finish button lives in the floating bar, not in a footer of this
    screen's own. Pinned here it sat underneath the bar — the one control this
    screen exists to offer was the one thing covered up. See `dockAction.tsx`.
  */
  useDockPrimary(
    targets.length > 0
      ? {
          label: done.size === 0 ? `${remaining.length} still to do` : `Finish · ${done.size} done`,
          onPress: finish,
          disabled: done.size === 0,
        }
      : null,
  );

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
            {insight?.action?.label ?? 'Worklist'}
          </AppText>
          <AppText variant="caption" color="textFaint">
            {done.size} of {targets.length} done
          </AppText>
        </View>
        <Press
          haptic="light"
          scaleTo={0.9}
          onPress={() => setSkipSheet(true)}
          accessibilityLabel="Skip this"
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <X size={19} color={colors.textDim} strokeWidth={2.2} />
        </Press>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        {insight ? (
          <Animated.View entering={enter(0)} style={styles.gutter}>
            <Card tone="surface">
              <AppText variant="footnote" color="textDim" style={styles.why}>
                {insight.detail}
              </AppText>
            </Card>
          </Animated.View>
        ) : null}

        {targets.length === 0 ? (
          <EmptyState
            art="sessions"
            title="Nothing to work through"
            body="This list is built from a finding on your home screen. It may already have been dealt with."
          />
        ) : (
          <View style={styles.list}>
            {targets.map((target, i) => {
              const isDone = done.has(target.party.id);
              const owedTotal = target.owed.reduce((s, m) => s + m.amount, 0);

              return (
                <Animated.View key={target.party.id} entering={enter(i)}>
                  <Deep
                    target={{ kind: 'party', partyId: target.party.id }}
                    haptic="light"
                    scaleTo={0.985}
                    style={[
                      styles.person,
                      { backgroundColor: colors.surface, opacity: isDone ? 0.5 : 1 },
                    ]}>
                    <View style={styles.personHead}>
                      <View style={styles.personBody}>
                        <AppText variant="callout" numberOfLines={1}>
                          {target.party.name}
                        </AppText>
                        <AppText variant="caption" color="textDim" numberOfLines={1}>
                          {isCollect
                            ? `${money(owedTotal)} owed${
                                target.rel.averageDelayDays
                                  ? ` · usually ${Math.round(target.rel.averageDelayDays)} days late`
                                  : ''
                              }`
                            : `${relativeDays(target.seen, now, 'Never been in')} · ${money(target.value.lifetime)} all time`}
                        </AppText>
                      </View>

                      {isDone ? (
                        <View style={[styles.tick, { backgroundColor: colors.successSoft }]}>
                          <Check size={16} color={colors.success} strokeWidth={2.6} />
                        </View>
                      ) : null}
                    </View>

                    {/* The reason this person is on the list, not a generic label. */}
                    {target.read.reasons.length > 0 && !isCollect ? (
                      <AppText variant="caption" color="textFaint" style={styles.reason}>
                        {target.read.reasons[0]}
                      </AppText>
                    ) : null}

                    {!isDone ? (
                      <View style={styles.actions}>
                        <Press
                          haptic="medium"
                          scaleTo={0.94}
                          onPress={() => call(target.party.id)}
                          accessibilityLabel={`Call ${target.party.name}`}
                          style={[styles.action, { backgroundColor: colors.surfaceHigh }]}>
                          <Phone size={15} color={colors.text} strokeWidth={2} />
                          <AppText variant="footnote">Call</AppText>
                        </Press>

                        <Press
                          haptic="medium"
                          scaleTo={0.94}
                          onPress={() => openMessage(target.party.id)}
                          accessibilityLabel={`Message ${target.party.name}`}
                          style={[styles.action, { backgroundColor: colors.accentSoft }]}>
                          <MessageCircle size={15} color={colors.accent} strokeWidth={2} />
                          <AppText variant="footnote" tint={colors.accent}>
                            Message
                          </AppText>
                        </Press>

                        {isCollect && target.owed.length > 0 ? (
                          <Press
                            haptic="medium"
                            scaleTo={0.94}
                            onPress={() => {
                              target.owed.forEach((m) => settleMoney(m.id));
                              markDone(target.party.id);
                            }}
                            accessibilityLabel={`Mark ${target.party.name} as paid`}
                            style={[styles.action, { backgroundColor: colors.successSoft }]}>
                            <Check size={15} color={colors.success} strokeWidth={2.4} />
                            <AppText variant="footnote" tint={colors.success}>
                              Paid
                            </AppText>
                          </Press>
                        ) : (
                          <Press
                            haptic="light"
                            scaleTo={0.94}
                            onPress={() => markDone(target.party.id)}
                            accessibilityLabel={`Mark ${target.party.name} done`}
                            style={[styles.action, { backgroundColor: colors.surfaceHigh }]}>
                            <Check size={15} color={colors.textDim} strokeWidth={2.4} />
                            <AppText variant="footnote" color="textDim">
                              Done
                            </AppText>
                          </Press>
                        )}
                      </View>
                    ) : null}
                  </Deep>
                </Animated.View>
              );
            })}
          </View>
        )}
        {targets.length > 0 ? (
          <AppText variant="caption" color="textFaint" style={styles.footNote}>
            In a couple of weeks this will tell you how many of them came back.
          </AppText>
        ) : null}
      </ScrollView>

      {/* ---------------------------------------------------------- message */}
      <Sheet
        visible={messageFor !== null}
        onClose={() => setMessageFor(null)}
        title="Send this?"
        eyebrow={messageFor ? (index.partyById.get(messageFor)?.name ?? '') : ''}
        footer={
          <>
            <Press
              haptic="medium"
              scaleTo={0.97}
              onPress={() => (messageFor ? send(messageFor) : undefined)}
              style={[styles.cta, { backgroundColor: colors.accent }]}>
              <AppText variant="callout" tint={colors.accentText}>
                Open in WhatsApp
              </AppText>
            </Press>
            <AppText variant="caption" color="textFaint" style={styles.footNote}>
              Nothing is sent from here. WhatsApp opens with this text ready — or your SMS app if
              WhatsApp is not installed — so you see it before your customer does.
            </AppText>
          </>
        }>
        <TextField
          value={draft}
          onChangeText={setDraft}
          multiline
          placeholder="Write something"
        />
      </Sheet>

      {/* ------------------------------------------------------------- skip */}
      <Sheet visible={skipSheet} onClose={() => setSkipSheet(false)} title="Why are you skipping?">
        <AppText variant="footnote" color="textDim" style={styles.why}>
          The reason matters. It is what stops this being raised again for the wrong reason, and what
          tells the app when one of its own rules is wrong about your business.
        </AppText>
        <View style={styles.reasons}>
          {SKIP_REASONS.map((reason) => (
            <Press
              key={reason.id}
              haptic="light"
              scaleTo={0.97}
              onPress={() => {
                if (reason.id === 'later' && insight) {
                  const action = raiseAction({
                    kind,
                    label: insight.action?.label ?? insight.title,
                    partyIds: insight.action?.partyIds ?? [],
                    insightId: insight.id,
                  });
                  snoozeAction(action.id, 7);
                  setSkipSheet(false);
                  router.back();
                  return;
                }
                skipAll(reason.label);
              }}
              style={[styles.reasonRow, { backgroundColor: colors.surface }]}>
              {reason.id === 'later' ? (
                <Clock size={16} color={colors.textDim} strokeWidth={2} />
              ) : null}
              <AppText variant="callout" style={styles.reasonLabel}>
                {reason.label}
              </AppText>
              <ChevronRight size={16} color={colors.textFaint} strokeWidth={2.2} />
            </Press>
          ))}
        </View>
      </Sheet>
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
  why: { lineHeight: 19 },

  list: { paddingHorizontal: space.gutter, gap: space.sm, marginTop: space.base },
  person: { borderRadius: radius.lg, padding: space.base, gap: space.sm },
  personHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  personBody: { flex: 1, gap: 2 },
  tick: { width: 30, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  reason: { lineHeight: 16 },

  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },

  footer: { paddingHorizontal: space.gutter, paddingTop: space.md, gap: space.sm },
  cta: { height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  footNote: { textAlign: 'center', lineHeight: 16 },

  reasons: { gap: space.sm, marginTop: space.base },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  reasonLabel: { flex: 1 },
});
