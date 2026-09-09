import { useRouter } from 'expo-router';
import { ArrowLeft, Check, Pencil, Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { calibration, detectDrift } from '@/domain/intel';
import { captureRead, currentConfidence, reconcile } from '@/domain/memory';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatDateFull, formatDayMonth, useTick } from '@/lib/time';
import { useBarInset } from '@/state/dock';
import { useBusiness } from '@/state/business';
import { useUndo } from '@/state/undo';

/**
 * What the app knows, where it got it, and how sure it is.
 *
 * This screen is the moat, made inspectable. Anyone can ship an insight engine
 * in a fortnight; what they cannot ship is a year of this business's corrections
 * and the gap between what its owner believes and what the records show. Making
 * it visible and editable is also the honest thing to do — a system that
 * accumulates beliefs about someone's livelihood should let them read them.
 */
export default function MemoryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { profile, data, correctFact, addEvent, removeEvent } = useBusiness();
  const { offerUndo } = useUndo();
  const now = useTick(300_000);

  const [editing, setEditing] = useState<{ key: string; label: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [eventSheet, setEventSheet] = useState(false);
  const [eventLabel, setEventLabel] = useState('');

  const pairs = useMemo(() => reconcile(data, now), [data, now]);
  const drift = useMemo(
    () => (profile ? detectDrift(profile, data, now) : []),
    [profile, data, now],
  );
  const calib = useMemo(() => calibration(data, now), [data, now]);
  const capture = useMemo(() => captureRead(data, now), [data, now]);

  const events = useMemo(
    () => [...data.events].sort((a, b) => b.at - a.at).slice(0, 20),
    [data.events],
  );

  if (!profile) return null;

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
          <AppText variant="title3">What it knows</AppText>
          <AppText variant="caption" color="textFaint">
            Everything here is yours and can be corrected
          </AppText>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        {/* -------------------------------------------------- what you said */}
        <Animated.View entering={enter(0)} style={styles.gutter}>
          <AppText variant="caption" color="textFaint" style={styles.label}>
            WHAT YOU SAID, WHAT THE RECORDS SAY
          </AppText>

          <View style={styles.rows}>
            {pairs.map((pair) => {
              const authority = pair.corrected ?? pair.declared;
              return (
                <Press
                  key={pair.key}
                  haptic="light"
                  scaleTo={0.985}
                  onPress={() => {
                    setEditing({ key: pair.key, label: pair.label });
                    setDraft(authority?.value ?? pair.observed?.value ?? '');
                  }}
                  style={[styles.factCard, { backgroundColor: colors.surface }]}>
                  <View style={styles.factHead}>
                    <AppText variant="callout" style={styles.factLabel}>
                      {pair.label}
                    </AppText>
                    <Pencil size={14} color={colors.textFaint} strokeWidth={2} />
                  </View>

                  <View style={styles.factCols}>
                    <View style={styles.factCol}>
                      <AppText variant="footnote" color={pair.corrected ? 'textFaint' : 'text'}>
                        {pair.declared?.value ?? '—'}
                      </AppText>
                      <AppText variant="caption" color="textFaint">
                        you said
                      </AppText>
                    </View>
                    <View style={styles.factCol}>
                      <AppText variant="footnote">{pair.observed?.value ?? '—'}</AppText>
                      <AppText variant="caption" color="textFaint">
                        records
                      </AppText>
                    </View>
                    {pair.corrected ? (
                      <View style={styles.factCol}>
                        <AppText variant="footnote" tint={colors.accent}>
                          {pair.corrected.value}
                        </AppText>
                        <AppText variant="caption" color="textFaint">
                          corrected
                        </AppText>
                      </View>
                    ) : null}
                  </View>

                  {pair.reconcile ? (
                    <AppText variant="caption" tint={colors.warn} style={styles.factNote}>
                      {pair.reconcile}
                    </AppText>
                  ) : null}

                  {pair.declared && !pair.corrected ? (
                    <AppText variant="caption" color="textFaint" style={styles.confidence}>
                      Told to it {formatDayMonth(pair.declared.at)} · confidence now{' '}
                      {Math.round(currentConfidence(pair.declared, now) * 100)}%
                    </AppText>
                  ) : null}
                </Press>
              );
            })}
          </View>
        </Animated.View>

        {/* ------------------------------------------------------------ drift */}
        {drift.length > 0 ? (
          <Animated.View entering={enter(1)} style={[styles.gutter, styles.block]}>
            <AppText variant="caption" color="textFaint" style={styles.label}>
              YOUR BUSINESS HAS CHANGED
            </AppText>
            <View style={styles.rows}>
              {drift.map((finding) => (
                <View
                  key={finding.key}
                  style={[styles.factCard, { backgroundColor: colors.surface }]}>
                  <AppText variant="callout">{finding.label}</AppText>
                  <AppText variant="footnote" color="textDim" style={styles.factNote}>
                    Set up as {finding.was}. The records now say {finding.now}.
                  </AppText>
                  <AppText variant="caption" color="textFaint" style={styles.factNote}>
                    {finding.proposal}
                  </AppText>
                </View>
              ))}
            </View>
          </Animated.View>
        ) : null}

        {/* ----------------------------------------------------------- events */}
        <Animated.View entering={enter(2)} style={[styles.gutter, styles.block]}>
          <View style={styles.sectionHead}>
            <AppText variant="caption" color="textFaint" style={styles.label}>
              THINGS THAT HAPPENED
            </AppText>
            <Press
              haptic="medium"
              scaleTo={0.9}
              onPress={() => {
                setEventLabel('');
                setEventSheet(true);
              }}
              accessibilityLabel="Add something that happened"
              style={[styles.addSmall, { backgroundColor: colors.surfaceHigh }]}>
              <Plus size={15} color={colors.text} strokeWidth={2.4} />
            </Press>
          </View>

          <AppText variant="caption" color="textFaint" style={styles.sectionNote}>
            Fee rises, a new member of staff, a road closure. These get pinned onto the charts, so a
            movement six months from now still has its reason attached.
          </AppText>

          <View style={styles.rows}>
            {events.length === 0 ? (
              <View style={[styles.factCard, { backgroundColor: colors.surface }]}>
                <AppText variant="footnote" color="textFaint">
                  Nothing recorded yet.
                </AppText>
              </View>
            ) : (
              events.map((event) => (
                <View key={event.id} style={[styles.eventRow, { backgroundColor: colors.surface }]}>
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: event.origin === 'owner' ? colors.accent : colors.textFaint },
                    ]}
                  />
                  <View style={styles.eventBody}>
                    <AppText variant="footnote">{event.label}</AppText>
                    <AppText variant="caption" color="textFaint">
                      {formatDateFull(event.at)}
                      {event.origin === 'detected' ? ' · spotted automatically' : ''}
                    </AppText>
                  </View>
                  {event.origin === 'owner' ? (
                    <Press
                      haptic="light"
                      scaleTo={0.9}
                      onPress={() => {
                        removeEvent(event.id);
                        offerUndo(`${event.label} removed`, () =>
                          addEvent({ at: event.at, label: event.label }),
                        );
                      }}
                      accessibilityLabel={`Remove ${event.label}`}
                      style={styles.remove}>
                      <AppText variant="caption" color="textFaint">
                        Remove
                      </AppText>
                    </Press>
                  ) : null}
                </View>
              ))
            )}
          </View>
        </Animated.View>

        {/* ------------------------------------------------------- calibration */}
        <Animated.View entering={enter(3)} style={[styles.gutter, styles.block]}>
          <AppText variant="caption" color="textFaint" style={styles.label}>
            HOW OFTEN IT IS RIGHT
          </AppText>
          <View style={[styles.factCard, { backgroundColor: colors.surface }]}>
            <AppText variant="footnote" color="textDim" style={styles.factNote}>
              {calib.verdict}
            </AppText>
            <AppText variant="caption" color="textFaint" style={styles.factNote}>
              {capture.total > 0
                ? `${Math.round((capture.automatic / capture.total) * 100)}% of the last month's records arrived without being typed, across ${capture.zeroTypingDays} day${capture.zeroTypingDays === 1 ? '' : 's'} that needed no typing at all.`
                : 'Nothing recorded in the last month.'}
            </AppText>
          </View>
        </Animated.View>
      </ScrollView>

      {/* ---------------------------------------------------------- correct */}
      <Sheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        eyebrow="Correct this"
        title={editing?.label ?? ''}
        footer={
          <Press
            haptic="medium"
            scaleTo={0.97}
            onPress={() => {
              if (!editing) return;
              const numeric = Number(draft.replace(/[^0-9.]/g, ''));
              correctFact(
                editing.key,
                draft.trim(),
                Number.isFinite(numeric) && numeric > 0 ? numeric : null,
                'Corrected by you',
              );
              setEditing(null);
            }}
            style={[styles.cta, { backgroundColor: colors.accent }]}>
            <Check size={16} color={colors.accentText} strokeWidth={2.4} />
            <AppText variant="callout" tint={colors.accentText}>
              Save correction
            </AppText>
          </Press>
        }>
        <AppText variant="footnote" color="textDim" style={styles.sheetNote}>
          Your correction outranks both what you said at setup and what the records imply. Nothing is
          overwritten — the app keeps what it used to believe, so it can tell you later when it was
          wrong.
        </AppText>
        <TextField value={draft} onChangeText={setDraft} autoFocus />
      </Sheet>

      {/* ------------------------------------------------------------ event */}
      <Sheet
        visible={eventSheet}
        onClose={() => setEventSheet(false)}
        title="What happened?"
        footer={
          <Press
            haptic="medium"
            scaleTo={0.97}
            disabled={eventLabel.trim().length < 3}
            onPress={() => {
              addEvent({ at: Date.now(), label: eventLabel.trim() });
              setEventSheet(false);
            }}
            style={[styles.cta, { backgroundColor: colors.accent }]}>
            <AppText variant="callout" tint={colors.accentText}>
              Pin it to today
            </AppText>
          </Press>
        }>
        <TextField
          value={eventLabel}
          onChangeText={setEventLabel}
          placeholder="Raised fees · new coach started · road closed"
          autoFocus
        />
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

  scroll: { paddingTop: space.base },
  gutter: { paddingHorizontal: space.gutter },
  block: { marginTop: space.xl },
  label: { letterSpacing: 0.9, marginBottom: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionNote: { lineHeight: 16, marginBottom: space.md },
  addSmall: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },

  rows: { gap: space.sm },
  factCard: { padding: space.base, borderRadius: radius.lg, gap: space.sm },
  factHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  factLabel: { flex: 1 },
  factCols: { flexDirection: 'row', gap: space.base },
  factCol: { flex: 1, gap: 1 },
  factNote: { lineHeight: 17 },
  confidence: { lineHeight: 16 },

  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  eventBody: { flex: 1, gap: 1 },
  remove: { paddingHorizontal: space.sm, paddingVertical: space.xs },

  sheetNote: { lineHeight: 18, marginBottom: space.base },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 50,
    borderRadius: radius.pill,
  },
});
