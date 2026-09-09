import type { Blob } from '@/components/Aurora';

/**
 * Full-bleed mesh gradients, for the screens that are a moment rather than a
 * tool.
 *
 * Everywhere else in the app colour is information and is rationed accordingly.
 * The month's wrap is the one place that rule is deliberately suspended: it is
 * read once, it is not a control surface, and the whole point is that it feels
 * like an occasion. So these are unapologetically saturated.
 *
 * Each theme is three pools of light over a dark or pale base, in the manner of
 * a mesh gradient — no bands, no visible stops, nothing that resolves into a
 * shape. Twelve of them, so a twelve-card wrap never shows the same background
 * twice and a year of months never repeats in the same order.
 */

export type GradientTheme = {
  key: string;
  label: string;
  /** Vertical ramp underneath, top to bottom. */
  dark: { base: [string, string, string]; pools: [string, string, string] };
  light: { base: [string, string, string]; pools: [string, string, string] };
};

export const GRADIENTS: GradientTheme[] = [
  {
    key: 'orchid',
    label: 'Orchid',
    dark: { base: ['#2A1B4D', '#150E2A', '#07050F'], pools: ['#7C5CFF', '#E45CC8', '#4CA8FF'] },
    light: { base: ['#E9E2FF', '#F4EEFF', '#FBF9FF'], pools: ['#9B7CFF', '#F08BDA', '#79BEFF'] },
  },
  {
    key: 'dusk',
    label: 'Dusk',
    dark: { base: ['#2B1F52', '#181233', '#08060F'], pools: ['#6C63FF', '#B65CFF', '#FF7AA8'] },
    light: { base: ['#E5E3FF', '#F1EFFF', '#FAFAFF'], pools: ['#8B84FF', '#C98BFF', '#FFA3C0'] },
  },
  {
    key: 'ember',
    label: 'Ember',
    dark: { base: ['#4A1B12', '#2A1009', '#0D0503'], pools: ['#FF6B35', '#FFB04C', '#E8425C'] },
    light: { base: ['#FFE7DC', '#FFF2EA', '#FFFAF7'], pools: ['#FF8C5E', '#FFC77A', '#F0748A'] },
  },
  {
    key: 'tide',
    label: 'Tide',
    dark: { base: ['#0C2F45', '#071B29', '#02090F'], pools: ['#3FA9F5', '#42E0D0', '#5C7CFF'] },
    light: { base: ['#DDF0FB', '#EDF7FD', '#F8FCFE'], pools: ['#6EC3F7', '#72E6DA', '#8AA3FF'] },
  },
  {
    key: 'moss',
    label: 'Moss',
    dark: { base: ['#12331F', '#0A1D12', '#020805'], pools: ['#4CD98A', '#A8E05F', '#3FBFA0'] },
    light: { base: ['#DFF5E6', '#EEFAF1', '#F9FDFA'], pools: ['#77E3A9', '#C2EA88', '#6FD2BC'] },
  },
  {
    key: 'plum',
    label: 'Plum',
    dark: { base: ['#3B1233', '#210A1D', '#0A0308'], pools: ['#D94FA8', '#8B5CF6', '#FF7BB0'] },
    light: { base: ['#FCE3F3', '#FDEFF8', '#FEFAFC'], pools: ['#E97CC0', '#A98BF8', '#FFA3C8'] },
  },
  {
    key: 'sand',
    label: 'Sand',
    dark: { base: ['#3E2E14', '#241A0C', '#0A0703'], pools: ['#E8B04C', '#D98A3F', '#C9C05A'] },
    light: { base: ['#FBEED6', '#FDF6E9', '#FEFCF6'], pools: ['#EFC578', '#E5A76D', '#DAD283'] },
  },
  {
    key: 'frost',
    label: 'Frost',
    dark: { base: ['#16283D', '#0D1826', '#03070C'], pools: ['#7FB4FF', '#A5D8FF', '#6E8CFF'] },
    light: { base: ['#E4EEFB', '#F1F6FD', '#FAFCFE'], pools: ['#9CC5FF', '#BEE3FF', '#95A9FF'] },
  },
  {
    key: 'lagoon',
    label: 'Lagoon',
    dark: { base: ['#0B3330', '#061E1C', '#010807'], pools: ['#2FD6C0', '#4CC97F', '#3F9FD9'] },
    light: { base: ['#DBF5F1', '#ECFAF8', '#F8FDFC'], pools: ['#68E2D1', '#7ED9A2', '#74BCE8'] },
  },
  {
    key: 'rose',
    label: 'Rose',
    dark: { base: ['#421220', '#270A13', '#0B0206'], pools: ['#FF5C86', '#FF8FA8', '#C74DB0'] },
    light: { base: ['#FEE3E9', '#FEF0F3', '#FFFAFB'], pools: ['#FF869F', '#FFAFC0', '#DC7FC8'] },
  },
  {
    key: 'slate',
    label: 'Slate',
    dark: { base: ['#1C2436', '#111621', '#04060A'], pools: ['#6B84B8', '#8AA0CC', '#5C6E9E'] },
    light: { base: ['#E6EAF3', '#F2F4F9', '#FAFBFD'], pools: ['#93A7CE', '#AEBEDD', '#8494BC'] },
  },
  {
    key: 'mango',
    label: 'Mango',
    dark: { base: ['#432A08', '#281905', '#0A0602'], pools: ['#FFA23F', '#FFD24C', '#FF6F4C'] },
    light: { base: ['#FFEDD6', '#FFF6E9', '#FFFCF6'], pools: ['#FFBC72', '#FFE08A', '#FF9678'] },
  },
];

export function gradientAt(index: number): GradientTheme {
  return GRADIENTS[((index % GRADIENTS.length) + GRADIENTS.length) % GRADIENTS.length];
}

/**
 * The pools for one theme, positioned to read as a mesh.
 *
 * Fixed placement rather than random: the three positions are chosen so the
 * overlaps land off-centre and the composition never looks like a target. The
 * `seed` only shifts them slightly, so consecutive cards feel related without
 * being identical.
 */
export function poolsFor(theme: GradientTheme, isDark: boolean, seed = 0): Blob[] {
  const set = isDark ? theme.dark : theme.light;
  const wobble = (n: number) => ((((seed * 37 + n * 61) % 100) / 100) - 0.5) * 0.14;
  const alpha = isDark ? 0.62 : 0.55;

  return [
    {
      id: `${theme.key}-1-${seed}`,
      color: set.pools[0],
      x: 0.22 + wobble(1),
      y: 0.24 + wobble(2),
      radius: 0.78,
      opacity: alpha,
      period: 38,
      travel: 0.1,
    },
    {
      id: `${theme.key}-2-${seed}`,
      color: set.pools[1],
      x: 0.82 + wobble(3),
      y: 0.42 + wobble(4),
      radius: 0.68,
      opacity: alpha * 0.9,
      period: 47,
      travel: 0.12,
    },
    {
      id: `${theme.key}-3-${seed}`,
      color: set.pools[2],
      x: 0.44 + wobble(5),
      y: 0.72 + wobble(6),
      radius: 0.74,
      opacity: alpha * 0.8,
      period: 56,
      travel: 0.09,
    },
  ];
}


/* --------------------------------------------------------------- the hero -- */

export type HeroGradient = {
  key: string;
  light: { top: string; mid: string; base: string; glow: string };
  dark: { top: string; mid: string; base: string; glow: string };
};

/**
 * Sixteen washes for the top of the home screen.
 *
 * Deliberately more of them than anyone will notice in a week. One wash means
 * the screen looks identical every morning; four means you learn the rotation by
 * Thursday. At sixteen it simply feels like the app has weather.
 *
 * The ramp keeps its hue all the way down. It used to end on the exact page
 * colour — `#000000` in dark mode — which meant the colour died about an eighth
 * of the way into the header and the rest was indistinguishable from the page.
 * Sixteen washes then looked like one wash, because only the very top of any of
 * them was ever visible. The base is now a deep tint of the same hue, so the
 * header reads as a coloured object with a rounded edge rather than as a bright
 * band fading into the background.
 */
export const HERO_GRADIENTS: HeroGradient[] = [
  {
    key: 'dawn',
    light: { top: '#F3C5D2', mid: '#F8DBE3', base: '#FCF0F3', glow: '#F3C5D2' },
    dark: { top: '#401D2E', mid: '#2C1420', base: '#160A10', glow: '#7A2E4C' },
  },
  {
    key: 'harbour',
    light: { top: '#B9D6EE', mid: '#D4E6F4', base: '#EDF4FB', glow: '#B9D6EE' },
    dark: { top: '#142E4A', mid: '#0E2033', base: '#07101A', glow: '#1F4E7A' },
  },
  {
    key: 'meadow',
    light: { top: '#BEE6C4', mid: '#D7F0DA', base: '#EEF9F0', glow: '#BEE6C4' },
    dark: { top: '#164027', mid: '#0F2C1B', base: '#08160E', glow: '#1E6B3C' },
  },
  {
    key: 'amber',
    light: { top: '#F0D2A4', mid: '#F6E3C7', base: '#FBF3E7', glow: '#F0D2A4' },
    dark: { top: '#432C0F', mid: '#2E1E0A', base: '#170F05', glow: '#7A5015' },
  },
  {
    key: 'orchid',
    light: { top: '#D6BDF2', mid: '#E6D6F7', base: '#F4EEFC', glow: '#D6BDF2' },
    dark: { top: '#341C51', mid: '#241338', base: '#120A1C', glow: '#5A2E8F' },
  },
  {
    key: 'lagoon',
    light: { top: '#AEE3DB', mid: '#CDEEE9', base: '#EAF8F6', glow: '#AEE3DB' },
    dark: { top: '#0C3B3D', mid: '#08292A', base: '#041515', glow: '#146063' },
  },
  {
    key: 'clay',
    light: { top: '#EBC4B0', mid: '#F3DACE', base: '#FAF0EA', glow: '#EBC4B0' },
    dark: { top: '#402116', mid: '#2C170F', base: '#160C08', glow: '#733A20' },
  },
  {
    key: 'slate',
    light: { top: '#C6CEDA', mid: '#DCE1E8', base: '#F0F2F5', glow: '#C6CEDA' },
    dark: { top: '#1D2431', mid: '#141922', base: '#0A0D11', glow: '#36415A' },
  },
  {
    key: 'lilac',
    light: { top: '#C4BFF0', mid: '#DAD7F6', base: '#F0EEFB', glow: '#C4BFF0' },
    dark: { top: '#26204E', mid: '#1A1636', base: '#0D0B1B', glow: '#3F358C' },
  },
  {
    key: 'citrus',
    light: { top: '#E6DC9C', mid: '#F0E9C2', base: '#F9F6E5', glow: '#E6DC9C' },
    dark: { top: '#3A370C', mid: '#282608', base: '#141304', glow: '#6A6412' },
  },
  {
    key: 'coral',
    light: { top: '#F5C2B8', mid: '#F9D9D3', base: '#FCEFED', glow: '#F5C2B8' },
    dark: { top: '#461E19', mid: '#301511', base: '#180B09', glow: '#82322A' },
  },
  {
    key: 'mint',
    light: { top: '#B4E5D0', mid: '#D1EFE2', base: '#ECF8F3', glow: '#B4E5D0' },
    dark: { top: '#0F3D30', mid: '#0A2A21', base: '#051511', glow: '#166A4E' },
  },
  {
    key: 'ink',
    light: { top: '#BAC2E6', mid: '#D4D9F0', base: '#EDEFF9', glow: '#BAC2E6' },
    dark: { top: '#171D46', mid: '#101430', base: '#080A18', glow: '#2A3480' },
  },
  {
    key: 'rose',
    light: { top: '#EFBDD8', mid: '#F5D6E7', base: '#FBEEF5', glow: '#EFBDD8' },
    dark: { top: '#431A34', mid: '#2E1224', base: '#170912', glow: '#7A2A5C' },
  },
  {
    key: 'sand',
    light: { top: '#E2D2B2', mid: '#EDE3CF', base: '#F7F3EB', glow: '#E2D2B2' },
    dark: { top: '#372E16', mid: '#26200F', base: '#131008', glow: '#635223' },
  },
  {
    key: 'sky',
    light: { top: '#B7DCF4', mid: '#D2E9F8', base: '#ECF6FC', glow: '#B7DCF4' },
    dark: { top: '#10334B', mid: '#0B2334', base: '#06121A', glow: '#175A83' },
  },
];

/**
 * Today's wash.
 *
 * Keyed on the calendar day rather than picked at random on each render. Random
 * would re-roll on every re-render — the colour would flicker as the screen
 * updated, and with the React Compiler on, an impure read during render is a bug
 * rather than a quirk. A new one each morning is what "random" was asking for
 * anyway.
 */
/**
 * Which washes suit which part of the day.
 *
 * The wash used to be keyed on the calendar day alone, so an owner opening the
 * app at six in the morning and again at ten at night saw the same colour — the
 * screen looked identical across the whole working day, which is the one stretch
 * of time a shop owner actually lives in. Keyed on the hour instead, the app has
 * a morning and an evening.
 *
 * Every wash is filed under the hours it belongs to by its own hue: the cool
 * blues read as morning, the ambers and clays as the end of the day, the deep
 * indigos as night. There are still sixteen of them, so within a band the
 * calendar day picks which one — the colour suits the hour without the app
 * looking the same every Tuesday morning.
 */
const DAYPARTS: { from: number; to: number; keys: string[] }[] = [
  // First light. Pinks and warm greys, before the day has a temperature.
  { from: 5, to: 8, keys: ['dawn', 'rose', 'coral'] },
  // Morning proper. The cool end, where a screen should feel like starting.
  { from: 8, to: 12, keys: ['sky', 'harbour', 'mint', 'meadow'] },
  // Midday. The brightest, least tinted of them.
  { from: 12, to: 16, keys: ['citrus', 'sand', 'lagoon'] },
  // Late afternoon into evening. Ambers and earth, as the light goes.
  { from: 16, to: 20, keys: ['amber', 'clay', 'orchid'] },
  // Night. Deep and quiet — this is closing-up and counting-the-till time.
  { from: 20, to: 5, keys: ['ink', 'slate', 'lilac'] },
];

function partFor(hour: number) {
  return (
    DAYPARTS.find((part) =>
      // The night band wraps midnight, so it cannot be a simple range test.
      part.from < part.to ? hour >= part.from && hour < part.to : hour >= part.from || hour < part.to,
    ) ?? DAYPARTS[DAYPARTS.length - 1]
  );
}

/**
 * Today's wash for this hour.
 *
 * Pure, and keyed on the values passed in rather than on `Date.now()` — the
 * React Compiler is on, and an impure read during render is a bug rather than a
 * quirk. A wash picked at random would also re-roll on every re-render and
 * flicker as the screen updated.
 */
export function heroGradientFor(now: number): HeroGradient {
  const at = new Date(now);
  const band = partFor(at.getHours());

  const pool = band.keys
    .map((key) => HERO_GRADIENTS.find((g) => g.key === key))
    .filter((g): g is HeroGradient => Boolean(g));

  // A band whose names ever drift out of the set must still render something.
  if (pool.length === 0) return HERO_GRADIENTS[0];

  const day = Math.floor(now / 86_400_000);
  return pool[((day % pool.length) + pool.length) % pool.length];
}

/** Every wash a given hour can produce. Used by the contrast audit. */
export function heroGradientsForHour(hour: number): HeroGradient[] {
  return partFor(hour)
    .keys.map((key) => HERO_GRADIENTS.find((g) => g.key === key))
    .filter((g): g is HeroGradient => Boolean(g));
}

/**
 * The insights header's field.
 *
 * Fixed rather than daily, unlike the home wash. Home changes colour because it
 * is the screen you open every morning and a new one each day is worth the
 * novelty; this is a report, and a report that arrives in a different colour
 * every time is harder to recognise, not friendlier.
 *
 * Teal through ocean to indigo, and the hue family is a deliberate avoidance.
 * The money screen already owns three ramps — red to magenta, orange to red,
 * and a bright blue to purple — and an earlier pink-to-violet header here read
 * as the same screen twice. There is nothing warm and nothing purple in this
 * one, so the two are told apart before a word is read.
 *
 * Every stop is dark enough for white to clear 6:1 on it, which is what the
 * figure, the caption and the month labels all need.
 * `scripts/contrast-audit.mjs` holds these values.
 */
export const INSIGHTS_FIELD: [string, string, string] = ['#0B6A78', '#134E86', '#2E3A8C'];

/**
 * The assistant button's field.
 *
 * Fixed, and deliberately not the accent. The button used to take `colors.accent`
 * and shade it toward black, so it was one hue lit from one side — which is a
 * ball, not a field. Two hues travelling across it read as a surface instead,
 * and being fixed means the one control on every screen looks the same on every
 * screen.
 *
 * White carries the mark on all three stops; `scripts/contrast-audit.mjs`
 * checks it, so a prettier ramp cannot be swapped in without the mark quietly
 * disappearing into it.
 */
export const AI_FIELD: [string, string, string] = ['#3D6FE0', '#6D4BD6', '#A03FC4'];

/**
 * The ink to write on a given wash: near-black or near-white, whichever a reader
 * can actually see.
 *
 * Chosen by measuring the colour rather than by asking which scheme is active.
 * Those two answers usually agree, and the times they do not are exactly the
 * times it matters — a pale wash in dark mode, or a deep one in light mode,
 * would otherwise get ink picked for the scheme and be unreadable on the actual
 * background. Deriving it from the wash means a new gradient can never be added
 * with the wrong text colour, because nobody chooses the text colour.
 *
 * The threshold is WCAG relative luminance at the midpoint of the two inks, so
 * it picks whichever genuinely has more contrast.
 */
export const INK_DARK = '#14141A';
export const INK_LIGHT = '#F2F2F4';

export function inkOn(background: string): string {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  const hex = background.replace('#', '');
  if (hex.length < 6) return INK_DARK;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

  const againstDark = (luminance + 0.05) / (0.0105 + 0.05);
  const againstLight = (0.8409 + 0.05) / (luminance + 0.05);
  return againstDark >= againstLight ? INK_DARK : INK_LIGHT;
}
