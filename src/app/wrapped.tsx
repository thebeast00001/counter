import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, Share2, X } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { MeshBackground } from '@/components/MeshBackground';
import { ShareCard } from '@/components/ShareCard';
import { CountUp, countFrame, moneyFrame } from '@/components/CountUp';
import { EmptyState } from '@/components/EmptyState';
import { Press } from '@/components/Press';
import { wrapMonth, wrappableMonths, type WrapCard } from '@/domain/wrapped';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { shareCardImage } from '@/lib/shareImage';
import { useTick } from '@/lib/time';
import { useBusiness, useIndex } from '@/state/business';

const { width } = Dimensions.get('window');

/**
 * The month, one card at a time.
 *
 * The only screen in the app that is paced rather than scrolled. Everything else
 * respects that an owner is busy and puts the whole answer on one surface; this
 * deliberately does the opposite, because the point is not to inform quickly but
 * to be worth sitting through — and a story you can skim is not a story.
 *
 * Numbers count up as each card arrives. Elsewhere that would be decoration; here
 * it is the entire mechanism, because a figure that lands is felt and a figure
 * that is simply present is read.
 */
export default function WrappedScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reduced } = useMotion();
  const params = useLocalSearchParams<{ month?: string }>();

  const { profile, data } = useBusiness();
  const index = useIndex();
  const now = useTick(3_600_000);

  const months = useMemo(() => wrappableMonths(data, now), [data, now]);
  const target = params.month ? Number(params.month) : (months[0] ?? now);

  const wrap = useMemo(
    () => (profile ? wrapMonth(profile, data, target, now, index) : null),
    [profile, data, target, now, index],
  );

  const [at, setAt] = useState(0);
  const cardRef = useRef<View>(null);

  if (!profile) return null;

  if (!wrap || !wrap.worth) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
        <Header onClose={() => router.back()} label={wrap?.label ?? ''} onShare={null} />
        <EmptyState
          art="calendar"
          title="Not enough of a month yet"
          body="A wrap needs a handful of records to be worth reading. Come back once the month has some shape to it."
          action={{ label: 'Back', onPress: () => router.back() }}
        />
      </View>
    );
  }

  const card = wrap.cards[at];
  const last = at >= wrap.cards.length - 1;

  const share = () => {
    // The card, not the paragraph. `wrap.share` stays as the fallback for a
    // device where the capture is unavailable.
    shareCardImage(cardRef, wrap.share).catch(() => {});
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/*
        A different gradient per card. The wrap is the one screen in the app that
        exists to be felt rather than used, and a story told against a single
        flat surface reads as a settings page with bigger type.
      */}
      <MeshBackground index={at} />

      {/*
        Off-screen, but genuinely mounted — `captureRef` needs a laid-out view,
        and a card built only at the moment of sharing has no measured size to
        capture. Parked far to the left rather than hidden with `display: none`,
        which would stop it laying out at all.
      */}
      <View style={styles.offscreen} pointerEvents="none">
        <ShareCard
          ref={cardRef}
          title={wrap.label}
          headline={card.headline}
          caption={card.body}
          stats={wrap.cards
            .filter((c) => c.key !== card.key)
            .slice(0, 3)
            .map((c) => ({ label: c.eyebrow, value: c.headline }))}
          business={profile.name}
          gradientIndex={at}
        />
      </View>

      <Header onClose={() => router.back()} label={wrap.label} onShare={share} />

      {/* Progress across the story, One UI's thin-rule idiom rather than dots. */}
      <View style={styles.progress}>
        {wrap.cards.map((c, i) => (
          <View
            key={c.key}
            style={[
              styles.tick,
              { backgroundColor: i <= at ? colors.accent : colors.hairlineStrong },
            ]}
          />
        ))}
      </View>

      <Press
        haptic="light"
        scaleTo={1}
        onPress={() => setAt((i) => Math.min(i + 1, wrap.cards.length - 1))}
        accessibilityLabel={`${card.eyebrow}. ${card.headline}. ${card.body}. Tap for the next card.`}
        style={styles.stage}>
        <Animated.View
          key={card.key}
          entering={reduced ? FadeIn.duration(140) : FadeInDown.springify().damping(24).stiffness(300)}
          style={styles.card}>
          <AppText variant="caption" color="textFaint" style={styles.eyebrow}>
            {card.eyebrow.toUpperCase()}
          </AppText>

          <Headline card={card} />

          <AppText variant="body" color="textDim" style={styles.body}>
            {card.body}
          </AppText>
        </Animated.View>
      </Press>

      <View style={[styles.foot, { paddingBottom: insets.bottom + space.lg }]}>
        <Press
          haptic="light"
          scaleTo={0.92}
          disabled={at === 0}
          onPress={() => setAt((i) => Math.max(i - 1, 0))}
          accessibilityLabel="Previous"
          style={[styles.nav, { backgroundColor: colors.surface }]}>
          <ChevronLeft size={18} color={colors.textDim} strokeWidth={2.2} />
        </Press>

        {last ? (
          <Press
            haptic="medium"
            scaleTo={0.97}
            onPress={share}
            style={[styles.cta, { backgroundColor: colors.accent }]}>
            <Share2 size={16} color={colors.accentText} strokeWidth={2.2} />
            <AppText variant="callout" tint={colors.accentText}>
              Share the month
            </AppText>
          </Press>
        ) : (
          <Press
            haptic="medium"
            scaleTo={0.97}
            onPress={() => setAt((i) => i + 1)}
            style={[styles.cta, { backgroundColor: colors.surfaceHigh }]}>
            <AppText variant="callout">Next</AppText>
          </Press>
        )}

        <Press
          haptic="light"
          scaleTo={0.92}
          disabled={last}
          onPress={() => setAt((i) => Math.min(i + 1, wrap.cards.length - 1))}
          accessibilityLabel="Next"
          style={[styles.nav, { backgroundColor: colors.surface }]}>
          <ChevronRight size={18} color={colors.textDim} strokeWidth={2.2} />
        </Press>
      </View>
    </View>
  );
}

/**
 * The number, counting.
 *
 * Money and counts animate; a name does not — watching "Priya Sharma" assemble
 * character by character would be a gimmick rather than a reveal.
 */
function Headline({ card }: { card: WrapCard }) {
  const colors = useColors();
  const tint =
    card.tone === 'good' ? colors.success : card.tone === 'attention' ? colors.warn : colors.text;

  // Sign-aware, so a negative figure still counts rather than falling back to
  // static text — the fallback is silent, which is how it would go unnoticed.
  const asMoney = /^-?₹/.test(card.headline);
  const asCount = /^-?\d+%?$/.test(card.headline);

  if (asMoney) {
    const value = parseMoney(card.headline);
    return <CountUp value={value} format={moneyFrame} variant="metric" tint={tint} duration={900} />;
  }

  if (asCount && !card.headline.endsWith('%')) {
    return (
      <CountUp
        value={Number(card.headline)}
        format={countFrame}
        variant="metric"
        tint={tint}
        duration={800}
      />
    );
  }

  return (
    <AppText variant="metric" tint={tint} numberOfLines={2} style={styles.headlineText}>
      {card.headline}
    </AppText>
  );
}

/** Reverses the compact format so the counter has a real target to reach. */
function parseMoney(text: string): number {
  // The minus sits before the symbol ("-₹6.6k"), so stripping the symbol leaves
  // it in place for parseFloat.
  const raw = text.replace(/[₹,]/g, '');
  if (raw.endsWith('L')) return parseFloat(raw) * 100000;
  if (raw.endsWith('k')) return parseFloat(raw) * 1000;
  return Number(raw) || 0;
}

function Header({
  label,
  onClose,
  onShare,
}: {
  label: string;
  onClose: () => void;
  onShare: (() => void) | null;
}) {
  const colors = useColors();
  return (
    <View style={styles.bar}>
      <Press
        haptic="light"
        scaleTo={0.9}
        onPress={onClose}
        accessibilityLabel="Close"
        style={[styles.nav, { backgroundColor: colors.surface }]}>
        <X size={18} color={colors.text} strokeWidth={2.2} />
      </Press>
      <AppText variant="title3" style={styles.barTitle}>
        {label}
      </AppText>
      {onShare ? (
        <Press
          haptic="light"
          scaleTo={0.9}
          onPress={onShare}
          accessibilityLabel="Share"
          style={[styles.nav, { backgroundColor: colors.surface }]}>
          <Share2 size={17} color={colors.textDim} strokeWidth={2} />
        </Press>
      ) : (
        <View style={styles.nav} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  offscreen: { position: 'absolute', left: -2000, top: 0 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    paddingVertical: space.md,
  },
  barTitle: { flex: 1, textAlign: 'center' },
  nav: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  progress: { flexDirection: 'row', gap: 4, paddingHorizontal: space.gutter, marginBottom: space.lg },
  tick: { flex: 1, height: 3, borderRadius: radius.pill },

  // The card owns the whole middle of the screen. Cramping a story into a
  // list-sized box is what makes most in-app "wrapped" features feel like a
  // settings page with bigger type.
  stage: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xl },
  card: { gap: space.md },
  eyebrow: { letterSpacing: 1 },
  headlineText: { lineHeight: 50 },
  body: { lineHeight: 24, maxWidth: width * 0.82 },

  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
  },
  cta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 50,
    borderRadius: radius.pill,
  },
});
