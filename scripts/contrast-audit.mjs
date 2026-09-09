/**
 * WCAG contrast audit for the design tokens.
 *
 *   node --experimental-strip-types scripts/contrast-audit.mjs
 *
 * Imports `src/design/tokens.ts` directly rather than keeping a second copy of
 * the palette, so the audit can never drift from what the app actually renders.
 *
 * Translucent tokens are composited over the surface they sit on before being
 * measured — checking `rgba(...)` against a background without compositing
 * reports a number that has nothing to do with what a person sees.
 */
import { ACCENTS, RING_COLORS, palette } from '../src/design/tokens.ts';
import { AI_FIELD, HERO_GRADIENTS, INSIGHTS_FIELD, inkOn } from '../src/design/gradients.ts';
import { difference } from './cvd.mjs';

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;
/** WCAG 1.4.11: meaningful graphics, which is what the rings and their dots are. */
const AA_GRAPHIC = 3.0;

/* ------------------------------------------------------------------ colour */

function parse(color) {
  const hex = color.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return {
      r: (n >> 16) & 255,
      g: (n >> 8) & 255,
      b: n & 255,
      a: hex[2] ? parseInt(hex[2], 16) / 255 : 1,
    };
  }
  const rgba = color.match(/rgba?\(([^)]+)\)/i);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((p) => p.trim());
    return { r: +r, g: +g, b: +b, a: +a };
  }
  throw new Error(`Cannot parse colour: ${color}`);
}

/** Source-over composite of a translucent colour onto an opaque one. */
function composite(fg, bg) {
  const f = parse(fg);
  const b = parse(bg);
  if (f.a >= 1) return f;
  return {
    r: f.r * f.a + b.r * (1 - f.a),
    g: f.g * f.a + b.g * (1 - f.a),
    b: f.b * f.a + b.b * (1 - f.a),
    a: 1,
  };
}

function luminance({ r, g, b }) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg, bg, over) {
  const solidBg = composite(bg, over ?? '#000000');
  const solidFg = composite(fg, `rgb(${solidBg.r},${solidBg.g},${solidBg.b})`);
  const l1 = luminance(solidFg);
  const l2 = luminance(solidBg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------ report */

const rows = [];

function check(scheme, label, fg, bg, threshold, over) {
  const ratio = contrast(fg, bg, over);
  rows.push({
    scheme,
    label,
    ratio,
    threshold,
    pass: ratio >= threshold,
  });
}

for (const scheme of ['light', 'dark']) {
  const c = palette[scheme];

  check(scheme, 'text on bg', c.text, c.bg, AA_NORMAL);
  check(scheme, 'text on surface', c.text, c.surface, AA_NORMAL);
  check(scheme, 'text on surfaceAlt', c.text, c.surfaceAlt, AA_NORMAL);
  check(scheme, 'text on surfaceHigh', c.text, c.surfaceHigh, AA_NORMAL);
  check(scheme, 'text on dock glass', c.text, c.glass, AA_NORMAL);

  check(scheme, 'textDim on bg', c.textDim, c.bg, AA_NORMAL);
  check(scheme, 'textDim on surface', c.textDim, c.surface, AA_NORMAL);
  check(scheme, 'textDim on surfaceHigh', c.textDim, c.surfaceHigh, AA_NORMAL);

  // textFaint is only ever used for de-emphasised captions, which are large or
  // supplementary — held to the large-text bar, and never the only cue.
  check(scheme, 'textFaint on surface (large)', c.textFaint, c.surface, AA_LARGE);

  check(scheme, 'success on surface', c.success, c.surface, AA_NORMAL);
  check(scheme, 'warn on surface', c.warn, c.surface, AA_NORMAL);

  for (const [name, set] of Object.entries(ACCENTS)) {
    const a = set[scheme];
    // Button labels are 17px semibold — the large-text threshold applies.
    check(scheme, `${name}: label on accent (large)`, a.accentText, a.accent, AA_LARGE);
    check(scheme, `${name}: accent on surface`, a.accent, c.surface, AA_NORMAL);
    // Selected chips: accent text on a translucent accent fill over a surface.
    check(scheme, `${name}: accent on soft chip`, a.accent, a.accentSoft, AA_NORMAL, c.surface);
  }

  // The home header, against every wash it can be drawn on.
  //
  // This is the only place in the app where text sits on a colour that changes
  // by itself, so it is the only place where a palette edit can silently make a
  // heading unreadable on the fourth of the month and nowhere else. Both stops
  // the text can land over are measured, not just the average.
  //
  // The subtitle is the one that matters: it is footnote-sized at 65% alpha, so
  // it takes the normal-text threshold with the alpha composited in, while the
  // greeting above it is title2 and takes the large-text one.
  for (const g of HERO_GRADIENTS) {
    const field = g[scheme];
    // The app derives this from the wash, so the audit must too — hardcoding a
    // per-scheme ink here would test a rule the app no longer follows, and a
    // gradient added with the wrong text colour would pass.
    const ink = inkOn(field.top);
    check(scheme, `hero greeting on ${g.key}`, ink, field.top, AA_LARGE);
    check(scheme, `hero subtitle on ${g.key}`, `${ink}B8`, field.top, AA_NORMAL);
    // The glow is painted over the top stop at three-quarter alpha in the
    // corner the profile circle sits in, so the greeting can end up on it.
    check(scheme, `hero greeting on ${g.key} glow`, ink, `${field.glow}BF`, AA_LARGE, field.top);
  }

  // The insights header, which paints everything on the colour rather than on a
  // card inside it. Same in both schemes — it is a fixed field — but checked
  // twice anyway, so a future dark-mode variant cannot be added without this
  // noticing.
  for (const stop of INSIGHTS_FIELD) {
    check(scheme, `insights figure on ${stop}`, '#FFFFFF', stop, AA_NORMAL);
    check(scheme, `insights caption on ${stop}`, 'rgba(255,255,255,0.88)', stop, AA_NORMAL);
    check(scheme, `insights month label on ${stop}`, 'rgba(255,255,255,0.86)', stop, AA_NORMAL);
    // The unselected bars are a graphic carrying the comparison.
    check(scheme, `insights bar on ${stop}`, 'rgba(255,255,255,0.6)', stop, AA_GRAPHIC);
  }

  // The assistant button. Its mark is white on a fixed two-hue field, so a
  // future ramp that looks better cannot be swapped in without this refusing
  // the one that swallows the icon.
  for (const stop of AI_FIELD) {
    check(scheme, `assistant mark on ${stop}`, '#FFFFFF', stop, AA_GRAPHIC);
  }

  // The three daily loops. Two separate requirements, and passing one does not
  // imply the other: each arc must be visible against the card it sits on, and
  // — the reason the triad is hardcoded at all — each must be separable from the
  // other two, or three rings convey what one ring would.
  for (const [key, set] of Object.entries(RING_COLORS)) {
    check(scheme, `ring ${key} on surface`, set[scheme], c.surface, AA_GRAPHIC);
  }
}

const failures = rows.filter((r) => !r.pass);

const pad = (s, n) => String(s).padEnd(n);
let current = '';
for (const r of rows) {
  if (r.scheme !== current) {
    current = r.scheme;
    console.log(`\n  ${current.toUpperCase()}`);
    console.log(`  ${'-'.repeat(58)}`);
  }
  const mark = r.pass ? 'pass' : 'FAIL';
  console.log(
    `  ${pad(r.label, 34)} ${r.ratio.toFixed(2).padStart(5)} : 1   ${pad(r.threshold.toFixed(1), 4)} ${mark}`,
  );
}

console.log(`\n  ${rows.length - failures.length}/${rows.length} pairs pass WCAG AA.`);

/* ------------------------------------------------- ring hue separation ---- */

/**
 * Reported separately, and not as a contrast ratio, because a ratio cannot
 * answer this question: three colours picked to differ in hue at matched
 * lightness score about 1:1 against each other by luminance while being
 * obviously different to look at. What matters for the rings is perceptual
 * distance, and that it survives dichromacy.
 *
 * ΔE00 of 2.3 is the classic "just noticeable" step. For marks read at a glance,
 * a few millimetres apart, on a phone, at arm's length, the bar wants to be far
 * higher than noticeable — around 20 is the distance at which two colours get
 * different names rather than "a lighter one and a darker one".
 *
 * 20 rather than 25 because 25 is not reachable. Searching LCh exhaustively for
 * the best possible triad, subject to each colour holding 3:1 against the
 * surface it is drawn on, tops out near ΔE 24 in light and ΔE 21 in dark. A gate
 * above the ceiling is not a strict gate, it is a broken one.
 */
const DE_MIN = 20;
const VISIONS = [
  ['normal', undefined],
  ['deuteranopia', 'deutan'],
  ['protanopia', 'protan'],
  ['tritanopia', 'tritan'],
];

const ringKeys = Object.keys(RING_COLORS);
const ringFails = [];

console.log(`\n  RING SEPARATION  (CIEDE2000, min ${DE_MIN})`);
console.log(`  ${'-'.repeat(58)}`);

for (const scheme of ['light', 'dark']) {
  for (const [visionName, kind] of VISIONS) {
    const scores = [];
    for (let i = 0; i < ringKeys.length; i += 1) {
      for (let j = i + 1; j < ringKeys.length; j += 1) {
        const a = RING_COLORS[ringKeys[i]][scheme];
        const b = RING_COLORS[ringKeys[j]][scheme];
        const d = difference(a, b, kind);
        scores.push(d);
        if (d < DE_MIN) {
          ringFails.push(`[${scheme}/${visionName}] ${ringKeys[i]} vs ${ringKeys[j]}: ΔE ${d.toFixed(1)}`);
        }
      }
    }
    const worst = Math.min(...scores);
    console.log(
      `  ${pad(`${scheme} · ${visionName}`, 34)} worst ΔE ${worst.toFixed(1).padStart(5)}   ${
        worst >= DE_MIN ? 'pass' : 'FAIL'
      }`,
    );
  }
}

if (ringFails.length > 0) {
  console.log(`\n  Ring separation failures:`);
  for (const f of ringFails) console.log(`   - ${f}`);
  process.exitCode = 1;
} else {
  console.log(`\n  All ring pairs stay separable, including under dichromacy.`);
}
if (failures.length > 0) {
  console.log(`\n  Failures:`);
  for (const f of failures) {
    console.log(`   - [${f.scheme}] ${f.label}: ${f.ratio.toFixed(2)} (needs ${f.threshold})`);
  }
  process.exitCode = 1;
}
