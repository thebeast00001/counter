import Svg, { Circle } from 'react-native-svg';

/**
 * The assistant's mark, drawn as dots rather than as a solid glyph.
 *
 * A filled four-pointed star is the icon every product uses for "AI", and on a
 * saturated gradient it reads as a sticker sitting on top of the button. Broken
 * into dots the same shape becomes part of the surface: the gradient shows
 * between them, so the mark takes its colour from the button instead of
 * covering it.
 *
 * The dots shrink toward the tips, which is what makes it read as a star rather
 * than as a plus. A uniform grid of circles reads as a loading spinner.
 */

/** Column/row pairs on a 7x7 grid, origin top-left. */
const DOTS: [number, number][] = [
  [3, 0],
  [3, 1],
  [2, 2], [3, 2], [4, 2],
  [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3],
  [2, 4], [3, 4], [4, 4],
  [3, 5],
  [3, 6],
];

/** How far from the middle a dot sits, in grid steps. */
function ring(col: number, row: number): number {
  return Math.max(Math.abs(col - 3), Math.abs(row - 3));
}

/** Radius per ring. Hand-picked rather than a curve — four values, all visible. */
const RADII = [2, 1.55, 1.15, 0.8];

const STEP = 3.3;
const MID = 12;

export function AiMark({ size = 21, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {DOTS.map(([col, row]) => (
        <Circle
          key={`${col}-${row}`}
          cx={MID + (col - 3) * STEP}
          cy={MID + (row - 3) * STEP}
          r={RADII[ring(col, row)]}
          fill={color}
        />
      ))}
    </Svg>
  );
}
