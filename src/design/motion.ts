import {
  FadeIn,
  FadeInDown,
  FadeOut,
  useReducedMotion,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { spring } from '@/design/tokens';

/** Gap between consecutive items in a staggered list, in ms. */
const STAGGER_MS = 32;

/**
 * How many items the stagger actually applies to.
 *
 * This is the single most important number in this file. The stagger used to run
 * uncapped, so a roster of forty rows queued the last one behind 1.8 seconds of
 * delay — the screen was technically animating the whole time and felt broken.
 * Nobody perceives a stagger past the first handful anyway; beyond that it stops
 * reading as rhythm and starts reading as the app being slow.
 *
 * Past this point every remaining item enters together.
 */
const STAGGER_LIMIT = 5;

/**
 * Entrance for list and card content.
 *
 * Short, capped, and slightly stiffer than the layout spring — an entrance the
 * user waits on is worse than no entrance at all.
 */
export const enterFrom = (index = 0) =>
  FadeInDown.springify()
    .damping(24)
    .stiffness(320)
    .mass(0.8)
    .delay(Math.min(index, STAGGER_LIMIT) * STAGGER_MS);

/** For content that should not travel — icons, badges, cross-fades. */
export const fadeIn = (index = 0) =>
  FadeIn.duration(160).delay(Math.min(index, STAGGER_LIMIT) * STAGGER_MS);

export const fadeOut = FadeOut.duration(120);

/**
 * Motion that respects the system "reduce motion" setting.
 *
 * The setting targets large, travelling, or looping motion — the kind that
 * triggers vestibular symptoms — not every visual change. So this scales back
 * entrances, the breathing ring, the edit-mode wiggle, and celebrations, while
 * leaving short functional feedback like a press scale alone: that feedback
 * communicates state, lasts under 200ms, and removing it would make the app feel
 * broken rather than calmer.
 */
export function useMotion() {
  const reduced = useReducedMotion();

  return {
    reduced,

    /** Staggered entrance, or a plain fade when motion is reduced. */
    enter: (index = 0): EntryExitAnimationFunction | undefined =>
      reduced
        ? (FadeIn.duration(100) as unknown as EntryExitAnimationFunction)
        : (enterFrom(index) as unknown as EntryExitAnimationFunction),

    /** Spring for layout transitions; near-instant when motion is reduced. */
    spring: reduced ? { damping: 100, stiffness: 1000, mass: 1 } : spring.standard,

    /** Duration for looping ambient motion. Zero disables the loop entirely. */
    ambient: reduced ? 0 : 2200,
  };
}
