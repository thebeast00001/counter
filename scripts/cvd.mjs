/**
 * Perceptual colour difference, including under colour-vision deficiency.
 *
 * Exists because WCAG contrast is the wrong tool for one specific question. A
 * contrast ratio is a ratio of *luminances*, so two colours of the same
 * lightness and wildly different hue score about 1.0:1 — which says they are
 * indistinguishable when they plainly are not. It is the right measure for text
 * on a background and the wrong one for "are these two rings separable".
 *
 * The right measure is CIEDE2000, run again on the colours as they are actually
 * seen by a reader with dichromacy. About one man in twelve has some form of it,
 * so a three-colour code that only works for trichromats is a three-colour code
 * that fails for a meaningful share of the people it is shown to.
 *
 * Simulation is Viénot, Brettel & Mollon (1999): convert to LMS cone response,
 * collapse the missing cone onto the plane the remaining two can express, and
 * convert back.
 */

/* ------------------------------------------------------------- conversion -- */

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (c) => (c < 0 ? 0 : c > 1 ? 1 : c);

function rgbToXyz([r, g, b]) {
  const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
  return [
    R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    R * 0.2126729 + G * 0.7151522 + B * 0.072175,
    R * 0.0193339 + G * 0.119192 + B * 0.9503041,
  ];
}

/** D65, the white point sRGB is defined against. */
const WHITE = [0.95047, 1.0, 1.08883];

function xyzToLab([x, y, z]) {
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x / WHITE[0]), f(y / WHITE[1]), f(z / WHITE[2])];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const hexToLab = (hex) => xyzToLab(rgbToXyz(hexToRgb(hex)));

/* ------------------------------------------------------------- simulation -- */

// Smith–Pokorny cone fundamentals, applied to linear RGB.
const RGB_TO_LMS = [
  [17.8824, 43.5161, 4.11935],
  [3.45565, 27.1554, 3.86714],
  [0.0299566, 0.184309, 1.46709],
];
const LMS_TO_RGB = [
  [0.080944, -0.130504, 0.116721],
  [-0.0102485, 0.0540194, -0.113615],
  [-0.000365294, -0.00412163, 0.693513],
];

const apply = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

/** `kind` is one of 'protan' (no L cone), 'deutan' (no M), 'tritan' (no S). */
export function simulate(hex, kind) {
  const lin = hexToRgb(hex).map(toLinear);
  const [L, M, S] = apply(RGB_TO_LMS, lin);

  let lms;
  if (kind === 'protan') lms = [2.02344 * M - 2.52581 * S, M, S];
  else if (kind === 'deutan') lms = [L, 0.494207 * L + 1.24827 * S, S];
  else lms = [L, M, -0.395913 * L + 0.801109 * M];

  const back = apply(LMS_TO_RGB, lms).map((c) => clamp01(toGamma(clamp01(c))));
  const hx = back.map((c) =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${hx.join('')}`;
}

/* ------------------------------------------------------------- difference -- */

/**
 * CIEDE2000. The long formula rather than plain Euclidean ΔE76, because ΔE76
 * badly overstates differences in the blues — which is precisely the region
 * these colours live in, so the cheap version would flatter the result.
 */
export function deltaE(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));

  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);

  const hp = (b, ap) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) / rad;
    return h >= 0 ? h : h + 360;
  };
  const hp1 = hp(b1, ap1);
  const hp2 = hp(b2, ap2);

  const dLp = L2 - L1;
  const dCp = Cp2 - Cp1;

  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp / 2) * rad);

  const Lbar = (L1 + L2) / 2;
  const Cbarp = (Cp1 + Cp2) / 2;

  let hbar = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hbar += hp1 + hp2 < 360 ? 360 : -360;
    hbar /= 2;
  }

  const T =
    1 -
    0.17 * Math.cos((hbar - 30) * rad) +
    0.24 * Math.cos(2 * hbar * rad) +
    0.32 * Math.cos((3 * hbar + 6) * rad) -
    0.2 * Math.cos((4 * hbar - 63) * rad);

  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;

  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/** Convenience: ΔE between two hex colours, optionally as a dichromat sees them. */
export function difference(hexA, hexB, kind) {
  const a = kind ? simulate(hexA, kind) : hexA;
  const b = kind ? simulate(hexB, kind) : hexB;
  return deltaE(hexToLab(a), hexToLab(b));
}
