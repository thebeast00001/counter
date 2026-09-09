import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ArrowRight, Check, ChevronRight, Clock } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { CoachMark } from '@/components/CoachMark';
import { Deep, useDeep } from '@/components/Deep';
import { HERO_HEIGHT, HomeHero } from '@/components/HomeHero';
import { LargeTitleScreen } from '@/components/LargeTitleScreen';
import { Press } from '@/components/Press';
import { ProfileButton } from '@/components/ProfileButton';
import { Sheet } from '@/components/Sheet';
import { Skeleton } from '@/components/Skeleton';
import { TextField } from '@/components/TextField';
import { generateInsights, type Insight } from '@/domain/insights';
import { headlineMetrics, money, type Metric } from '@/domain/metrics';
import {
  briefing,
  businessMood,
  moodMessage,
  nowStrip,
  primaryAction,
  pulse,
  rings,
  type NowItem,
} from '@/domain/today';
import { useMotion } from '@/design/motion';
import { useColors, useTheme } from '@/design/theme';
import { RING_COLORS, radius, space, spring } from '@/design/tokens';
import { useBusiness, useIndex } from '@/state/business';
import { useBarScrollHandler } from '@/state/dockChrome';
import { useBarInset, useDockInset } from '@/state/dock';
import { useUndo } from '@/state/undo';
import { useTick } from '@/lib/time';

/** `#RRGGBB` plus an alpha 0..1, as `#RRGGBBAA`. */
function withAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

function greeting(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel(now: number): string {
  const d = new Date(now);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

/**
 * Home answers one question: what should I do in the next hour.
 *
 * It is deliberately built from different parts than the insights screen, which
 * answers what is happening to the business over months. An earlier version
 * shared the insight card component between the two and the screens became
 * indistinguishable — home was simply insights truncated to two rows, which made
 * one of them redundant.
 *
 * So: home is anchored to a clock, leads with a sentence rather than a grid,
 * owns the arc while insights owns bars, and phrases everything as an
 * instruction. Numbers are demoted to a strip at the bottom, because an owner
 * opening this at 5:20pm needs the 5:30 session, not the monthly total.
 */
export default function TodayScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const { enter } = useMotion();
  const dockInset = useDockInset();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { profile, data, hydrated, updateProfile } = useBusiness();
  const index = useIndex();

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [bizDraft, setBizDraft] = useState('');

  /*
    Read by the hero to give up its height as the list rises, and by the
    floating bar to decide whether it should be on screen at all. One handler
    for both: a view only delivers scroll events to the last handler attached
    to it, so a second one here would silently stop the header collapsing.
  */
  const scrollY = useSharedValue(0);
  const onScroll = useBarScrollHandler(scrollY);

  // Re-read the clock every minute so the Now strip advances and the greeting
  // turns over without needing the app to be reopened.
  const now = useTick(60_000);

  const derived = useMemo(() => {
    if (!profile) return null;
    // Derived once and threaded through, so the face, the paragraph and the
    // background tint are all the same reading rather than three of them.
    const moodNow = businessMood(profile, data, now, index);
    return {
      metrics: headlineMetrics(profile, data, now),
      insights: generateInsights(profile, data, { now, index }),
      brief: briefing(profile, data, now, index),
      beat: pulse(data, now),
      strip: nowStrip(profile, data, now),
      primary: primaryAction(profile, data, now),
      loops: rings(profile, data, now, index),
      mood: moodNow,
      moodCopy: moodMessage(profile, data, now, index, moodNow),
    };
    // `now` ticks per minute; recomputing the whole intelligence layer that often
    // is cheap here (one index pass, already memoised upstream) and keeps every
    // relative time on the screen honest.
  }, [profile, data, now, index]);


  if (!hydrated) {
    return (
      <LargeTitleScreen title="…" bottomInset={dockInset}>
        <View style={styles.gutter}>
          <Skeleton height={180} />
          <View style={styles.skeletonGap} />
          <Skeleton height={110} />
        </View>
      </LargeTitleScreen>
    );
  }

  if (!profile || !derived) return null;

  const { metrics, insights, beat, strip, primary, loops, moodCopy } = derived;
  const hour = new Date(now).getHours();

  return (
    /*
      Not `LargeTitleScreen`, which every other tab uses.
      That scaffold owns the top of the screen — a title, a gutter, a safe-area
      pad — and the whole point of the mood panel is that nothing sits above it.
      Home is the one screen where the first thing is a picture rather than a
      heading, so it lays itself out and carries its header inside the colour.
    */
    <View style={styles.screen}>
      {/*
        An animated scroll view so the hero can read the offset on the UI thread.
        Driving the contraction from React state would mean a re-render per
        frame of scrolling, which is the one thing a scroll handler must never
        cost.
      */}
      <Animated.ScrollView
        style={styles.scroller}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentContainerStyle={{
          /* Room for the header, which is painted over this list rather than
             laid out in it. See the note in `HomeHero` for why. */
          paddingTop: insets.top + HERO_HEIGHT,
          paddingBottom: insets.bottom + barInset + dockInset,
        }}>
        <Animated.View entering={enter(0)}>
          {/*
          The three loops, as rows.
          They used to be arcs. Arcs answered "how much of today is done", which
          is a question the owner can already answer and which looks identical on
          a record day and a ruinous one. As rows under the face they keep the
          counts without pretending to be the headline.
        */}
        <View style={styles.loops}>
          {loops.map((loop) => {
            const tone = RING_COLORS[loop.key][isDark ? 'dark' : 'light'];
            const closed = loop.progress >= 1;
            return (
              <Deep
                key={loop.key}
                target={{
                  kind: 'note',
                  eyebrow: loop.label,
                  title: loop.key === 'collected' ? money(loop.done) : `${loop.done} of ${loop.target}`,
                  body: loop.detail,
                }}
                haptic="light"
                scaleTo={0.985}
                style={[styles.loopRow, { backgroundColor: colors.surface }]}>
                <View style={[styles.loopDot, { backgroundColor: tone }]} />
                <View style={styles.loopBody}>
                  <AppText variant="callout">{loop.label}</AppText>
                  <AppText variant="caption" color="textFaint" numberOfLines={1}>
                    {loop.detail}
                  </AppText>
                </View>
                {closed ? (
                  <Check size={15} color={tone} strokeWidth={3} />
                ) : (
                  <AppText variant="callout" tabular tint={tone}>
                    {loop.key === 'collected' ? money(loop.done) : `${loop.done}/${loop.target}`}
                  </AppText>
                )}
              </Deep>
            );
          })}
        </View>

          <CoachMark
            id="deep-press"
            text="Press and hold any number to see where it came from."
          />
        </Animated.View>

      {/* -------------------------------------------------------------- now */}
      {strip.length > 0 ? (
        <Animated.View entering={enter(1)}>
          <AppText variant="caption" color="textFaint" style={styles.stripLabel}>
            NOW
          </AppText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}>
            {strip.map((item) => (
              <NowCard key={item.id} item={item} />
            ))}
          </ScrollView>
        </Animated.View>
      ) : null}

      {/* ------------------------------------------------------------ do it */}
      {insights.length > 0 ? (
        <Animated.View entering={enter(2)}>
          <AppText variant="caption" color="textFaint" style={styles.stripLabel}>
            DO THIS NEXT
          </AppText>
          <View style={styles.list}>
            {insights.map((insight, i) => (
              <ActionCard key={insight.id} insight={insight} index={i} />
            ))}
          </View>
        </Animated.View>
      ) : (
        /*
          A different composition, not an empty version of the same one.
          Silence is the product working — the whole engine exists to stay quiet
          until something is genuinely wrong — so the screen should look settled
          rather than look like a list that failed to load.
        */
        <Animated.View entering={enter(2)} style={[styles.gutter, styles.calmWrap]}>
          <View style={[styles.calm, { borderColor: colors.hairline }]}>
            <View style={[styles.calmMark, { backgroundColor: colors.successSoft }]}>
              <Check size={18} color={colors.success} strokeWidth={2.6} />
            </View>
            <AppText variant="title3" center style={styles.calmTitle}>
              Nothing needs you
            </AppText>
            <AppText variant="footnote" color="textDim" center style={styles.calmBody}>
              Everything is tracking the way it normally does. This screen fills up when something
              moves — an empty one is the app working, not the app idle.
            </AppText>
          </View>
        </Animated.View>
      )}

      {/* --------------------------------------------------------- primary */}
      <Animated.View entering={enter(3)} style={[styles.gutter, styles.primaryWrap]}>
        <Press
          haptic="medium"
          scaleTo={0.975}
          onPress={() => router.push(primary.href as never)}
          accessibilityLabel={primary.label}
          style={[styles.primary, { backgroundColor: colors.accent }]}>
          <View style={styles.primaryBody}>
            <AppText variant="callout" tint={colors.accentText}>
              {primary.label}
            </AppText>
            <AppText variant="caption" tint={colors.accentText} style={styles.primaryBecause}>
              {primary.because}
            </AppText>
          </View>
          <ArrowRight size={18} color={colors.accentText} strokeWidth={2.4} />
        </Press>
      </Animated.View>

      {/* --------------------------------------------------------- numbers */}
      <Animated.View entering={enter(4)}>
        <AppText variant="caption" color="textFaint" style={styles.stripLabel}>
          TODAY IN NUMBERS
        </AppText>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}>
          {metrics.map((metric) => (
            <NumberChip key={metric.key} metric={metric} />
          ))}
        </ScrollView>
      </Animated.View>

      <Sheet
        visible={renaming}
        onClose={() => setRenaming(false)}
        title="Names"
        footer={
          <Press
            haptic="medium"
            scaleTo={0.97}
            onPress={() => {
              updateProfile({
                ownerName: nameDraft.trim() || undefined,
                name: bizDraft.trim() || profile.name,
              });
              setRenaming(false);
            }}
            style={[styles.saveCta, { backgroundColor: colors.accent }]}>
            <AppText variant="callout" tint={colors.accentText}>
              Save
            </AppText>
          </Press>
        }>
        {/*
          Both, not just yours.
          Onboarding asks for the business and then for you, and the keyboard
          used to cover the second field — so the two get swapped, and the only
          one correctable afterwards was your own. Editing them together makes a
          swap a ten-second fix rather than a reason to start over.
        */}
        <AppText variant="footnote" color="textDim" style={styles.renameNote}>
          The greeting uses your name; everything else uses the business.
        </AppText>
        <TextField
          label="Your name"
          value={nameDraft}
          onChangeText={setNameDraft}
          placeholder="Optional"
          autoFocus
        />
        <View style={styles.renameGap} />
        <TextField
          label="Business name"
          value={bizDraft}
          onChangeText={setBizDraft}
          placeholder={profile.name}
        />
        </Sheet>
      </Animated.ScrollView>

      {/* After the list, so it paints over it. */}
      <HomeHero
        scrollY={scrollY}
        now={now}
        greeting={profile.ownerName ? `${greeting(hour)}, ${profile.ownerName}` : greeting(hour)}
        subtitle={`${profile.name} · ${todayLabel(now)}`}
        headline={moodCopy.body}
        value={beat.todayValue}
        valueLabel="Collected today"
        onLongPressTitle={() => {
          setNameDraft(profile.ownerName ?? '');
          setBizDraft(profile.name);
          setRenaming(true);
        }}
        right={<ProfileButton onPress={() => router.push('/account')} />}
      />
    </View>
  );
}

/* ----------------------------------------------------------------- pieces */

/**
 * One thing about to happen.
 *
 * Three things separate this from a list row, and all three exist because the
 * strip is read in a glance between customers rather than studied:
 *
 *   - A live phrase ("in 12 min") beside the clock time. `5:30pm` requires the
 *     reader to know what time it is now and do the subtraction; the strip
 *     should have done that already.
 *   - A rail that fills as the moment approaches, so the ordering is visible
 *     without reading any of the words.
 *   - A slow pulse on whatever is imminent. Only ever one thing pulses — a strip
 *     where everything moves is a strip where nothing stands out.
 */
function NowCard({ item }: { item: NowItem }) {
  const colors = useColors();
  const router = useRouter();
  const { reduced } = useMotion();

  const tint =
    item.tone === 'warn'
      ? colors.warn
      : item.tone === 'good'
        ? colors.success
        : item.tone === 'accent'
          ? colors.accent
          : colors.text;

  const live = item.state === 'happening' || item.state === 'overdue';

  // Breathing, not blinking. A four-second cycle reads as alive at the edge of
  // vision; anything quicker reads as an error state demanding to be dismissed.
  const breath = useSharedValue(0);
  useEffect(() => {
    if (!live || reduced) {
      breath.value = 0;
      return;
    }
    breath.value = withRepeat(withTiming(1, { duration: 2000 }), -1, true);
  }, [live, reduced, breath]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + breath.value * 0.65,
    transform: [{ scale: 0.85 + breath.value * 0.15 }],
  }));

  // The fill is a share of the card, so a glance across the strip ranks
  // everything on it without reading a word. Shown only once it means something:
  // a barely-there sliver on a thing three weeks away is just a smudge.
  const showFill = item.urgency > 0.15 && item.tone !== 'neutral';
  const fillStyle = useAnimatedStyle(() => ({
    // Floored so the gradient always has room to fade. A 20%-wide fade is a
    // gradient; a 4%-wide one is a hard edge with extra steps.
    width: `${Math.round(Math.max(item.urgency, 0.3) * 100)}%`,
  }));

  return (
    <Deep
      target={{
        kind: 'note',
        eyebrow: 'Coming up',
        title: item.label,
        body:
          item.kind === 'session'
            ? 'A recurring session generated from one of your templates. Recording who turned up takes a few seconds and keeps every other number on these screens honest.'
            : item.kind === 'money'
              ? 'Money expected around now. Anything past its date is already costing you — the collection list orders it by size so the effort goes where it counts.'
              : item.kind === 'obligation'
                ? 'These are the things that cost money for being late rather than for being wrong, which is why they appear before they are due rather than after.'
                : 'A day you told the app you were closed. Nothing is expected, and no quiet-day findings will be raised for it.',
        rows: [
          { label: 'When', value: item.lead },
          ...(item.when ? [{ label: 'That is', value: item.when }] : []),
        ],
      }}
      onPress={() => (item.href ? router.push(item.href as never) : undefined)}
      haptic="light"
      scaleTo={0.96}
      accessibilityLabel={`${item.lead}${item.when ? `, ${item.when}` : ''}. ${item.label}`}
      style={[
        styles.nowCard,
        {
          backgroundColor: colors.surface,
          borderColor: item.tone === 'accent' ? colors.accent : 'transparent',
          borderWidth: item.tone === 'accent' ? 1 : 0,
        },
      ]}>
      {/*
        Behind the text — a gauge, not a highlight. A gradient rather than a
        block: a solid fill ends in a vertical edge halfway across the card,
        which reads as a rendering fault rather than as a measure of anything.
      */}
      {showFill ? (
        <Animated.View style={[styles.nowFill, fillStyle]} pointerEvents="none">
          <LinearGradient
            colors={[withAlpha(tint, 0.16), withAlpha(tint, 0)]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}

      <View style={styles.nowHead}>
        <AppText variant="title3" tabular tint={tint} numberOfLines={1} style={styles.grow}>
          {item.lead}
        </AppText>
        {live ? (
          <Animated.View style={[styles.nowPulse, pulseStyle, { backgroundColor: tint }]} />
        ) : null}
      </View>

      <AppText variant="caption" color="textDim" numberOfLines={2}>
        {item.label}
      </AppText>

      {item.when ? (
        <AppText variant="caption" tint={tint} numberOfLines={1} style={styles.nowWhen}>
          {item.when}
        </AppText>
      ) : null}
    </Deep>
  );
}

/**
 * An insight on home, phrased as an instruction.
 *
 * Two lines and a button. The same finding on the insights screen keeps its full
 * paragraph and its signal strength — the density difference is the point, and
 * it is what stops the two screens reading as the same list twice.
 */
function ActionCard({ insight, index }: { insight: Insight; index: number }) {
  const colors = useColors();
  const router = useRouter();
  const { enter, reduced } = useMotion();
  const { open } = useDeep();
  const { raiseAction, snoozeAction } = useBusiness();
  const { offerUndo } = useUndo();

  const tone = insight.tone ?? 'attention';
  const accent = tone === 'good' ? colors.success : tone === 'attention' ? colors.warn : colors.textDim;

  const dx = useSharedValue(0);

  /**
   * Swipe left to put it off for a week.
   *
   * Snoozing through the skip sheet costs four taps and asks for a reason, which
   * is right when dismissing a finding for good and far too much ceremony for
   * "not today". Without a cheap version, the expensive one gets used for both
   * and the reasons it collects become meaningless.
   */
  const putOff = () => {
    const action = raiseAction({
      kind: insight.action?.kind ?? 'review',
      label: insight.action?.label ?? insight.title,
      partyIds: insight.action?.partyIds ?? [],
      insightId: insight.id,
    });
    snoozeAction(action.id, 7);
    offerUndo('Put off for a week', () => snoozeAction(action.id, 0));
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .enabled(!reduced)
    .onUpdate((e) => {
      dx.value = e.translationX < 0 ? Math.max(e.translationX, -120) : e.translationX * 0.1;
    })
    .onEnd(() => {
      if (dx.value < -70) runOnJS(putOff)();
      dx.value = withSpring(0, spring.standard);
    });

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }] }));
  const hintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dx.value, [0, -70], [0, 1], 'clamp'),
  }));

  return (
    <Animated.View entering={enter(index)}>
      <Animated.View style={[styles.snoozeHint, hintStyle]} pointerEvents="none">
        <Clock size={16} color={colors.textDim} strokeWidth={2} />
        <AppText variant="caption" color="textDim">
          Later
        </AppText>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={cardStyle}>
      <Deep
        target={{ kind: 'insight', insight }}
        haptic="light"
        scaleTo={0.98}
        accessibilityHint="Swipe left to put off for a week"
        style={[styles.actionCard, { backgroundColor: colors.surface }]}>
        <View style={[styles.toneBar, { backgroundColor: accent }]} />

        <View style={styles.actionBody}>
          <AppText variant="callout" numberOfLines={2}>
            {insight.title}
          </AppText>
          <AppText variant="caption" color="textDim" numberOfLines={2} style={styles.actionSub}>
            {insight.detail}
          </AppText>

          {insight.action ? (
            <Press
              haptic="medium"
              scaleTo={0.96}
              onPress={() =>
                router.push(
                  `/worklist?insight=${encodeURIComponent(insight.id)}&kind=${insight.action!.kind}` as never,
                )
              }
              accessibilityLabel={insight.action.label}
              style={[styles.actionCta, { backgroundColor: colors.accentSoft }]}>
              <AppText variant="footnote" tint={colors.accent}>
                {insight.action.label}
              </AppText>
              <ChevronRight size={14} color={colors.accent} strokeWidth={2.4} />
            </Press>
          ) : (
            <Press
              haptic="light"
              scaleTo={0.96}
              onPress={() => open({ kind: 'insight', insight })}
              style={styles.actionGhost}>
              <AppText variant="footnote" color="textDim">
                Why this matters
              </AppText>
              <ChevronRight size={14} color={colors.textDim} strokeWidth={2.4} />
            </Press>
          )}
        </View>
      </Deep>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

function NumberChip({ metric }: { metric: Metric }) {
  const colors = useColors();
  const tint =
    metric.tone === 'warn' ? colors.warn : metric.tone === 'good' ? colors.success : colors.text;

  return (
    <Deep
      target={{ kind: 'metric', metricKey: metric.key }}
      haptic="light"
      scaleTo={0.95}
      accessibilityLabel={`${metric.label}: ${metric.value}. Long press for detail.`}
      style={[styles.chip, { backgroundColor: colors.surface }]}>
      <AppText variant="title3" tabular tint={tint}>
        {metric.value}
      </AppText>
      <AppText variant="caption" color="textDim" numberOfLines={1}>
        {metric.label}
      </AppText>
    </Deep>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroller: { flex: 1 },
  gutter: { paddingHorizontal: space.gutter },
  skeletonGap: { height: space.md },

  pulseCard: { borderRadius: radius.lg, padding: space.lg },
  pulseRow: { flexDirection: 'row', alignItems: 'center', gap: space.base },
  pulseBody: { flex: 1 },
  brief: { lineHeight: 23 },
  pulseFoot: { marginTop: space.sm, lineHeight: 16 },

  legend: { marginTop: space.md, gap: space.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  legendDot: { width: 7, height: 7, borderRadius: radius.pill },
  legendLabel: { flex: 1 },

  stripLabel: {
    paddingHorizontal: space.gutter,
    letterSpacing: 0.9,
    marginTop: space.xl,
    marginBottom: space.md,
  },
  strip: { paddingHorizontal: space.gutter, gap: space.sm },
  nowCard: {
    minWidth: 132,
    maxWidth: 190,
    borderRadius: radius.md,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    gap: 3,
    justifyContent: 'center',
  },

  list: { paddingHorizontal: space.gutter, gap: space.sm },
  snoozeHint: {
    position: 'absolute',
    right: space.base,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  actionCard: { flexDirection: 'row', borderRadius: radius.lg, overflow: 'hidden' },
  toneBar: { width: 3 },
  actionBody: { flex: 1, padding: space.base, gap: 3 },
  actionSub: { lineHeight: 17 },
  actionCta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 34,
    paddingLeft: space.md,
    paddingRight: space.sm,
    borderRadius: radius.pill,
    marginTop: space.sm,
  },
  actionGhost: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 30,
    marginTop: space.xs,
  },

  primaryWrap: { marginTop: space.xl },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.base,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
  },
  primaryBody: { flex: 1, gap: 1 },
  primaryBecause: { opacity: 0.75 },

  chip: {
    minWidth: 108,
    borderRadius: radius.md,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    gap: 2,
  },

  calmWrap: { marginTop: space.md },
  calm: {
    alignItems: 'center',
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  calmMark: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calmTitle: { marginTop: space.md },
  calmBody: { marginTop: space.xs, lineHeight: 18, maxWidth: 300 },

  saveCta: { height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  nowHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  nowFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  nowPulse: { width: 7, height: 7, borderRadius: radius.pill },
  nowWhen: { marginTop: 2 },
  loops: { gap: space.sm, marginTop: space.lg, paddingHorizontal: space.gutter },
  loopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  loopDot: { width: 9, height: 9, borderRadius: radius.pill },
  loopBody: { flex: 1, gap: 1 },
  menu: { gap: space.sm, marginTop: space.xs },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  menuIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBody: { flex: 1, gap: 2 },
  renameGap: { height: space.base },
  renameNote: { lineHeight: 18, marginBottom: space.base },
});
