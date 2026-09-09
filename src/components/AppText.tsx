import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useColors } from '@/design/theme';
import { type Palette, type as typeScale } from '@/design/tokens';

type Variant = keyof typeof typeScale;
type ColorKey = keyof Pick<
  Palette,
  'text' | 'textDim' | 'textFaint' | 'accent' | 'accentText' | 'success' | 'warn'
>;

export type AppTextProps = RNTextProps & {
  variant?: Variant;
  color?: ColorKey;
  /** Escape hatch for one-off colours (e.g. a room's own tint). Wins over `color`. */
  tint?: string;
  center?: boolean;
  /** Fixed-width digits. Required on anything that ticks, or the text jitters. */
  tabular?: boolean;
};

/**
 * How far each variant may grow under the system font-size setting.
 *
 * A single global cap is the wrong shape for this. Body copy can afford to grow
 * a long way — it reflows, and someone who needs it that large needs it more
 * than the layout needs to stay pretty. Display numerals cannot: `metric` is
 * already 44pt and lives inside a fixed-height card beside an arc, so letting it
 * reach 57 pushes the value out of its own container.
 *
 * Capping per role means large-text users get real relief on the parts that
 * matter — the sentences — without the metrics tearing their cards apart.
 */
const MAX_SCALE: Partial<Record<Variant, number>> = {
  metric: 1.15,
  largeTitle: 1.2,
  title1: 1.25,
  title2: 1.35,
  title3: 1.4,
  body: 1.6,
  callout: 1.6,
  footnote: 1.6,
  caption: 1.5,
};

/**
 * The only text component in the app. Screens never set fontSize or fontFamily
 * directly — if a size is missing, it belongs in the type scale, not inline.
 */
export function AppText({
  variant = 'body',
  color = 'text',
  tint,
  center,
  tabular,
  style,
  ...rest
}: AppTextProps) {
  const colors = useColors();
  const base = typeScale[variant] as TextStyle;

  return (
    <RNText
      maxFontSizeMultiplier={MAX_SCALE[variant] ?? 1.4}
      style={[
        base,
        { color: tint ?? colors[color] },
        center && { textAlign: 'center' },
        tabular && TABULAR,
        style,
      ]}
      {...rest}
    />
  );
}

/**
 * Fixed-width digits, and the currency symbol trimmed to sit with them.
 *
 * `tabular-nums` only governs digits — the rupee sign keeps its proportional
 * width, so a column of ₹ amounts sets each symbol at a slightly different
 * distance from its number and the column reads as ragged even though the digits
 * are perfectly aligned. A hair of negative tracking pulls it back onto the
 * same rhythm as the figures beside it.
 */
const TABULAR: TextStyle = { fontVariant: ['tabular-nums'], letterSpacing: -0.15 };
