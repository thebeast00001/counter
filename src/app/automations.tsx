import { useRouter } from 'expo-router';
import { ArrowLeft, MoonStar, Sparkles, TriangleAlert } from 'lucide-react-native';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Segmented } from '@/components/Segmented';
import {
  QUIET_HOURS,
  TRUST_LABEL,
  TRUST_MEANING,
  TRUST_ORDER,
  evaluateRules,
  isUnusual,
  promotionOffer,
  ruleHealth,
  ruleSentence,
} from '@/domain/automation';
import type { Rule, RuleTrust } from '@/domain/model';

/** `off` is reached by the switch at the bottom of the card, not by a rung. */
const LADDER = TRUST_ORDER.filter((t) => t !== 'off');
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatDateShort, useTick } from '@/lib/time';
import { useBarInset } from '@/state/dock';
import { useBusiness } from '@/state/business';

/**
 * The automation ladder.
 *
 * Four rungs, each readable in one sentence, and nothing starts above "tell me".
 * The received wisdom is that small businesses want everything automated; they
 * do not. They want to stop *remembering*, which is a different thing — an app
 * that messages a customer on their behalf in the wrong tone has cost them a
 * relationship to save them thirty seconds.
 *
 * A rule that keeps being undone demotes itself rather than waiting to be caught,
 * because the alternative is the owner switching off automation altogether.
 */
export default function AutomationsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { profile, data, setRuleTrust, toggleRule } = useBusiness();
  const now = useTick(300_000);

  const paused = useMemo(() => isUnusual(data, now), [data, now]);

  /**
   * What these rules would do right now, given the records as they stand.
   *
   * Pure — it reports, it does not fire. That distinction is the whole reason
   * this is safe to render: an owner deciding whether to trust automation with
   * their customers needs to see exactly what it would say before it says it,
   * and a ladder whose rungs are invisible until something happens is not a
   * ladder anyone will climb.
   */
  const firings = useMemo(
    () => (profile ? evaluateRules(profile, data, now) : []),
    [profile, data, now],
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
          <AppText variant="title3">What it does on its own</AppText>
          <AppText variant="caption" color="textFaint">
            {data.rules.filter((r) => r.enabled && r.trust !== 'off').length} active
          </AppText>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        {paused ? (
          <Animated.View entering={enter(0)} style={styles.gutter}>
            <View style={[styles.banner, { backgroundColor: colors.surfaceHigh }]}>
              <TriangleAlert size={16} color={colors.warn} strokeWidth={2} />
              <AppText variant="footnote" color="textDim" style={styles.bannerText}>
                Everything is paused. The last week has been far quieter than usual, and a week where
                the readings are strange is the worst possible time to let rules fire on their own.
              </AppText>
            </View>
          </Animated.View>
        ) : null}

        {/* ------------------------------------------------ what would fire */}
        {firings.length > 0 && !paused ? (
          <Animated.View entering={enter(0)} style={styles.gutter}>
            <AppText variant="caption" color="textFaint" style={styles.label}>
              WHAT WOULD HAPPEN RIGHT NOW
            </AppText>
            <View style={styles.rows}>
              {firings.map((firing, i) => {
                /*
                  The same sentence, once.

                  There are only two of these — one for a rule that drafts a
                  message and one for a rule that raises a finding — and a
                  business with four "tell me" rules got the identical paragraph
                  four times down the screen. Repetition that dense stops being
                  read at all, which costs the sentence that does differ its
                  chance of being noticed.
                */
                const note = firing.draft
                  ? 'Written for you to check and send. Nothing goes out on its own.'
                  : 'Raised on your home screen. You decide what happens next.';
                const previous = i > 0 ? Boolean(firings[i - 1].draft) : null;
                const changed = previous === null || previous !== Boolean(firing.draft);

                return (
                <View
                  key={firing.ruleId}
                  style={[styles.firing, { backgroundColor: colors.surface }]}>
                  <View style={styles.firingHead}>
                    <Sparkles size={14} color={colors.accent} strokeWidth={2} />
                    <AppText variant="callout" style={styles.firingLabel}>
                      {firing.label}
                    </AppText>
                  </View>

                  {firing.draft ? (
                    <View style={[styles.draft, { backgroundColor: colors.surfaceHigh }]}>
                      <AppText variant="caption" color="textDim" style={styles.draftText}>
                        “{firing.draft.replace('{name}', 'Priya').replace('{amount}', '₹5.5k')}”
                      </AppText>
                    </View>
                  ) : null}

                  {changed ? (
                    <AppText variant="caption" color="textFaint">
                      {note}
                    </AppText>
                  ) : null}
                </View>
                );
              })}
            </View>
            <AppText variant="caption" color="textFaint" style={styles.previewNote}>
              A preview, not a queue. Nothing here has been sent, and nothing will be until you act
              on it.
            </AppText>
          </Animated.View>
        ) : null}

        <View style={[styles.list, firings.length > 0 && !paused && styles.listSpaced]}>
          {data.rules.map((rule, i) => (
            <Animated.View key={rule.id} entering={enter(i)}>
              <RuleCard
                rule={rule}
                sentence={ruleSentence(rule, profile, data)}
                onTrust={(trust) => setRuleTrust(rule.id, trust)}
                onToggle={(on) => toggleRule(rule.id, on)}
                now={now}
              />
            </Animated.View>
          ))}
        </View>

        <Animated.View entering={enter(9)} style={[styles.gutter, styles.block]}>
          <View style={[styles.quiet, { backgroundColor: colors.surface }]}>
            <MoonStar size={16} color={colors.textDim} strokeWidth={2} />
            <AppText variant="caption" color="textFaint" style={styles.quietText}>
              Nothing outbound fires between {QUIET_HOURS.from > 12 ? QUIET_HOURS.from - 12 : QUIET_HOURS.from}pm
              and {QUIET_HOURS.to}am, whatever a rule wants. A reminder at eleven at night is worse
              than no reminder.
            </AppText>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function RuleCard({
  rule,
  sentence,
  onTrust,
  onToggle,
  now,
}: {
  rule: Rule;
  sentence: string;
  onTrust: (trust: RuleTrust) => void;
  onToggle: (on: boolean) => void;
  now: number;
}) {
  const colors = useColors();
  const health = ruleHealth(rule, now);
  const promotion = promotionOffer(rule);

  return (
    <View style={[styles.rule, { backgroundColor: colors.surface }]}>
      <AppText variant="callout" style={styles.sentence}>
        {sentence}
      </AppText>

      {/*
        The app's own segmented control rather than four separate buttons in a
        row. Four detached rectangles read as four unrelated switches; a single
        track with a thumb that travels reads as one setting with four positions,
        which is what a trust ladder actually is — and it is the same control,
        and the same motion, used everywhere else in the app.
      */}
      <Segmented<RuleTrust>
        options={LADDER.map((trust) => ({ value: trust, label: TRUST_LABEL[trust] }))}
        value={rule.enabled ? rule.trust : 'watch'}
        onChange={(trust) => {
          if (!rule.enabled) onToggle(true);
          onTrust(trust);
        }}
      />

      <AppText variant="caption" color="textFaint" style={styles.meaning}>
        {rule.enabled ? TRUST_MEANING[rule.trust] : 'Switched off.'}
      </AppText>

      {/* Track record. Shown always, not only when it goes wrong. */}
      {rule.firedCount > 0 ? (
        <AppText variant="caption" color="textFaint" style={styles.record}>
          Fired {rule.firedCount} time{rule.firedCount === 1 ? '' : 's'}
          {rule.undoneCount > 0 ? `, undone ${rule.undoneCount}` : ''}
          {rule.lastFiredAt ? ` · last on ${formatDateShort(rule.lastFiredAt)}` : ''}
        </AppText>
      ) : null}

      {health.advice ? (
        <View style={[styles.advice, { backgroundColor: colors.surfaceHigh }]}>
          <AppText variant="caption" color="textDim" style={styles.adviceText}>
            {health.advice}
          </AppText>
          {health.suggestedTrust ? (
            <Press
              haptic="medium"
              scaleTo={0.95}
              onPress={() => onTrust(health.suggestedTrust as RuleTrust)}
              style={[styles.adviceCta, { backgroundColor: colors.surface }]}>
              <AppText variant="caption" tint={colors.accent}>
                Ease it back
              </AppText>
            </Press>
          ) : null}
        </View>
      ) : null}

      {promotion ? (
        <View style={[styles.advice, { backgroundColor: colors.accentSoft }]}>
          <AppText variant="caption" style={styles.adviceText}>
            This has been right {rule.firedCount} times running. Want it to go a step further?
          </AppText>
          <Press
            haptic="medium"
            scaleTo={0.95}
            onPress={() => onTrust(promotion)}
            style={[styles.adviceCta, { backgroundColor: colors.surface }]}>
            <AppText variant="caption" tint={colors.accent}>
              {TRUST_LABEL[promotion]}
            </AppText>
          </Press>
        </View>
      ) : null}

      <Press
        haptic="light"
        scaleTo={0.97}
        onPress={() => onToggle(!rule.enabled)}
        style={styles.off}>
        <AppText variant="caption" color="textFaint">
          {rule.enabled ? 'Switch off' : 'Switch on'}
        </AppText>
      </Press>
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
  block: { marginTop: space.lg },

  banner: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
    padding: space.base,
    borderRadius: radius.md,
    marginBottom: space.base,
  },
  bannerText: { flex: 1, lineHeight: 18 },

  label: { letterSpacing: 0.9, marginBottom: space.sm },
  rows: { gap: space.sm },
  firing: { padding: space.base, borderRadius: radius.lg, gap: space.sm },
  firingHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  firingLabel: { flex: 1 },
  draft: { padding: space.md, borderRadius: radius.sm },
  draftText: { lineHeight: 17, fontStyle: 'italic' },
  previewNote: { marginTop: space.md, lineHeight: 16 },

  list: { paddingHorizontal: space.gutter, gap: space.sm },
  listSpaced: { marginTop: space.xl },
  rule: { padding: space.base, borderRadius: radius.lg, gap: space.md },
  sentence: { lineHeight: 21 },
  ladder: { flexDirection: 'row', gap: space.xs },
  rung: {
    flex: 1,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  meaning: { lineHeight: 16 },
  record: { lineHeight: 16 },

  advice: { padding: space.md, borderRadius: radius.sm, gap: space.sm },
  adviceText: { lineHeight: 16 },
  adviceCta: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    height: 28,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  off: { alignSelf: 'flex-start' },

  quiet: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
    padding: space.base,
    borderRadius: radius.lg,
  },
  quietText: { flex: 1, lineHeight: 17 },
});
