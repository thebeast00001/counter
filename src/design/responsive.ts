import { useWindowDimensions } from 'react-native';

/** Below this the phone layout applies; at or above it, the tablet one does. */
const TABLET_MIN_WIDTH = 700;

/**
 * Cap for the content column on large screens.
 *
 * Tablets get a centred column rather than a third widget column. Stretching a
 * two-across grid to fill an iPad turns every card into a letterbox and pushes
 * body text past a comfortable measure; capping the width keeps the same
 * proportions the layout was designed at and puts the extra space in the margins,
 * where it costs nothing.
 */
const CONTENT_MAX_WIDTH = 760;

export type Breakpoint = {
  width: number;
  isTablet: boolean;
  /** Undefined on phones, so the style object stays a no-op there. */
  maxWidth: number | undefined;
  /**
   * Columns for tile grids — attendance, metric tiles.
   *
   * Two across on a phone, three on the wider column a tablet gets. Kept as a
   * number rather than a style so callers compute their own percentage width
   * and the gap arithmetic stays in one place per grid.
   */
  columns: 2 | 3;
  /** True in landscape on a phone, where vertical space is the scarce thing. */
  isShort: boolean;
};

export function useBreakpoint(): Breakpoint {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  return {
    width,
    isTablet,
    maxWidth: isTablet ? CONTENT_MAX_WIDTH : undefined,
    columns: isTablet ? 3 : 2,
    isShort: height < 520,
  };
}

/** Percentage width for one cell in a grid of `columns`, allowing for the gap. */
export function cellWidth(columns: number): `${number}%` {
  // A hair under the exact share so rounding never pushes the last cell to a new
  // row on a device whose pixel ratio does not divide cleanly.
  const share = 100 / columns - 1.4;
  return `${share}%`;
}
