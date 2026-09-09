/**
 * Design tokens — One UI inspired.
 *
 * Three rules this file enforces, because they are what separate a polished app
 * from a themed template:
 *   1. One accent. Colour is information, not decoration.
 *   2. Generous radii. One UI corners are much rounder than Material's.
 *   3. Motion is springs, never linear easing. Durations only for opacity.
 */

export type SchemeName = 'light' | 'dark';

/** Every colour role in the app. Both schemes must implement all of them. */
export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceHigh: string;
  hairline: string;
  hairlineStrong: string;

  text: string;
  textDim: string;
  textFaint: string;

  accent: string;
  accentText: string;
  accentSoft: string;

  success: string;
  successSoft: string;
  warn: string;

  scrim: string;
  glass: string;
};

/** Near-black rather than pure black for surfaces, so elevation stays readable on OLED. */
export const palette: Record<SchemeName, Palette> = {
  dark: {
    bg: '#000000',
    surface: '#131316',
    surfaceAlt: '#1B1B1F',
    surfaceHigh: '#232329',
    hairline: 'rgba(255,255,255,0.07)',
    hairlineStrong: 'rgba(255,255,255,0.12)',

    text: '#F7F7F8',
    textDim: '#9A9AA4',
    textFaint: '#63636D',

    accent: '#5B8CFF',
    accentText: '#FFFFFF',
    /** Tinted fills for selected chips / icon wells. Never used for large areas. */
    accentSoft: 'rgba(91,140,255,0.16)',

    success: '#54C79B',
    successSoft: 'rgba(84,199,155,0.16)',
    warn: '#E0B341',

    /** Scrim behind sheets. */
    scrim: 'rgba(0,0,0,0.55)',
    /**
     * Tint layered over the blur.
     *
     * Deliberately heavy. A sheer bar lets you half-read the content sliding
     * underneath, which reads as a rendering fault rather than as glass — the
     * eye keeps trying to parse text that is moving and blurred. Frosted panels
     * should say "there is something behind this", not show you what.
     */
    // Fully opaque. Any translucency here lets scrolling content read through the
    // dock, which makes the bar look like a rendering fault rather than a
    // surface. The material comes from the top highlight and border instead.
    glass: '#15151A',
  },
  light: {
    bg: '#F4F4F6',
    surface: '#FFFFFF',
    surfaceAlt: '#FFFFFF',
    surfaceHigh: '#ECECEF',
    hairline: 'rgba(0,0,0,0.07)',
    hairlineStrong: 'rgba(0,0,0,0.12)',

    text: '#0B0B0F',
    // Darkened from #6B6B76 / #9B9BA5: the originals measured 4.46 and 2.75
    // against light surfaces, just under AA. See scripts/contrast-audit.mjs.
    textDim: '#5C5C68',
    textFaint: '#7E7E8B',

    accent: '#2F6BFF',
    accentText: '#FFFFFF',
    accentSoft: 'rgba(47,107,255,0.10)',

    // Both darkened for AA as body text on white; they read as fills elsewhere
    // and lose nothing by being deeper.
    success: '#0C7050',
    successSoft: 'rgba(12,112,80,0.12)',
    warn: '#855D06',

    scrim: 'rgba(0,0,0,0.28)',
    glass: '#FFFFFF',
  },
};

export type AccentName = 'indigo' | 'teal' | 'green' | 'amber' | 'rose' | 'violet';

export type AccentSet = {
  label: string;
  light: { accent: string; accentSoft: string; accentText: string };
  dark: { accent: string; accentSoft: string; accentText: string };
};

/**
 * Selectable accents.
 *
 * Note the inversion of `accentText` between schemes. Light mode uses a deep
 * accent and puts white on it; dark mode uses a lighter accent and puts near-black
 * on it. Carrying white through to dark mode would leave button labels at about
 * 2.8:1 against their own fill — below AA even for large text. This is the same
 * on-primary flip Material 3 makes, and for the same reason.
 */
export const ACCENTS: Record<AccentName, AccentSet> = {
  indigo: {
    label: 'Indigo',
    light: { accent: '#2558DB', accentSoft: 'rgba(37,88,219,0.12)', accentText: '#FFFFFF' },
    dark: { accent: '#7FA6FF', accentSoft: 'rgba(127,166,255,0.16)', accentText: '#0A0F1E' },
  },
  teal: {
    label: 'Teal',
    light: { accent: '#0E7480', accentSoft: 'rgba(14,116,128,0.10)', accentText: '#FFFFFF' },
    dark: { accent: '#5FC7D2', accentSoft: 'rgba(95,199,210,0.16)', accentText: '#04191C' },
  },
  green: {
    label: 'Green',
    light: { accent: '#177A56', accentSoft: 'rgba(23,122,86,0.10)', accentText: '#FFFFFF' },
    dark: { accent: '#63D3A5', accentSoft: 'rgba(99,211,165,0.16)', accentText: '#052016' },
  },
  amber: {
    label: 'Amber',
    light: { accent: '#875715', accentSoft: 'rgba(135,87,21,0.12)', accentText: '#FFFFFF' },
    dark: { accent: '#E2B45C', accentSoft: 'rgba(226,180,92,0.16)', accentText: '#221805' },
  },
  rose: {
    label: 'Rose',
    light: { accent: '#A83E58', accentSoft: 'rgba(168,62,88,0.10)', accentText: '#FFFFFF' },
    dark: { accent: '#EE8DA1', accentSoft: 'rgba(238,141,161,0.16)', accentText: '#240A12' },
  },
  violet: {
    label: 'Violet',
    light: { accent: '#6244C0', accentSoft: 'rgba(98,68,192,0.10)', accentText: '#FFFFFF' },
    dark: { accent: '#AE97F5', accentSoft: 'rgba(174,151,245,0.16)', accentText: '#140B2A' },
  },
};

export const DEFAULT_ACCENT: AccentName = 'indigo';

/**
 * The three daily loops, as a fixed triad.
 *
 * Deliberately not drawn from the accent and semantic roles. Doing that looked
 * fine until an owner picked the green accent, at which point "Recorded" and
 * "Collected" rendered in near-identical greens and two of the three rings
 * became one — the single thing the composition exists to keep separate.
 *
 * These values are not chosen by eye. They come out of a search over LCh for the
 * triad maximising the smallest CIEDE2000 distance between any two of them,
 * evaluated four times: normal vision, and simulated deuteranopia, protanopia
 * and tritanopia. `scripts/contrast-audit.mjs` re-runs that measurement and
 * fails the build if any pair drops below ΔE 20.
 *
 * Two findings from that search are worth recording, because both contradict
 * the advice you would otherwise follow:
 *
 *   - The standard "colour-blind safe" blue/amber/pink is red-green safe and
 *     tritan-blind. Amber and pink land at ΔE 0.5 under tritanopia — the same
 *     colour. Any trio here needs a green-ish member, not a warm one.
 *   - Blue/gold/green fails too, the other way: gold and green merge under
 *     tritanopia (ΔE 2.1). Blue, a red-purple, and a yellow-green is the only
 *     arrangement that survives all four.
 *
 * The two schemes do not share hue families, which looks like an oversight and
 * is not. Light rings must be dark enough to hold 3:1 on white and dark rings
 * light enough to hold it on near-black, and those two lightness bands reach
 * different parts of the gamut; forcing one family onto both costs more
 * separation than the consistency is worth.
 */
export const RING_COLORS = {
  recorded: { light: '#3474EA', dark: '#C6ABFD' },
  collected: { light: '#71862A', dark: '#C7A842' },
  reached: { light: '#A8406F', dark: '#50DCBE' },
} as const;

export type RingKey = keyof typeof RING_COLORS;

/** 4pt base. Named by intent so screens read declaratively. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  huge: 40,
  /** Standard horizontal screen gutter. One UI runs wider than Material's 16. */
  gutter: 20,
} as const;

/** One UI corners are notably rounder than Material 3. */
export const radius = {
  xs: 10,
  sm: 14,
  md: 20,
  lg: 26,
  xl: 32,
  pill: 999,
} as const;

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/**
 * Type scale. Negative tracking on large sizes only — it is what makes big text
 * look typeset instead of merely large.
 */
export const type = {
  largeTitle: { fontFamily: font.bold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
  title1: { fontFamily: font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  title2: { fontFamily: font.semibold, fontSize: 19, lineHeight: 25, letterSpacing: -0.3 },
  title3: { fontFamily: font.semibold, fontSize: 17, lineHeight: 23, letterSpacing: -0.2 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 23, letterSpacing: -0.1 },
  callout: { fontFamily: font.medium, fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  footnote: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  caption: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.1 },
  /** Tabular-ish display face for timers and metrics. */
  metric: { fontFamily: font.bold, fontSize: 44, lineHeight: 50, letterSpacing: -1.6 },
} as const;

/**
 * Spring configs. Reanimated physics springs — no duration field, so they stay
 * interruptible mid-flight, which is what makes gestures feel native.
 */
/**
 * Spring configs. Reanimated physics springs — no duration field, so they stay
 * interruptible mid-flight, which is what makes gestures feel native.
 *
 * Settling time is roughly `4 / (ζ · √(k/m))`, and it is worth doing that
 * arithmetic rather than picking numbers that look reasonable. The previous
 * `standard` came to about 310ms and `gentle` — being overdamped at ζ ≈ 1.22 —
 * crawled well past half a second, which is where "smooth" turns into "sluggish".
 * Lower mass and higher stiffness buy speed without introducing wobble.
 */
export const spring = {
  /** Press in/out. Stiff and tight: feedback must feel instantaneous. */
  press: { damping: 20, stiffness: 500, mass: 0.6 },
  /** Default for layout, sheets, tab transitions. ζ ≈ 0.86, settles ~180ms. */
  standard: { damping: 24, stiffness: 340, mass: 0.75 },
  /** Long travel. Critically damped so it arrives without overshoot, but arrives. */
  gentle: { damping: 26, stiffness: 240, mass: 0.85 },
  /** Reserved for confirmations. Slight overshoot reads as delight. */
  bouncy: { damping: 14, stiffness: 300, mass: 0.8 },
} as const;

/** Opacity-only durations, in ms. Anything that moves uses a spring instead. */
export const duration = { fast: 120, normal: 200, slow: 320 } as const;

export const layout = {
  /** Collapsed app-bar height, excluding the status-bar inset. */
  headerCollapsed: 56,
  /** Expanded One UI large-title header. Deliberately tall — the empty space is the point. */
  headerExpanded: 132,
  tabBarHeight: 64,
  /**
   * The round action beside the bar. Inset from the bar's own height rather than
   * matching it: at the full 64 the elevation shadow renders outside the circle
   * and the button measures taller than the bar next to it.
   */
  dockAction: 52,
  nowBarHeight: 56,
} as const;

export const HEADER_SCROLL_RANGE = layout.headerExpanded - layout.headerCollapsed;
