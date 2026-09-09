import { layout, space } from '@/design/tokens';
import { useLiveActivity } from '@/state/liveActivity';

/** True while the dock's activity row is expanded. */
export function useDockActivityVisible(): boolean {
  const { activities } = useLiveActivity();
  return activities.length > 0;
}

/**
 * Extra bottom padding a scrolling screen needs while the dock is expanded.
 *
 * Shared with the dock itself so the two can never disagree about whether the
 * activity row is on screen — when that condition lived only inside the bar,
 * screens padded for some activities and not others, and the rest quietly
 * covered the last card.
 */
export function useDockInset(): number {
  return useDockActivityVisible() ? layout.nowBarHeight : 0;
}

/**
 * What a stack screen must leave clear at the bottom.
 *
 * Every inner screen used to pad by `insets.bottom + space.huge`, which was
 * right while the bar existed only on the tabs. Now that a contextual bar floats
 * over every screen, that padding hides the last row everywhere — so the height
 * is published once, here, rather than re-derived in sixteen files that would
 * drift apart the first time the bar changed size.
 */
export function useBarInset(): number {
  return layout.tabBarHeight + space.lg + useDockInset();
}
