import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { gradientAt } from '@/design/gradients';
import { radius, space } from '@/design/tokens';

/** A 1080×1350 portrait card, the aspect every feed crops least. */
export const SHARE_W = 1080;
export const SHARE_H = 1350;
/** Laid out at a quarter size on screen; the capture resizes to the full pixel size. */
export const SHARE_SCALE = 0.25;

export type ShareStat = { label: string; value: string };

/**
 * The thing that actually gets shared.
 *
 * Built as a real view and captured, rather than assembled as text. A text share
 * is a paragraph in someone's chat; a card is an object — it survives being
 * forwarded, it reads at thumbnail size, and it carries the business's name on
 * it. That difference is the entire reason anyone shares anything.
 *
 * Rendered off-screen at a quarter size and resized on capture, so the output is
 * a genuine 1080×1350 image rather than an upscaled phone screenshot. Laying it
 * out at full pixel size would mean a 1080pt-wide view, which no phone can
 * measure sensibly.
 */
export const ShareCard = forwardRef<View, {
  title: string;
  headline: string;
  caption: string;
  stats: ShareStat[];
  business: string;
  gradientIndex?: number;
}>(function ShareCard(
  { title, headline, caption, stats, business, gradientIndex = 0 },
  ref,
) {
  const theme = gradientAt(gradientIndex);
  const set = theme.dark;

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <LinearGradient colors={set.base} locations={[0, 0.52, 1]} style={StyleSheet.absoluteFill} />

      {/* The same pools the wrap uses, static — a captured frame has no motion
          to preserve, so animating them would only risk catching a bad one. */}
      <Svg width={SHARE_W * SHARE_SCALE} height={SHARE_H * SHARE_SCALE} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="share-a" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={set.pools[0]} stopOpacity={0.75} />
            <Stop offset="1" stopColor={set.pools[0]} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="share-b" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={set.pools[1]} stopOpacity={0.6} />
            <Stop offset="1" stopColor={set.pools[1]} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle
          cx={SHARE_W * SHARE_SCALE * 0.2}
          cy={SHARE_H * SHARE_SCALE * 0.22}
          r={SHARE_W * SHARE_SCALE * 0.72}
          fill="url(#share-a)"
        />
        <Circle
          cx={SHARE_W * SHARE_SCALE * 0.88}
          cy={SHARE_H * SHARE_SCALE * 0.46}
          r={SHARE_W * SHARE_SCALE * 0.6}
          fill="url(#share-b)"
        />
      </Svg>

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)']}
        locations={[0.35, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.body}>
        <AppText variant="caption" tint="rgba(255,255,255,0.72)" style={styles.eyebrow}>
          {title.toUpperCase()}
        </AppText>

        <View style={styles.headlineWrap}>
          <AppText variant="largeTitle" tint="#FFFFFF" style={styles.headline} numberOfLines={2}>
            {headline}
          </AppText>
          <AppText variant="footnote" tint="rgba(255,255,255,0.8)" style={styles.caption}>
            {caption}
          </AppText>
        </View>

        {/* Three at most. A share card that lists everything is a spreadsheet
            nobody looks at twice. */}
        <View style={styles.stats}>
          {stats.slice(0, 3).map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <AppText variant="title3" tint="#FFFFFF" tabular>
                {stat.value}
              </AppText>
              {/* Two lines. At a third of the card's width "Check-ins recorded"
                  has nowhere to go on one, and a column of ellipses is worse
                  than a wrapped word. */}
              <AppText
                variant="caption"
                tint="rgba(255,255,255,0.7)"
                numberOfLines={2}
                style={styles.statLabel}>
                {stat.label}
              </AppText>
            </View>
          ))}
        </View>

        <View style={styles.foot}>
          <AppText variant="caption" tint="rgba(255,255,255,0.62)">
            {business}
          </AppText>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: SHARE_W * SHARE_SCALE,
    height: SHARE_H * SHARE_SCALE,
    overflow: 'hidden',
    borderRadius: radius.lg,
  },
  body: { flex: 1, padding: space.lg, justifyContent: 'flex-end', gap: space.base },
  eyebrow: { letterSpacing: 1.4 },
  headlineWrap: { gap: space.xs },
  headline: { fontSize: 40, lineHeight: 44 },
  caption: { lineHeight: 18 },
  stats: { flexDirection: 'row', gap: space.base },
  stat: { flex: 1, gap: 1 },
  statLabel: { fontSize: 10, lineHeight: 13 },
  foot: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.22)', paddingTop: space.md },
});
